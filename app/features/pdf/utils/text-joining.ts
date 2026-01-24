/**
 * Line breaking rules and paragraph assembly utilities.
 * Functions for determining when to keep/remove line breaks and joining text.
 */

import type { StructuredLine, StructuredBlock, FontRange } from "../types";
import {
  ParagraphJoiningOptions,
  isSentenceEnding,
  DEBUG_LINE_BREAK,
  DEBUG_LINE_BREAK_PATTERN,
  DEBUG_LINE_JOIN,
  DEBUG_LINE_JOIN_PATTERN,
} from "./pdf-utils-common";
import { isSpecialKeywordHeading } from "./heading-patterns";
import { isListItem } from "./reference-detection";
import { repairLigatures } from "./ligature-repair";

// ============================================================================
// CONSTANTS
// ============================================================================

// Hyphenated word at end of line (letter followed by hyphen at end)
// Includes: regular hyphen (-), soft hyphen (\u00AD), hyphen (\u2010), non-breaking hyphen (\u2011)
const HYPHEN_END_PATTERN = /[a-zA-Z\u00C0-\u024F][-\u00AD\u2010\u2011]$/;

// ============================================================================
// TEXT ANALYSIS FUNCTIONS
// ============================================================================

/**
 * Check if text ends with a hyphenated word break
 */
export function endsWithHyphen(text: string): boolean {
  return HYPHEN_END_PATTERN.test(text.trim());
}

/**
 * Check if line ends with sentence-ending punctuation.
 * Handles abbreviations like "Mr.", "et al.", "i.e.", etc.
 */
export function endsWithPunctuation(text: string): boolean {
  return isSentenceEnding(text);
}

/**
 * Check if there's a significant vertical gap between lines
 */
export function hasLargeVerticalGap(
  prevLine: StructuredLine,
  currentLine: StructuredLine,
  options: Required<ParagraphJoiningOptions>
): boolean {
  const prevBottom = prevLine.bbox.y + prevLine.bbox.h;
  const gap = currentLine.bbox.y - prevBottom;
  const lineHeight = prevLine.bbox.h;

  return gap > lineHeight * options.paragraphGapRatio;
}

/**
 * Check if a line is "full width" (reaches near the typical line width).
 * Compares against max line width in block, not block bbox (which may include margins).
 */
export function isFullWidthLine(
  line: StructuredLine,
  block: StructuredBlock,
  options: Required<ParagraphJoiningOptions>
): boolean {
  const lineWidth = line.bbox.w;

  // Find the maximum line width in this block (the "typical" full line)
  const maxLineWidth = Math.max(...block.lines.map((l) => l.bbox.w));

  return lineWidth >= maxLineWidth * options.fullWidthRatio;
}

/**
 * Check if font changed significantly (indicating heading/body transition).
 * Only triggers if previous line ends with punctuation (complete heading).
 * This avoids breaking on inline bold labels like "Ice shelves. Text continues..."
 */
export function hasFontChange(
  prevLine: StructuredLine,
  currentLine: StructuredLine
): boolean {
  const prevText = prevLine.text.trim();
  const currentText = currentLine.text.trim();

  // Font size change of more than 2pt indicates different text type
  const sizeDiff = Math.abs(prevLine.font.size - currentLine.font.size);
  if (sizeDiff > 2) return true;

  // Bold to non-bold transition (heading → body)
  if (prevLine.font.weight === "bold" && currentLine.font.weight !== "bold") {
    // If previous line ends with punctuation, it's clearly a complete heading
    if (isSentenceEnding(prevText)) {
      return true;
    }
    // If previous line is relatively short (likely a title), also break
    // This catches headings like "Introduction" or "Antarctica in 2070 under high emissions"
    if (prevText.length < 100) {
      return true;
    }
  }

  // Non-bold to bold transition (body → heading)
  // If current line becomes bold and is short, it's likely a section heading like "ABSTRACT"
  if (prevLine.font.weight !== "bold" && currentLine.font.weight === "bold") {
    if (currentText.length < 100) {
      return true;
    }
  }

  return false;
}

/**
 * Check if two lines are on the same visual row (overlapping Y positions)
 */
export function areOnSameRow(line1: StructuredLine, line2: StructuredLine): boolean {
  const y1Top = line1.bbox.y;
  const y1Bottom = line1.bbox.y + line1.bbox.h;
  const y2Top = line2.bbox.y;
  const y2Bottom = line2.bbox.y + line2.bbox.h;

  // Check if Y ranges overlap significantly (at least 50%)
  const overlapStart = Math.max(y1Top, y2Top);
  const overlapEnd = Math.min(y1Bottom, y2Bottom);
  const overlap = Math.max(0, overlapEnd - overlapStart);
  const minHeight = Math.min(line1.bbox.h, line2.bbox.h);

  return overlap > minHeight * 0.5;
}

/**
 * Check if current line has significant indentation (new paragraph).
 * Only applies to vertically stacked lines, not horizontally adjacent text.
 */
export function hasIndentation(
  prevLine: StructuredLine,
  currentLine: StructuredLine,
  block: StructuredBlock
): boolean {
  // If lines are on the same visual row, this is horizontal layout, not indentation
  if (areOnSameRow(prevLine, currentLine)) {
    return false;
  }

  // Indentation of more than 10% of block width
  const indentThreshold = block.bbox.w * 0.1;
  return currentLine.bbox.x - prevLine.bbox.x > indentThreshold;
}

// ============================================================================
// LINE BREAK DECISION
// ============================================================================

/**
 * Determine if we should keep a line break between two lines
 */
export function shouldKeepLineBreak(
  prevLine: StructuredLine,
  currentLine: StructuredLine,
  block: StructuredBlock,
  options: Required<ParagraphJoiningOptions>
): boolean {
  const prevText = prevLine.text.trim();
  const currentText = currentLine.text.trim();

  // Debug logging for targeted pattern
  const shouldDebugLineBreak =
    DEBUG_LINE_BREAK &&
    currentText.toLowerCase().includes(DEBUG_LINE_BREAK_PATTERN);

  // Debug logging for line join investigation (check both prev and current)
  const shouldDebugLineJoin =
    DEBUG_LINE_JOIN &&
    (prevText.toLowerCase().includes(DEBUG_LINE_JOIN_PATTERN) ||
      currentText.toLowerCase().includes(DEBUG_LINE_JOIN_PATTERN));

  if (shouldDebugLineBreak) {
    console.log(
      `[LineBreakDebug] Checking line break before: "${currentText.slice(
        0,
        50
      )}..."`
    );
    console.log(`  prevText: "${prevText.slice(-50)}"`);
  }

  if (shouldDebugLineJoin) {
    console.log(`[LineJoinDebug] Checking break between:`);
    console.log(
      `  prev: "${prevText.slice(0, 60)}${prevText.length > 60 ? "..." : ""}"`
    );
    console.log(
      `  curr: "${currentText.slice(0, 60)}${
        currentText.length > 60 ? "..." : ""
      }"`
    );
  }

  // ALWAYS join lines on the same visual row (horizontally adjacent text)
  // This handles cases like "2    Target Propagation" extracted as separate lines
  if (areOnSameRow(prevLine, currentLine)) {
    if (shouldDebugLineBreak || shouldDebugLineJoin)
      console.log(`  -> JOIN: same row`);
    return false;
  }

  // ALWAYS join consecutive heading lines with EXACT same font (size + weight)
  // This handles multi-line headings like "PHOTOGRAPHY AND PHOTO-ELICITATION AFTER\nCOLONIALISM"
  // where both lines have the same heading font but are on different visual lines
  if (options.bodyFontSize > 0) {
    const prevSize = Math.round(prevLine.font.size * 10) / 10;
    const currSize = Math.round(currentLine.font.size * 10) / 10;
    const prevWeight = prevLine.font.weight;
    const currWeight = currentLine.font.weight;

    // Check if both lines have exactly the same font
    const sameFont = prevSize === currSize && prevWeight === currWeight;

    // Check if this font differs from body text (i.e., it's a heading style)
    const isHeadingFont =
      prevSize !== options.bodyFontSize ||
      prevWeight !== options.bodyFontWeight;

    if (shouldDebugLineJoin) {
      console.log(
        `  font check: prevSize=${prevSize}, currSize=${currSize}, bodySize=${options.bodyFontSize}`
      );
      console.log(
        `  prevWeight=${prevWeight}, currWeight=${currWeight}, bodyWeight=${options.bodyFontWeight}`
      );
      console.log(`  sameFont=${sameFont}, isHeadingFont=${isHeadingFont}`);
    }

    // If both lines are heading style with same font, join them
    if (sameFont && isHeadingFont) {
      if (shouldDebugLineBreak || shouldDebugLineJoin)
        console.log(`  -> JOIN: same heading font`);
      return false;
    }
  }

  // Join if previous line ends with hyphenated word break
  // Word break signals:
  // 1. Hyphen + trailing space (justified text adds space after hyphen)
  // 2. Hyphen on a full-width line (normal text wrapping)
  // 3. Next line starts with lowercase (word continues: "quar-" + "ter")
  // Compound words like "Morocco-ECOWAS" have next line starting with uppercase
  if (options.removeHyphens && endsWithHyphen(prevText)) {
    const hasTrailingSpaceAfterHyphen = /[-\u00AD\u2010\u2011]\s+$/.test(
      prevLine.text
    );
    const isFullWidth = isFullWidthLine(prevLine, block, options);
    const nextStartsWithLowercase = /^[a-z]/.test(currentLine.text.trimStart());
    if (hasTrailingSpaceAfterHyphen || isFullWidth || nextStartsWithLowercase) {
      if (shouldDebugLineBreak || shouldDebugLineJoin)
        console.log(`  -> JOIN: hyphen continuation`);
      return false;
    }
  }

  // Always keep breaks for list items
  if (isListItem(currentText)) {
    if (shouldDebugLineBreak || shouldDebugLineJoin)
      console.log(`  -> BREAK: list item`);
    return true;
  }

  // Keep break after heading keywords (Conclusion, Introduction, Abstract, References)
  // These should always be on their own line
  if (isSpecialKeywordHeading(prevText)) {
    if (shouldDebugLineBreak || shouldDebugLineJoin)
      console.log(`  -> BREAK: special heading keyword`);
    return true;
  }

  // Keep break if there's a large vertical gap
  if (hasLargeVerticalGap(prevLine, currentLine, options)) {
    if (shouldDebugLineBreak || shouldDebugLineJoin)
      console.log(`  -> BREAK: large vertical gap`);
    return true;
  }

  // Keep break if font changed (heading to body)
  if (hasFontChange(prevLine, currentLine)) {
    if (shouldDebugLineBreak || shouldDebugLineJoin)
      console.log(`  -> BREAK: font change`, {
        prevFont: { size: prevLine.font.size, weight: prevLine.font.weight },
        currFont: {
          size: currentLine.font.size,
          weight: currentLine.font.weight,
        },
      });
    return true;
  }

  // Keep break if current line is indented (new paragraph)
  if (hasIndentation(prevLine, currentLine, block)) {
    if (shouldDebugLineBreak || shouldDebugLineJoin)
      console.log(`  -> BREAK: indentation`);
    return true;
  }

  // Keep break if previous line ends with punctuation AND is short (not full width)
  const prevEndsPunct = endsWithPunctuation(prevText);
  const prevIsFullWidth = isFullWidthLine(prevLine, block, options);
  if (prevEndsPunct && !prevIsFullWidth) {
    if (shouldDebugLineBreak || shouldDebugLineJoin)
      console.log(`  -> BREAK: punctuation + short line`, {
        endsWithPunctuation: prevEndsPunct,
        isFullWidth: prevIsFullWidth,
        prevLineWidth: prevLine.bbox.w,
        blockWidth: block.bbox.w,
      });
    return true;
  }

  // Otherwise, join the lines
  if (shouldDebugLineBreak || shouldDebugLineJoin)
    console.log(`  -> JOIN: default (no break conditions met)`);
  return false;
}

// ============================================================================
// TEXT JOINING
// ============================================================================

/**
 * Join two text strings, handling hyphenation
 */
export function joinText(
  prevText: string,
  currentText: string,
  options: Required<ParagraphJoiningOptions>
): string {
  const trimmedPrev = prevText.trimEnd();
  const trimmedCurrent = currentText.trimStart();

  // Handle hyphenated word breaks
  if (options.removeHyphens && endsWithHyphen(trimmedPrev)) {
    // Remove the trailing hyphen and join directly (no space)
    return trimmedPrev.slice(0, -1) + trimmedCurrent;
  }

  // Normal join with space
  return trimmedPrev + " " + trimmedCurrent;
}

/**
 * Process a block's lines into paragraph-aware text
 */
export function processBlockLines(
  block: StructuredBlock,
  options: Required<ParagraphJoiningOptions>
): string[] {
  if (block.lines.length === 0) return [];

  const paragraphs: string[] = [];
  let currentParagraph = block.lines[0].text;

  for (let i = 1; i < block.lines.length; i++) {
    const prevLine = block.lines[i - 1];
    const currentLine = block.lines[i];

    if (shouldKeepLineBreak(prevLine, currentLine, block, options)) {
      // Start new paragraph
      paragraphs.push(currentParagraph.trim());
      currentParagraph = currentLine.text;
    } else {
      // Join to current paragraph
      currentParagraph = joinText(currentParagraph, currentLine.text, options);
    }
  }

  // Don't forget the last paragraph
  if (currentParagraph.trim()) {
    paragraphs.push(currentParagraph.trim());
  }

  // Filter out single-character paragraphs (noise/artifacts)
  return paragraphs.filter((p) => p.length > 1);
}

// ============================================================================
// BLOCK PROCESSING WITH POSITION TRACKING
// ============================================================================

/**
 * Result of processing a block with position tracking
 */
export interface ProcessedBlockResult {
  text: string;
  spanPositions: Map<number, { start: number; end: number }>; // spanIndex → position in text
  fontRanges: FontRange[]; // Font info for each portion of text
}

/**
 * Process a block's lines into text while tracking where each span lands.
 * This enables stable superscript position mapping without text searching.
 */
export function processBlockWithTracking(
  block: StructuredBlock,
  options: Required<ParagraphJoiningOptions>
): ProcessedBlockResult {
  const spanPositions = new Map<number, { start: number; end: number }>();
  const fontRanges: FontRange[] = [];

  if (block.lines.length === 0) {
    return { text: "", spanPositions, fontRanges };
  }

  // Debug: Check if this block contains our target pattern
  const blockFullText = block.lines.map((l) => l.text).join(" ");
  const shouldDebugBlock =
    (DEBUG_LINE_BREAK &&
      blockFullText.toLowerCase().includes(DEBUG_LINE_BREAK_PATTERN)) ||
    (DEBUG_LINE_JOIN &&
      blockFullText.toLowerCase().includes(DEBUG_LINE_JOIN_PATTERN));

  if (shouldDebugBlock) {
    console.log(
      `[BlockLinesDebug] Found pattern in block with ${block.lines.length} lines:`
    );
    block.lines.forEach((line, i) => {
      console.log(
        `  Line ${i}: "${line.text.slice(0, 80)}${
          line.text.length > 80 ? "..." : ""
        }" (font: ${line.font.size}/${line.font.weight})`
      );
    });
  }

  // Helper to get normalized font weight
  const getFontWeight = (line: StructuredLine): "normal" | "bold" =>
    line.font.weight === "bold" ? "bold" : "normal";

  // Helper to detect italic from font style or name
  const getFontItalic = (line: StructuredLine): boolean =>
    line.font.style === "italic" ||
    line.font.name?.toLowerCase().includes("italic") ||
    line.font.name?.toLowerCase().includes("oblique") ||
    false;

  // Build the text while tracking each span's position and font
  let result = "";

  // Track the first span
  const firstLine = block.lines[0];
  const firstText = firstLine.text;
  spanPositions.set(0, { start: 0, end: firstText.length });
  fontRanges.push({
    start: 0,
    end: firstText.length,
    size: Math.round(firstLine.font.size * 10) / 10,
    weight: getFontWeight(firstLine),
    italic: getFontItalic(firstLine),
  });
  result = firstText;

  for (let i = 1; i < block.lines.length; i++) {
    const prevLine = block.lines[i - 1];
    const currentLine = block.lines[i];
    const currentText = currentLine.text;

    if (shouldKeepLineBreak(prevLine, currentLine, block, options)) {
      // Start new paragraph - add single newline
      // (bibliography detection now uses density-based blob analysis, no need to split entries)
      result = result.trimEnd();

      // IMPORTANT: Update previous span positions that extend past the trimmed length
      // Without this, superscript positions would be calculated incorrectly (cumulative drift)
      for (let j = i - 1; j >= 0; j--) {
        const sp = spanPositions.get(j);
        if (sp && sp.end > result.length) {
          if (sp.start >= result.length) {
            // Entire span is in trimmed area - remove it
            spanPositions.delete(j);
          } else {
            // Truncate the span
            sp.end = result.length;
          }
        } else {
          // Once we find a span that doesn't need adjustment, we can stop
          break;
        }
      }

      // IMPORTANT: Update previous font ranges that extend past the trimmed length
      // Without this, ranges would extend past the actual text, overlapping with new ranges
      // We need to check ALL ranges, not just the last one, because trimming can affect multiple
      // Also handle ranges that become entirely invalid (end <= start after trimming)
      for (let j = fontRanges.length - 1; j >= 0; j--) {
        const fr = fontRanges[j];
        if (fr.end > result.length) {
          if (fr.start >= result.length) {
            // Entire range is in trimmed area - remove it
            fontRanges.splice(j, 1);
          } else {
            // Truncate the range
            fr.end = result.length;
          }
        } else {
          // Once we find a range that doesn't need adjustment, we can stop
          break;
        }
      }

      result += "\n";

      const startPos = result.length;
      const trimmedText = currentText.trimStart();
      result += trimmedText;
      spanPositions.set(i, { start: startPos, end: result.length });
      fontRanges.push({
        start: startPos,
        end: result.length,
        size: Math.round(currentLine.font.size * 10) / 10,
        weight: getFontWeight(currentLine),
        italic: getFontItalic(currentLine),
      });
    } else {
      // Join to current paragraph - preserve original spacing from MuPDF

      // First, check if lines are on the same visual line (same Y position)
      const prevY = prevLine.bbox.y;
      const currY = currentLine.bbox.y;
      const lineHeight = prevLine.bbox.h || prevLine.font.size || 12;
      const yTolerance = lineHeight * 0.2;
      const sameVisualLine = Math.abs(currY - prevY) < yTolerance;

      // Handle hyphenated word breaks - but ONLY for cross-line breaks (different Y)
      // If same visual line, the hyphen is part of a compound word (e.g., "long-run")
      // and should be preserved, not removed
      const hasTrailingSpaceAfterHyphen = /[-\u00AD\u2010\u2011]\s+$/.test(
        prevLine.text
      );
      const nextStartsWithLowercase = /^[a-z]/.test(currentText.trimStart());
      const isWordBreakHyphen =
        options.removeHyphens &&
        !sameVisualLine && // Only treat as word break if on different visual lines
        endsWithHyphen(result.trimEnd()) &&
        (hasTrailingSpaceAfterHyphen ||
          isFullWidthLine(prevLine, block, options) ||
          nextStartsWithLowercase);

      if (isWordBreakHyphen) {
        // Remove the trailing hyphen and join directly (no space)
        result = result.trimEnd().slice(0, -1);

        // Update previous span positions that extend past the trimmed length
        for (let j = i - 1; j >= 0; j--) {
          const sp = spanPositions.get(j);
          if (sp && sp.end > result.length) {
            if (sp.start >= result.length) {
              spanPositions.delete(j);
            } else {
              sp.end = result.length;
            }
          } else {
            break;
          }
        }

        // Update previous font range's end to match trimmed result length
        if (fontRanges.length > 0) {
          const lastRange = fontRanges[fontRanges.length - 1];
          if (lastRange.end > result.length) {
            lastRange.end = result.length;
          }
        }

        const startPos = result.length;
        result += currentText.trimStart();
        spanPositions.set(i, { start: startPos, end: result.length });
        fontRanges.push({
          start: startPos,
          end: result.length,
          size: Math.round(currentLine.font.size * 10) / 10,
          weight: getFontWeight(currentLine),
          italic: getFontItalic(currentLine),
        });
      } else {
        // Join lines - add space if needed between words
        // MuPDF inserts spaces between words WITHIN a line based on character positioning,
        // but NOT between lines. When text wraps to a new line, we need to add the space.

        // IMPORTANT: Check for whitespace BEFORE trimming - this tells us if MuPDF
        // intended a space between these words (e.g., italic text in the middle of a sentence)
        const prevHadTrailingSpace = /\s$/.test(result);
        const currHadLeadingSpace = /^\s/.test(currentText);

        // First, normalize trailing whitespace to avoid double spaces
        // MuPDF sometimes includes trailing spaces on lines, which would cause
        // multiple consecutive spaces when joining
        const trimmedResult = result.trimEnd();
        if (trimmedResult.length < result.length) {
          result = trimmedResult;
          // Update font ranges that extend past the trimmed length
          for (let j = fontRanges.length - 1; j >= 0; j--) {
            const fr = fontRanges[j];
            if (fr.end > result.length) {
              if (fr.start >= result.length) {
                fontRanges.splice(j, 1);
              } else {
                fr.end = result.length;
              }
            } else {
              break;
            }
          }
          // Update span positions that extend past the trimmed length
          for (let j = i - 1; j >= 0; j--) {
            const sp = spanPositions.get(j);
            if (sp && sp.end > result.length) {
              if (sp.start >= result.length) {
                spanPositions.delete(j);
              } else {
                sp.end = result.length;
              }
            } else {
              break;
            }
          }
        }

        // Also trim leading whitespace from current text to normalize
        const trimmedCurrentText = currentText.trimStart();
        const leadingTrimmed = currentText.length - trimmedCurrentText.length;

        const prevEndsWithSpace = /\s$/.test(result);
        const currStartsWithSpace = /^\s/.test(trimmedCurrentText);

        // Detect mid-word line breaks using Y position AND X gap
        // If two MuPDF "lines" have the same Y position AND are close together (small X gap),
        // it's a word split and should be joined without a space.
        // If they have the same Y but a larger gap, they're separate words needing a space.
        //
        // IMPORTANT: If MuPDF included whitespace at the boundary (trailing space on prev line
        // or leading space on current line), respect that - it indicates separate words.
        // Only apply word-split detection when there's NO whitespace hint from MuPDF.
        let isWordSplit = false;
        const fontSize = prevLine.font.size || 12;

        if (sameVisualLine && !prevHadTrailingSpace && !currHadLeadingSpace) {
          // Check X gap to distinguish word splits from separate words
          // Only apply this heuristic when MuPDF didn't provide whitespace hints
          const prevEndX = prevLine.bbox.x + prevLine.bbox.w;
          const currStartX = currentLine.bbox.x;
          const xGap = currStartX - prevEndX;

          // Typical space width is ~25-33% of font size
          // If gap is less than ~20% of font size, it's likely a word split (no space)
          // If gap is larger, they're separate words (need space)
          const wordSplitThreshold = fontSize * 0.2;

          isWordSplit = xGap < wordSplitThreshold;
        }

        const needsSpace =
          !prevEndsWithSpace &&
          !currStartsWithSpace &&
          !isWordSplit &&
          result.length > 0 &&
          trimmedCurrentText.length > 0;

        if (needsSpace) {
          result += " ";
        }
        const startPos = result.length;
        result += trimmedCurrentText;
        spanPositions.set(i, { start: startPos, end: result.length });
        fontRanges.push({
          start: startPos,
          end: result.length,
          size: Math.round(currentLine.font.size * 10) / 10,
          weight: getFontWeight(currentLine),
          italic: getFontItalic(currentLine),
        });
      }
    }
  }

  // Apply ligature repair to the text
  // We need to track how positions shift during repair
  const originalText = result;
  const repairedText = repairLigatures(result);

  // If ligature repair changed the text, we need to adjust positions
  if (originalText !== repairedText) {
    // Build a character mapping from original to repaired positions
    // For simplicity, we'll rebuild positions by finding where each span's text appears
    // after repair, but constrained to the original position range
    const adjustedPositions = new Map<number, { start: number; end: number }>();

    for (const [spanIdx, pos] of spanPositions) {
      const spanText = block.lines[spanIdx].text.trim();
      if (spanText.length === 0) continue;

      // The repaired text for this span
      const repairedSpanText = repairLigatures(spanText);

      // Find this text in the repaired result, starting near original position
      const searchStart = Math.max(0, pos.start - 10);
      const searchEnd = Math.min(repairedText.length, pos.end + 50);
      const searchRegion = repairedText.slice(searchStart, searchEnd);

      const localPos = searchRegion.indexOf(repairedSpanText);
      if (localPos !== -1) {
        adjustedPositions.set(spanIdx, {
          start: searchStart + localPos,
          end: searchStart + localPos + repairedSpanText.length,
        });
      } else {
        // Fallback: estimate position based on relative offset
        const ratio = repairedText.length / originalText.length;
        adjustedPositions.set(spanIdx, {
          start: Math.round(pos.start * ratio),
          end: Math.round(pos.end * ratio),
        });
      }
    }

    // Adjust font ranges using same ratio-based approach
    const ratio = repairedText.length / originalText.length;
    const adjustedFontRanges: FontRange[] = fontRanges.map((fr) => ({
      ...fr,
      start: Math.round(fr.start * ratio),
      end: Math.round(fr.end * ratio),
    }));

    return {
      text: repairedText,
      spanPositions: adjustedPositions,
      fontRanges: adjustedFontRanges,
    };
  }

  return { text: result, spanPositions, fontRanges };
}
