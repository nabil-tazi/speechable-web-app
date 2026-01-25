/**
 * Heading pattern extraction and recognition utilities.
 * Functions for detecting and classifying heading patterns in PDF text.
 */

import type { StructuredPage, StructuredBlock } from "../types";
import { DEBUG_HEADING, DEBUG_HEADING_PATTERNS } from "./pdf-utils-common";

// ============================================================================
// TYPES
// ============================================================================

/** Heading pattern types */
export type HeadingPatternType =
  | "numbered" // 1., 2., 3. or 1, 2, 3
  | "decimal" // 1.1, 1.2, 2.1
  | "roman" // I., II., III.
  | "letter" // A., B., C.
  | "named" // Chapter 1, Section 2
  | "keyword"; // abstract, introduction, etc.

/** Result of extracting a heading pattern */
export interface HeadingPatternResult {
  type: HeadingPatternType;
  numbers: number[];
  level: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Special keywords that are headings regardless of numbering
export const SPECIAL_HEADING_KEYWORDS = [
  "abstract",
  "introduction",
  "conclusion",
  "references",
];

// ============================================================================
// QUOTE NORMALIZATION
// ============================================================================

/**
 * Normalize curly/smart quotes to straight quotes.
 * This simplifies all downstream text processing.
 */
export function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u201C\u201D]/g, '"') // " " → "
    .replace(/[\u2018\u2019]/g, "'"); // ' ' → '
}

/**
 * Apply quote normalization to all text in a page's blocks and lines.
 */
export function normalizePageQuotes(page: StructuredPage): StructuredPage {
  return {
    ...page,
    blocks: page.blocks.map((block) => ({
      ...block,
      lines: block.lines.map((line) => ({
        ...line,
        text: normalizeQuotes(line.text),
      })),
    })),
  };
}

// ============================================================================
// NUMBER CONVERSION UTILITIES
// ============================================================================

/**
 * Convert roman numeral to number
 */
export function romanToNumber(roman: string): number | null {
  const romanValues: Record<string, number> = {
    i: 1,
    v: 5,
    x: 10,
    l: 50,
    c: 100,
    d: 500,
    m: 1000,
  };

  const lower = roman.toLowerCase();
  let result = 0;
  let prevValue = 0;

  for (let i = lower.length - 1; i >= 0; i--) {
    const value = romanValues[lower[i]];
    if (value === undefined) return null;

    if (value < prevValue) {
      result -= value;
    } else {
      result += value;
    }
    prevValue = value;
  }

  return result > 0 ? result : null;
}

/**
 * Convert letter to number (A=1, B=2, etc.)
 */
export function letterToNumber(letter: string): number | null {
  const upper = letter.toUpperCase();
  if (upper.length !== 1 || upper < "A" || upper > "Z") return null;
  return upper.charCodeAt(0) - "A".charCodeAt(0) + 1;
}

// ============================================================================
// HEADING PATTERN EXTRACTION
// ============================================================================

/**
 * Extract heading pattern from text.
 * Returns null if no pattern matches.
 */
export function extractHeadingPattern(text: string): HeadingPatternResult | null {
  const trimmed = text.trim();

  // Debug: Log pattern matching for target heading
  if (DEBUG_HEADING && DEBUG_HEADING_PATTERNS.some(p => p && trimmed.toLowerCase().includes(p.toLowerCase()))) {
    console.log(`[extractHeadingPattern] Input: "${trimmed.slice(0, 80)}"`);
    // Test the numbered pattern specifically
    const numberedMatch = trimmed.match(/^(\d+)\.?\s+\S/);
    console.log(`  Numbered regex match: ${JSON.stringify(numberedMatch)}`);
  }

  // Named patterns: "Chapter 1", "Section 2.1"
  const namedMatch = trimmed.match(
    /^(chapter|section|part)\s+(\d+(?:\.\d+)*)/i
  );
  if (namedMatch) {
    const numParts = namedMatch[2].split(".").map((n) => parseInt(n, 10));
    return { type: "named", numbers: numParts, level: 2 };
  }

  // Decimal patterns: "1.1", "1.1.1", "2.3.4" (with or without trailing dot, followed by text)
  const decimalMatch = trimmed.match(/^(\d+(?:\.\d+)+)\.?\s+\S/);
  if (decimalMatch) {
    const numParts = decimalMatch[1].split(".").map((n) => parseInt(n, 10));
    // Level based on depth: 1.1 = h3, 1.1.1 = h4, etc.
    return { type: "decimal", numbers: numParts, level: numParts.length + 1 };
  }

  // Single number: "1.", "1", "2." (followed by text)
  const numberedMatch = trimmed.match(/^(\d+)\.?\s+\S/);
  if (numberedMatch) {
    const num = parseInt(numberedMatch[1], 10);
    return { type: "numbered", numbers: [num], level: 2 };
  }

  // Roman numerals: "I.", "II.", "III", "IV." (followed by text)
  const romanMatch = trimmed.match(/^([IVXLC]+)\.?\s+\S/);
  if (romanMatch) {
    const num = romanToNumber(romanMatch[1]);
    if (num !== null) {
      return { type: "roman", numbers: [num], level: 2 };
    }
  }

  // Letter patterns: "A.", "B.", "C" (followed by text)
  // Restrict to avoid matching bibliography entries like "A. Smith, J. Doe, ..."
  // - Must be short (< 60 chars) to be a heading
  // - Must not contain multiple commas (author lists)
  const letterMatch = trimmed.match(/^([A-Z])\.?\s+\S/);
  if (letterMatch) {
    const commaCount = (trimmed.match(/,/g) || []).length;
    const isLikelyBibliography = trimmed.length > 60 || commaCount >= 2;
    if (!isLikelyBibliography) {
      const num = letterToNumber(letterMatch[1]);
      if (num !== null) {
        return { type: "letter", numbers: [num], level: 2 };
      }
    }
  }

  return null;
}

// ============================================================================
// HEADING PATTERN CHECKS
// ============================================================================

/**
 * Check if text is a special keyword heading (abstract, introduction, etc.)
 */
export function isSpecialKeywordHeading(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return SPECIAL_HEADING_KEYWORDS.includes(trimmed);
}

/**
 * Check if text matches common section heading patterns.
 * These should NOT be treated as figure labels.
 */
export function isSectionHeadingPattern(text: string): boolean {
  const trimmed = text.trim();

  // Common section heading patterns:
  // "1. Introduction", "1 Introduction", "1.1 Methods", "1.1.1 Subsection"
  const numberedSection = /^\d+(\.\d+)*\.?\s+\S/;

  // "Chapter 1", "Chapter 1: Title", "Section 1.1"
  const namedSection = /^(chapter|section|part|appendix)\s+(\d+|[ivxlc]+)/i;

  // Roman numeral sections: "I. Introduction", "II Background", "IV. Results"
  const romanSection = /^[IVXLC]+\.?\s+\S/;

  // Letter sections: "A. First", "B. Second"
  const letterSection = /^[A-Z]\.?\s+[A-Z]/;

  // All-caps headings (at least 4 chars, all letters uppercase)
  // e.g., "INTRODUCTION", "METHODS", "RESULTS AND DISCUSSION"
  const allCapsHeading = /^[A-Z][A-Z\s]{3,}$/;

  return (
    numberedSection.test(trimmed) ||
    namedSection.test(trimmed) ||
    romanSection.test(trimmed) ||
    letterSection.test(trimmed) ||
    allCapsHeading.test(trimmed)
  );
}

/**
 * Check if a block appears to be a heading based on font styling.
 * Headings are typically bold or have larger font size.
 */
export function isStyledAsHeading(
  block: StructuredBlock,
  avgFontSize: number
): boolean {
  if (block.lines.length === 0) return false;

  // Check if first line is bold
  const firstLine = block.lines[0];
  if (firstLine.font.weight === "bold") return true;

  // Check if font size is significantly larger than average (> 15% larger)
  if (firstLine.font.size > avgFontSize * 1.15) return true;

  return false;
}
