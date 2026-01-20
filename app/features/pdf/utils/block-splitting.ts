/**
 * Font boundary detection and block preprocessing utilities.
 * Functions for splitting PDF blocks at significant font boundaries.
 */

import type { StructuredPage, StructuredBlock, StructuredLine } from "../types";
import {
  FONT_SPLIT_THRESHOLD,
  FontSignature,
  getFontSignatureKey,
} from "./pdf-utils-common";

// ============================================================================
// BLOCK SPLITTING
// ============================================================================

/**
 * Split MuPDF blocks at significant font boundaries.
 *
 * MuPDF groups lines into blocks based on spatial proximity, not semantic meaning.
 * This can result in headings being grouped with body text in the same block.
 *
 * This function pre-processes pages to split blocks where there's a significant
 * font change between consecutive lines (indicating a semantic boundary like
 * a heading transition).
 *
 * @param pages - Pages with MuPDF-extracted blocks
 * @returns Pages with blocks split at font boundaries
 */
export function splitBlocksByFontBoundary(
  pages: StructuredPage[]
): StructuredPage[] {
  return pages.map((page) => {
    const newBlocks: StructuredBlock[] = [];

    for (const block of page.blocks) {
      if (block.lines.length <= 1) {
        // Single-line blocks don't need splitting
        newBlocks.push(block);
        continue;
      }

      // Find split points based on font changes
      const splitIndices: number[] = [];

      // Track visual rows to compute minX for X-based splitting
      // A visual row is a group of line fragments on the same Y position
      // We need this because MuPDF may fragment a single visual line into multiple "lines"
      // and the X position of a fragment may be at the end of the line, not the start
      let currentVisualRowY = block.lines[0].bbox.y;
      let currentVisualRowMinX =
        block.lines[0].font.size >= 7 ? block.lines[0].bbox.x : Infinity;
      const Y_TOLERANCE_FACTOR = 0.3; // Lines within 30% of font height are on same row

      for (let i = 1; i < block.lines.length; i++) {
        const currLine = block.lines[i];

        // Find the last non-whitespace line as the "real" previous line
        // This handles MuPDF creating empty whitespace lines that absorb visual gaps
        let prevLine = block.lines[i - 1];
        let prevLineIdx = i - 1;
        while (prevLineIdx > 0 && prevLine.text.trim().length === 0) {
          prevLineIdx--;
          prevLine = block.lines[prevLineIdx];
        }

        // Check if prevLine is on the same visual row - update minX tracking
        const avgFontHeight = (prevLine.bbox.h + currLine.bbox.h) / 2;
        const yTolerance = avgFontHeight * Y_TOLERANCE_FACTOR;
        const prevLineY = prevLine.bbox.y;

        // If prevLine is on a different visual row than what we're tracking, reset
        if (Math.abs(prevLineY - currentVisualRowY) > yTolerance) {
          currentVisualRowY = prevLineY;
          currentVisualRowMinX = Infinity;
        }

        // Update minX for the current visual row (ignore superscripts with small font)
        if (prevLine.font.size >= 7 && prevLine.bbox.x < currentVisualRowMinX) {
          currentVisualRowMinX = prevLine.bbox.x;
        }

        // Get the visualLineMinX to pass to shouldSplitAtLine
        const visualLineMinX =
          currentVisualRowMinX === Infinity ? undefined : currentVisualRowMinX;

        // Check for significant font change
        if (shouldSplitAtLine(prevLine, currLine, visualLineMinX)) {
          splitIndices.push(i);
          // After a split, reset visual row tracking to the current line
          currentVisualRowY = currLine.bbox.y;
          currentVisualRowMinX =
            currLine.font.size >= 7 ? currLine.bbox.x : Infinity;
        }
      }

      if (splitIndices.length === 0) {
        // No splits needed
        newBlocks.push(block);
        continue;
      }

      // Split the block at the identified indices
      let startIdx = 0;
      for (const splitIdx of splitIndices) {
        if (splitIdx > startIdx) {
          const segmentLines = block.lines.slice(startIdx, splitIdx);
          newBlocks.push(createBlockFromLines(block, segmentLines));
        }
        startIdx = splitIdx;
      }

      // Add remaining lines after last split
      if (startIdx < block.lines.length) {
        const segmentLines = block.lines.slice(startIdx);
        newBlocks.push(createBlockFromLines(block, segmentLines));
      }
    }

    return {
      ...page,
      blocks: newBlocks,
    };
  });
}

/**
 * Determine if we should split between two consecutive lines.
 *
 * We split when:
 * - Font size changes significantly (>1.5pt difference)
 * - Font weight changes (bold → normal or normal → bold)
 * - Large vertical gap between lines (> 1.5x font height)
 * - Significant X position change (alignment change, only when on different lines)
 *
 * We avoid splitting for:
 * - Superscripts/subscripts (very small font, usually <7pt)
 * - Minor size variations within body text
 *
 * @param prevLine - The previous line
 * @param currLine - The current line being evaluated
 * @param visualLineMinX - The minimum X of all lines on the same visual row as prevLine
 *                         (used for X-based splitting to handle fragmented lines)
 */
function shouldSplitAtLine(
  prevLine: StructuredLine,
  currLine: StructuredLine,
  visualLineMinX?: number
): boolean {
  const prevSize = prevLine.font.size;
  const currSize = currLine.font.size;
  const prevWeight = prevLine.font.weight;
  const currWeight = currLine.font.weight;

  // Skip if either line looks like a superscript/subscript (very small)
  if (prevSize < 7 || currSize < 7) {
    return false;
  }

  // Skip if the current line is mostly whitespace (empty line separator)
  if (currLine.text.trim().length < 2) {
    return false;
  }

  // Calculate font size difference
  const sizeDiff = Math.abs(currSize - prevSize);

  // Split if significant size change
  if (sizeDiff >= FONT_SPLIT_THRESHOLD) {
    return true;
  }

  // Calculate vertical gap between lines
  const prevBottom = prevLine.bbox.y + prevLine.bbox.h;
  const currTop = currLine.bbox.y;
  const verticalGap = currTop - prevBottom;
  const avgFontHeight = (prevLine.bbox.h + currLine.bbox.h) / 2;

  // Check if lines are on different vertical positions (not same line)
  const onDifferentLines = verticalGap > -avgFontHeight * 0.5; // Allow small overlap

  // Split if weight changes from normal to bold (common heading pattern)
  // But only if the sizes are similar (to avoid splitting at inline bold)
  if (prevWeight === "normal" && currWeight === "bold" && sizeDiff < 0.5) {
    // Additional check: the bold line should look like a heading start
    // (starts with number, capital letter, or known keyword)
    const currText = currLine.text.trim();
    const looksLikeHeading =
      /^(\d+[\.\s]|[A-Z][a-z]*\s|Chapter|Section|Part|Abstract|Introduction|Conclusion|References)/i.test(
        currText
      );
    if (looksLikeHeading) {
      return true;
    }
  }

  // Split if weight changes from bold to normal (caption → body transition)
  if (prevWeight === "bold" && currWeight === "normal" && sizeDiff < 0.5) {
    return true;
  }

  // Split if large vertical gap (> 1.5x average font height suggests paragraph break)
  if (onDifferentLines && verticalGap > avgFontHeight * 1.5) {
    return true;
  }

  // Split if significant X position change (alignment change)
  // Only applies when lines are vertically separated (not inline elements)
  // Use visualLineMinX if provided - this handles MuPDF fragmenting lines where
  // prevLine.bbox.x might be the X of a fragment at the end of the line
  // NOTE: Only split when text moves RIGHT (new column/section), not left
  // (moving left usually means returning to margin after first-line indent)
  if (onDifferentLines) {
    const prevLineStartX = visualLineMinX ?? prevLine.bbox.x;
    const xDiff = currLine.bbox.x - prevLineStartX; // Positive = moving right
    // Significant X change: > 30pt or > 20% of line width, AND moving right
    const significantXChange = xDiff > 30 || xDiff > prevLine.bbox.w * 0.2;
    if (significantXChange && verticalGap > 0) {
      return true;
    }
  }

  // Split if current line looks like a figure/table caption AND has sufficient vertical gap
  // This prevents splitting on wrapped inline references like "...presented in\nTable 4"
  // Real captions typically have extra vertical space before them
  const currText = currLine.text.trim();
  const isLegendPattern =
    /^(fig\.?|figure|table|chart|graph|diagram|box|panel|source|note|image|photo|illustration|exhibit|map|scheme|plate|appendix)[\s\u00A0]*\d+/i.test(
      currText
    );
  const hasLegendGap = verticalGap >= avgFontHeight * 0.5;
  if (isLegendPattern && onDifferentLines && hasLegendGap) {
    return true;
  }

  return false;
}

/**
 * Create a new block from a subset of lines, preserving the original block's metadata.
 */
function createBlockFromLines(
  originalBlock: StructuredBlock,
  lines: StructuredLine[]
): StructuredBlock {
  if (lines.length === 0) {
    return { ...originalBlock, lines: [] };
  }

  // Calculate bounding box for the subset of lines
  const minX = Math.min(...lines.map((l) => l.bbox.x));
  const minY = Math.min(...lines.map((l) => l.bbox.y));
  const maxX = Math.max(...lines.map((l) => l.bbox.x + l.bbox.w));
  const maxY = Math.max(...lines.map((l) => l.bbox.y + l.bbox.h));

  return {
    type: originalBlock.type,
    bbox: {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
    },
    lines,
  };
}

// ============================================================================
// FONT SIGNATURE ANALYSIS
// ============================================================================

/**
 * Get the font signature of the first line in a block.
 */
export function getBlockFontSignature(block: StructuredBlock): FontSignature {
  if (block.lines.length === 0) {
    return { size: 0, weight: "normal" };
  }
  const firstLine = block.lines[0];
  return {
    size: Math.round(firstLine.font.size * 10) / 10, // Round to 1 decimal
    weight: firstLine.font.weight,
  };
}

/**
 * Calculate the body text font signature (most common by character count).
 */
export function calculateBodyTextSignature(pages: StructuredPage[]): FontSignature {
  const signatureCounts = new Map<
    string,
    { sig: FontSignature; charCount: number }
  >();

  for (const page of pages) {
    for (const block of page.blocks) {
      for (const line of block.lines) {
        const sig: FontSignature = {
          size: Math.round(line.font.size * 10) / 10,
          weight: line.font.weight,
        };
        const key = getFontSignatureKey(sig);
        const existing = signatureCounts.get(key) || { sig, charCount: 0 };
        existing.charCount += line.text.length;
        signatureCounts.set(key, existing);
      }
    }
  }

  // Find signature with most characters
  let maxCharCount = 0;
  let bodySignature: FontSignature = { size: 12, weight: "normal" };

  for (const { sig, charCount } of signatureCounts.values()) {
    if (charCount > maxCharCount) {
      maxCharCount = charCount;
      bodySignature = sig;
    }
  }

  return bodySignature;
}
