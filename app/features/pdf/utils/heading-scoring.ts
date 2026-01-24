/**
 * Block-level heading candidate detection with scoring.
 * Stage 1 of two-stage heading detection.
 */

import type { StructuredBlock, BlockHeadingCandidate, OutlineEntry } from "../types";
import { DEBUG_HEADING, DEBUG_HEADING_PATTERN, OUTLINE_MATCH_BONUS } from "./pdf-utils-common";
import { extractHeadingPattern, isSpecialKeywordHeading } from "./heading-patterns";
import { matchHeadingToOutline } from "./heading-detection";

// ============================================================================
// SCORING CONSTANTS
// ============================================================================

/**
 * Scoring weights for heading candidate detection.
 * A block is a candidate if total score >= HEADING_SCORE_THRESHOLD
 */
export const HEADING_SCORE_WEIGHTS = {
  PATTERN_NUMBERED: 30, // "1.", "Chapter 1", "1.2.3" etc.
  PATTERN_KEYWORD: 25, // "Introduction", "Conclusion", etc.
  FONT_SIZE_LARGE: 25, // Significantly larger than body text (≥1.3x)
  FONT_SIZE_MEDIUM: 15, // Moderately larger than body text (≥1.1x)
  FONT_WEIGHT_BOLD: 20, // Bold text
  FONT_ITALIC: 10, // Italic text (common for subheadings)
  VERTICAL_GAP_LARGE: 20, // Large gap before block (>2x line height)
  VERTICAL_GAP_MEDIUM: 10, // Medium gap (>1.5x line height)
  SHORT_LINE: 5, // Single line, not paragraph-length
};

export const HEADING_SCORE_THRESHOLD = 40;

// ============================================================================
// BLOCK TEXT EXTRACTION
// ============================================================================

/**
 * Get the first line of text from a block (for heading detection)
 */
export function getFirstLineText(block: StructuredBlock): string {
  if (block.lines.length === 0) return "";
  return block.lines[0].text.trim();
}

/**
 * Get the full heading text from a block by extending from first line
 * while subsequent lines have matching font (size, weight, italic).
 * This handles multi-line headings that wrap across lines.
 */
export function getHeadingTextFromBlock(block: StructuredBlock): {
  text: string;
  lineCount: number;
} {
  if (block.lines.length === 0) return { text: "", lineCount: 0 };

  const firstLine = block.lines[0];
  const firstFont = {
    size: Math.round(firstLine.font.size * 10) / 10,
    weight: firstLine.font.weight,
    italic:
      firstLine.font.style === "italic" ||
      firstLine.font.name?.toLowerCase().includes("italic") ||
      firstLine.font.name?.toLowerCase().includes("oblique") ||
      false,
  };

  // Collect all consecutive lines with matching font
  const headingLines: string[] = [firstLine.text.trim()];

  for (let i = 1; i < block.lines.length; i++) {
    const line = block.lines[i];
    const lineFont = {
      size: Math.round(line.font.size * 10) / 10,
      weight: line.font.weight,
      italic:
        line.font.style === "italic" ||
        line.font.name?.toLowerCase().includes("italic") ||
        line.font.name?.toLowerCase().includes("oblique") ||
        false,
    };

    // Check if font matches first line
    const fontMatches =
      lineFont.size === firstFont.size &&
      lineFont.weight === firstFont.weight &&
      lineFont.italic === firstFont.italic;

    if (fontMatches && line.text.trim().length > 0) {
      headingLines.push(line.text.trim());
    } else {
      break; // Font changed or empty line, stop extending
    }
  }

  return {
    text: headingLines.join(" "),
    lineCount: headingLines.length,
  };
}

// ============================================================================
// FONT ANALYSIS
// ============================================================================

/**
 * Get the dominant font size from a block (first line's size)
 */
export function getDominantFontSize(block: StructuredBlock): number {
  if (block.lines.length === 0) return 12;
  return block.lines[0].font.size;
}

/**
 * Check if the block's dominant font is bold
 */
export function isDominantBold(block: StructuredBlock): boolean {
  if (block.lines.length === 0) return false;
  return block.lines[0].font.weight === "bold";
}

/**
 * Check if the block's dominant font is italic
 */
export function isDominantItalic(block: StructuredBlock): boolean {
  if (block.lines.length === 0) return false;
  const font = block.lines[0].font;
  return (
    font.style === "italic" ||
    font.name?.toLowerCase().includes("italic") ||
    font.name?.toLowerCase().includes("oblique") ||
    false
  );
}

/**
 * Estimate line height from a block
 */
export function estimateLineHeight(block: StructuredBlock): number {
  if (block.lines.length === 0) return 12;
  // Use font size as approximation, typical line height is 1.2x font size
  return block.lines[0].font.size * 1.2;
}

// ============================================================================
// HEADING CANDIDATE DETECTION
// ============================================================================

/**
 * Detect if a block is a heading candidate based on scoring.
 * Stage 1 of two-stage heading detection - runs at block level where
 * we have access to vertical gaps, italic, and other signals.
 *
 * @param block The block to evaluate
 * @param prevBlock Previous block (for gap calculation)
 * @param bodyFontSize The document's body text font size
 * @param textPosition Starting position in joined text
 * @param pdfOutline Optional PDF outline entries for bonus scoring
 * @returns HeadingCandidate if score >= threshold, null otherwise
 */
export function detectBlockHeadingCandidate(
  block: StructuredBlock,
  prevBlock: StructuredBlock | null,
  bodyFontSize: number,
  textPosition: number,
  pdfOutline: OutlineEntry[] = []
): BlockHeadingCandidate | null {
  const firstLineText = getFirstLineText(block);

  if (!firstLineText) {
    return null; // Empty block
  }

  // Get full heading text early - needed for pattern matching on multi-line headings
  // (e.g., "1" on line 1, "Introduction" on line 2 → "1 Introduction")
  const { text: fullHeadingText, lineCount } = getHeadingTextFromBlock(block);

  // Debug: log if this block might contain our target pattern
  if (
    DEBUG_HEADING &&
    fullHeadingText.toLowerCase().includes(DEBUG_HEADING_PATTERN)
  ) {
    console.log(
      `[detectBlockHeadingCandidate] Block with "${fullHeadingText.slice(0, 60)}"`
    );
    console.log(
      `  lines: ${block.lines.length}, headingLines: ${lineCount}, fullText: "${fullHeadingText}"`
    );
  }

  // Length check on full heading text
  if (fullHeadingText.length > 200) {
    return null; // Too long for a heading
  }

  let score = 0;
  const factors: string[] = [];

  // 1. Pattern matching (numbered/keyword) - use full heading text for multi-line headings
  const patternMatch = extractHeadingPattern(fullHeadingText);
  if (patternMatch) {
    score += HEADING_SCORE_WEIGHTS.PATTERN_NUMBERED;
    factors.push(`pattern-${patternMatch.type}`);
  } else if (isSpecialKeywordHeading(fullHeadingText)) {
    score += HEADING_SCORE_WEIGHTS.PATTERN_KEYWORD;
    factors.push("pattern-keyword");
  }

  // 2. Font size comparison
  const blockFontSize = getDominantFontSize(block);
  if (bodyFontSize > 0) {
    const sizeRatio = blockFontSize / bodyFontSize;
    if (sizeRatio >= 1.3) {
      score += HEADING_SCORE_WEIGHTS.FONT_SIZE_LARGE;
      factors.push(`font-large(${sizeRatio.toFixed(2)}x)`);
    } else if (sizeRatio >= 1.1) {
      score += HEADING_SCORE_WEIGHTS.FONT_SIZE_MEDIUM;
      factors.push(`font-medium(${sizeRatio.toFixed(2)}x)`);
    }
  }

  // 3. Font weight (bold)
  if (isDominantBold(block)) {
    score += HEADING_SCORE_WEIGHTS.FONT_WEIGHT_BOLD;
    factors.push("font-bold");
  }

  // 4. Italic
  if (isDominantItalic(block)) {
    score += HEADING_SCORE_WEIGHTS.FONT_ITALIC;
    factors.push("font-italic");
  }

  // 5. Vertical gap before block
  let verticalGapBefore = 0;
  if (prevBlock) {
    const gap = block.bbox.y - (prevBlock.bbox.y + prevBlock.bbox.h);
    verticalGapBefore = gap;
    const lineHeight = estimateLineHeight(block);
    if (gap > lineHeight * 2) {
      score += HEADING_SCORE_WEIGHTS.VERTICAL_GAP_LARGE;
      factors.push(`gap-large(${(gap / lineHeight).toFixed(1)}x)`);
    } else if (gap > lineHeight * 1.5) {
      score += HEADING_SCORE_WEIGHTS.VERTICAL_GAP_MEDIUM;
      factors.push(`gap-medium(${(gap / lineHeight).toFixed(1)}x)`);
    }
  }

  // 6. Short line bonus (headings are usually not paragraph-length)
  if (fullHeadingText.length < 100) {
    score += HEADING_SCORE_WEIGHTS.SHORT_LINE;
    factors.push("short-line");
  }

  // 7. PDF Outline match bonus
  // If this text matches an entry in the PDF's embedded outline, it's very likely a heading
  let outlineMatch = null;
  if (pdfOutline.length > 0) {
    outlineMatch = matchHeadingToOutline(fullHeadingText, textPosition, pdfOutline, []);
    if (outlineMatch) {
      score += OUTLINE_MATCH_BONUS;
      factors.push(`outline-match(${outlineMatch.matchConfidence})`);
    }
  }

  // Debug logging for target pattern
  if (
    DEBUG_HEADING &&
    fullHeadingText.toLowerCase().includes(DEBUG_HEADING_PATTERN)
  ) {
    console.log(
      `[HeadingCandidate] "${fullHeadingText.slice(0, 60)}${
        fullHeadingText.length > 60 ? "..." : ""
      }"`
    );
    console.log(
      `  score=${score} (threshold=${HEADING_SCORE_THRESHOLD}) factors=[${factors.join(", ")}]`
    );
    console.log(
      `  font: ${blockFontSize}/${isDominantBold(block) ? "bold" : "normal"}, bodyFontSize: ${bodyFontSize}`
    );
    if (pdfOutline.length > 0) {
      console.log(
        `  outline: ${outlineMatch ? `MATCHED "${outlineMatch.outlineEntry.title}"` : "no match"} (${pdfOutline.length} entries)`
      );
    }
    console.log(
      `  result: ${score >= HEADING_SCORE_THRESHOLD ? "ACCEPTED" : "REJECTED"}`
    );
  }

  if (score >= HEADING_SCORE_THRESHOLD) {
    return {
      textStart: textPosition,
      textEnd: textPosition + fullHeadingText.length,
      text: fullHeadingText,
      score,
      factors,
      fontSize: blockFontSize,
      fontWeight: isDominantBold(block) ? "bold" : "normal",
      italic: isDominantItalic(block),
      verticalGapBefore,
      lineCount,
    };
  }

  return null;
}
