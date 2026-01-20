/**
 * Font-based superscript identification utilities.
 * Functions for detecting superscript text based on font size and position.
 */

import type { StructuredLine, StructuredBlock } from "../types";
import type { ProcessedBlockResult } from "./text-joining";

// ============================================================================
// CONSTANTS
// ============================================================================

// Font-based superscript detection thresholds
const SUPERSCRIPT_FONT_RATIO = 0.78; // Font must be < 78% of average
const SUPERSCRIPT_MAX_LENGTH = 20; // Max characters for superscript (allows "104,105,106,107")

// ============================================================================
// FONT SIZE CHECKS
// ============================================================================

/**
 * Check if a span has superscript-sized font (smaller than block dominant)
 */
function isSmallFontSpan(
  span: StructuredLine,
  blockDominantSize: number
): boolean {
  const currentSize = span.font.size;
  if (currentSize <= 0) return false;

  // Must be significantly smaller than block dominant (< 78%)
  const ratio = currentSize / blockDominantSize;
  return ratio < SUPERSCRIPT_FONT_RATIO;
}

/**
 * Validate that a superscript group is actually adjacent to normal-sized text.
 * This prevents false positives like "25" in "Article 25" where the whole region is same size.
 */
function isValidSuperscriptGroup(
  lines: StructuredLine[],
  groupStartIdx: number,
  groupEndIdx: number,
  blockDominantSize: number
): boolean {
  // Get the spans just before and after the group
  const prevSpan = groupStartIdx > 0 ? lines[groupStartIdx - 1] : null;
  const nextSpan =
    groupEndIdx < lines.length - 1 ? lines[groupEndIdx + 1] : null;

  // Get the average size of the group
  const groupSpans = lines.slice(groupStartIdx, groupEndIdx + 1);
  const groupAvgSize =
    groupSpans.reduce((sum, s) => sum + s.font.size, 0) / groupSpans.length;

  // The group must be adjacent to at least one normal-sized span
  // (a span that's >= 90% of block dominant)
  const prevIsNormal =
    prevSpan && prevSpan.font.size >= blockDominantSize * 0.9;
  const nextIsNormal =
    nextSpan && nextSpan.font.size >= blockDominantSize * 0.9;

  if (!prevIsNormal && !nextIsNormal) {
    // No normal-sized neighbor - this might be a region of uniformly small text, not superscripts
    // But allow if at start/end of block (no neighbor to check)
    if (prevSpan && nextSpan) {
      return false;
    }
  }

  // Also verify the group is actually smaller than at least one neighbor
  const sameAsPrev = prevSpan && groupAvgSize >= prevSpan.font.size * 0.95;
  const sameAsNext = nextSpan && groupAvgSize >= nextSpan.font.size * 0.95;

  if (sameAsPrev && sameAsNext) {
    // Group is same size as both neighbors - not a superscript
    return false;
  }

  return true;
}

// ============================================================================
// POSITION CHECKS
// ============================================================================

/**
 * Check if a span is positioned as superscript (raised above baseline).
 *
 * A true superscript should be:
 * 1. On the same visual line as adjacent text
 * 2. Raised above the baseline (smaller Y value = higher on page)
 *
 * This rejects:
 * - Subscripts (below baseline)
 * - Same-baseline small text (not raised)
 */
function isSuperscriptPosition(
  span: StructuredLine,
  prevSpan: StructuredLine | null
): boolean {
  if (!prevSpan) return true; // No reference, assume ok

  const currentY = span.bbox.y;
  const prevY = prevSpan.bbox.y;

  // Must be on roughly the same visual line (within 10pt vertically)
  const sameVisualLine = Math.abs(currentY - prevY) < 10;

  if (!sameVisualLine) {
    // Different line entirely - not an inline superscript
    return false;
  }

  // For same-line spans, reject only if clearly BELOW baseline (subscript)
  // In PDF coordinates, larger Y = lower on page
  // Allow same baseline or raised (superscript), reject if more than 2pt below (subscript like CO₂)
  if (currentY > prevY + 2) {
    // More than 2pt below baseline - likely a subscript
    return false;
  }

  return true;
}

// ============================================================================
// CONTEXT VALIDATION
// ============================================================================

/**
 * Check if text is an ordinal suffix (st, nd, rd, th) following a number.
 * Examples: 1st, 2nd, 3rd, 4th, 21st, 22nd, 23rd, 40th
 * Also handles "40 th" with space between number and suffix.
 */
function isOrdinalSuffix(
  text: string,
  position: number,
  superscriptText: string
): boolean {
  const lowerText = superscriptText.toLowerCase().trim();

  // Check if it's an ordinal suffix
  if (!["st", "nd", "rd", "th"].includes(lowerText)) {
    return false;
  }

  // Look back past any whitespace to find a digit
  let checkPos = position - 1;
  while (checkPos >= 0 && /\s/.test(text[checkPos])) {
    checkPos--;
  }

  if (checkPos >= 0 && /\d/.test(text[checkPos])) {
    return true; // It's an ordinal like "1st", "2nd", "40 th", etc.
  }

  return false;
}

/**
 * Check if the word preceding a superscript position is too short (1-2 chars).
 * Short words like "a", "I", "to", "of" followed by small numbers are unlikely to be citations.
 */
function hasTooShortPrecedingWord(text: string, position: number): boolean {
  if (position === 0) return false;

  // Find the end of the preceding word (skip any whitespace before the superscript)
  let wordEnd = position - 1;
  while (wordEnd >= 0 && /\s/.test(text[wordEnd])) {
    wordEnd--;
  }

  if (wordEnd < 0) return false;

  // Find the start of the preceding word
  let wordStart = wordEnd;
  while (wordStart > 0 && /[a-zA-Z]/.test(text[wordStart - 1])) {
    wordStart--;
  }

  // Check if the character at wordStart is a letter (word boundary)
  if (!/[a-zA-Z]/.test(text[wordStart])) {
    return false; // Not preceded by a word
  }

  const wordLength = wordEnd - wordStart + 1;
  return wordLength <= 2;
}

/**
 * Check if a superscript position is preceded by text on the same line.
 * Superscripts should follow words (like "word¹"), not appear at start of lines.
 */
function hasPrecedingTextOnSameLine(text: string, position: number): boolean {
  if (position === 0) return false; // At very start of block

  // Look backwards from position to find if there's non-whitespace before the next newline
  for (let i = position - 1; i >= 0; i--) {
    const char = text[i];
    if (char === "\n") {
      return false; // Hit a newline before finding any text - this is start of line
    }
    if (!/\s/.test(char)) {
      return true; // Found non-whitespace text before any newline
    }
  }

  return false; // Only whitespace before position (start of block)
}

/**
 * Check if a position in text is part of a number (decimal, thousands separator, or embedded in larger number).
 * This helps exclude false positives like "0.5", "1,000", or digits in the MIDDLE of "2014".
 *
 * For font-based superscripts, we want to:
 * - Block: "5" in "50" (followed by digit), "0" in "2070" (surrounded by digits), "000" in "1,000"
 * - Allow: "1" after "2070" (preceded by digit but NOT followed by digit) - this is a real superscript
 * - Allow: "2" in "1,2,3" (reference list, not thousands separator)
 * - Allow: "2" in "CO2" (subscript after letters)
 */
function isPartOfNumber(
  text: string,
  position: number,
  length: number,
  prevSpanIsNormal: boolean = false
): boolean {
  const prevChar = position > 0 ? text[position - 1] : "";
  const nextChar =
    position + length < text.length ? text[position + length] : "";

  // If preceded by a letter, it's likely a subscript (CO2, H2O) - allow it
  if (/[a-zA-Z]/.test(prevChar)) {
    return false;
  }

  // Decimal: "0.5" → the "5" should not be flagged
  // But if the period is normal-sized (not superscript), it can't be a decimal
  // In "0.5" as superscript, the whole thing would be small font
  // In "sentence. 3", only the "3" is superscript, so the "." is normal
  if (prevChar === ".") {
    if (prevSpanIsNormal) {
      return false;
    }
    return true;
  }

  // Thousands separator: "1,000" → block only if it's exactly 3 digits after comma
  // Don't block "1,2,3" reference lists (1-2 digits between commas)
  if (prevChar === ",") {
    // Check if this looks like a thousands separator (3 digits after comma, then non-digit or end)
    const afterComma = text.slice(position, position + 4);
    if (/^\d{3}(?:\D|$)/.test(afterComma)) {
      return true; // Thousands separator like "1,000"
    }
    // Otherwise it's likely a reference list like "1,2,3" - don't block
  }

  // Part of larger number: only skip if BOTH preceded AND followed by digits
  // This catches "0" in "2070" but allows "1" at the end of "word1" or "2070¹"
  const prevIsDigit = /\d/.test(prevChar);
  const nextIsDigit = /\d/.test(nextChar);

  if (prevIsDigit && nextIsDigit) {
    return true; // Middle of a number like "2070"
  }

  return false;
}

// ============================================================================
// SPAN IDENTIFICATION
// ============================================================================

/**
 * Identify which span indices are superscripts.
 * Returns a Set of span indices that should be treated as superscripts.
 */
function identifySuperscriptSpans(
  lines: StructuredLine[],
  blockDominantSize: number
): Set<number> {
  const superscriptIndices = new Set<number>();
  if (lines.length === 0) return superscriptIndices;

  // Step 1: Mark each span as small-font or not
  const isSmall: boolean[] = [];
  for (let i = 0; i < lines.length; i++) {
    const small = isSmallFontSpan(lines[i], blockDominantSize);
    isSmall.push(small);
  }

  // Step 2: Find consecutive runs of small-font spans and validate them
  let groupStart: number | null = null;

  const finalizeGroup = (startIdx: number, endIdx: number) => {
    // Validate that this group is actually adjacent to normal-sized text
    const isValid = isValidSuperscriptGroup(
      lines,
      startIdx,
      endIdx,
      blockDominantSize
    );

    if (isValid) {
      // Add all span indices in this group
      for (let i = startIdx; i <= endIdx; i++) {
        superscriptIndices.add(i);
      }
    }
  };

  for (let i = 0; i < lines.length; i++) {
    if (isSmall[i]) {
      // Check position (not subscript)
      const prevNormalSpan =
        groupStart !== null
          ? groupStart > 0
            ? lines[groupStart - 1]
            : null
          : i > 0
          ? lines[i - 1]
          : null;

      const isSuperPos = isSuperscriptPosition(lines[i], prevNormalSpan);

      if (isSuperPos) {
        if (groupStart === null) {
          groupStart = i;
        }
        // Continue the group
      } else {
        // Subscript - end current group if any
        if (groupStart !== null) {
          finalizeGroup(groupStart, i - 1);
          groupStart = null;
        }
      }
    } else {
      // Normal font - end current group if any
      if (groupStart !== null) {
        finalizeGroup(groupStart, i - 1);
        groupStart = null;
      }
    }
  }
  // Don't forget last group
  if (groupStart !== null) {
    finalizeGroup(groupStart, lines.length - 1);
  }

  return superscriptIndices;
}

// ============================================================================
// MAIN DETECTION FUNCTION
// ============================================================================

/**
 * Calculate the dominant (most frequent) font size within a block.
 * This is the reference for detecting superscripts in this block.
 */
export function getBlockDominantFontSize(
  lines: StructuredLine[],
  fallback: number
): number {
  if (lines.length === 0) return fallback;

  // Count font sizes (rounded to 1pt)
  const fontCounts = new Map<number, number>();
  for (const line of lines) {
    if (line.font.size > 0) {
      const rounded = Math.round(line.font.size);
      fontCounts.set(rounded, (fontCounts.get(rounded) || 0) + 1);
    }
  }

  if (fontCounts.size === 0) return fallback;

  // Find the largest font size with significant occurrence
  // (Use the max font size that appears at least twice, or the overall max)
  let dominantSize = fallback;
  let maxSize = 0;

  for (const [size, count] of fontCounts) {
    if (size > maxSize) {
      maxSize = size;
    }
    if (count >= 2 && size > dominantSize) {
      dominantSize = size;
    }
  }

  // If no font appears twice, use the largest font in the block
  if (dominantSize === fallback) {
    dominantSize = maxSize;
  }

  return dominantSize;
}

/**
 * Find font-based superscript positions within a block's text.
 * Uses tracked span positions for stable matching (no text searching).
 *
 * @param block - The structured block with span data
 * @param processedResult - The processed block text with position tracking
 * @param documentAvgFontSize - Fallback font size for reference
 */
export function findFontBasedSuperscripts(
  block: StructuredBlock,
  processedResult: ProcessedBlockResult,
  documentAvgFontSize: number
): Array<{ start: number; end: number }> {
  const lines = block.lines;
  if (lines.length === 0) return [];

  const blockText = processedResult.text;
  const spanPositions = processedResult.spanPositions;

  // Use the dominant font size of THIS block as reference
  const blockDominantSize = getBlockDominantFontSize(
    lines,
    documentAvgFontSize
  );

  // Identify which spans are superscripts (using the extracted function)
  const superscriptIndices = identifySuperscriptSpans(lines, blockDominantSize);

  // Convert superscript span indices to text positions using tracked positions
  const superscripts: Array<{ start: number; end: number }> = [];

  // Group consecutive superscript spans for combined position
  const sortedIndices = [...superscriptIndices].sort((a, b) => a - b);
  let groupStart: number | null = null;
  let groupEnd: number | null = null;

  const processGroup = () => {
    if (groupStart === null || groupEnd === null) return;

    // Get positions from tracked span positions
    const startPos = spanPositions.get(groupStart);
    const endPos = spanPositions.get(groupEnd);

    if (!startPos || !endPos) {
      return;
    }

    const start = startPos.start;
    const end = endPos.end;
    const length = end - start;
    const groupText = blockText.slice(start, end).trim();

    if (groupText.length === 0 || groupText.length > SUPERSCRIPT_MAX_LENGTH) {
      return;
    }

    // Skip if not preceded by text on the same line
    // Superscripts should follow words (like "word¹"), not appear at start of lines
    if (!hasPrecedingTextOnSameLine(blockText, start)) {
      return;
    }

    // Context validation: skip if this is part of a larger number
    // Check if previous span is normal-sized (not in superscriptIndices)
    const prevSpanIsNormal =
      groupStart! > 0 && !superscriptIndices.has(groupStart! - 1);
    if (isPartOfNumber(blockText, start, length, prevSpanIsNormal)) {
      return;
    }

    // Skip ordinal suffixes (1st, 2nd, 3rd, 4th, 21st, etc.)
    if (isOrdinalSuffix(blockText, start, groupText)) {
      return;
    }

    // Skip if preceding word is too short (1-2 chars) - unlikely to be a citation
    if (hasTooShortPrecedingWord(blockText, start)) {
      return;
    }

    superscripts.push({ start, end });
  };

  for (const idx of sortedIndices) {
    if (groupStart === null) {
      groupStart = idx;
      groupEnd = idx;
    } else if (idx === groupEnd! + 1) {
      // Consecutive span, extend group
      groupEnd = idx;
    } else {
      // Non-consecutive, finalize previous group and start new one
      processGroup();
      groupStart = idx;
      groupEnd = idx;
    }
  }
  // Don't forget the last group
  processGroup();

  return superscripts;
}
