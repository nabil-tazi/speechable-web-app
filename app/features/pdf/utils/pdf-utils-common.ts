/**
 * Shared constants, types, and options for PDF text processing utilities.
 */

// ============================================================================
// OPTIONS & CONFIGURATION
// ============================================================================

export interface ParagraphJoiningOptions {
  // Minimum vertical gap ratio to consider a paragraph break (relative to line height)
  paragraphGapRatio?: number; // Default 1.5
  // Whether to remove hyphens at line ends and join words
  removeHyphens?: boolean; // Default true
  // Minimum line width ratio to consider "full width" (for justified text detection)
  fullWidthRatio?: number; // Default 0.85
  // Author name from PDF metadata (used for author block detection)
  metadataAuthor?: string;
  // Body text font signature (for detecting heading lines that should be joined)
  bodyFontSize?: number;
  bodyFontWeight?: string;
}

export const DEFAULT_OPTIONS: Required<ParagraphJoiningOptions> = {
  paragraphGapRatio: 1.5,
  removeHyphens: true,
  fullWidthRatio: 0.85,
  metadataAuthor: "",
  bodyFontSize: 0,
  bodyFontWeight: "",
};

// ============================================================================
// TEXT PROCESSING CONSTANTS
// ============================================================================

// Sentence ending punctuation pattern (includes optional closing quotes/brackets)
export const SENTENCE_END_PATTERN = /[.!?]["'»)\]]*$/;

// Abbreviations that end with a period but are NOT sentence endings
// Titles, Latin abbreviations, reference markers, etc.
// Note: Single letters [A-Z] are only abbreviations when NOT followed by closing bracket
// (e.g., "Dr. A." is abbreviation, but "Appendix A.)" is sentence ending)
const ABBREVIATION_PATTERN = /(?:^|[\s(])(?:Mr|Mrs|Ms|Dr|Prof|Rev|Hon|Jr|Sr|vs|etc|al|viz|ca|cf|fig|eq|no|nos|vol|pp?|approx|i\.?e|e\.?g)\.\s*["'»)\]]*$/i;

// Single letter abbreviations (only when NOT followed by closing paren/bracket)
const SINGLE_LETTER_ABBREV = /(?:^|[\s(])[A-Z]\.\s*["'»]*$/i;

/**
 * Check if text ends with sentence-ending punctuation.
 * Handles abbreviations like "Mr.", "et al.", "i.e.", etc.
 *
 * - `!` and `?` are always sentence endings
 * - `.` is checked against known abbreviation patterns
 */
export function isSentenceEnding(text: string): boolean {
  const trimmed = text.trim();

  // Must end with sentence-ending punctuation
  if (!SENTENCE_END_PATTERN.test(trimmed)) {
    return false;
  }

  // ! and ? are always sentence endings
  if (/[!?]["'»)\]]*$/.test(trimmed)) {
    return true;
  }

  // For periods, check if it's a known abbreviation
  if (ABBREVIATION_PATTERN.test(trimmed)) {
    return false;
  }

  // Single letter abbreviations (but not when followed by closing bracket - that's likely "Appendix A.)")
  if (SINGLE_LETTER_ABBREV.test(trimmed)) {
    return false;
  }

  return true;
}

// Legacy export for backwards compatibility (prefer isSentenceEnding function)
export const SENTENCE_END_CHARS = SENTENCE_END_PATTERN;

// Font size difference threshold to trigger block splitting (in points)
export const FONT_SPLIT_THRESHOLD = 1.5;

// ============================================================================
// FIGURE LABEL DETECTION THRESHOLDS
// ============================================================================

// Minimum short blocks on a page to trigger figure label detection
export const FIGURE_LABEL_MIN_BLOCKS = 4;
// Maximum characters for a block to be considered a potential figure label
export const FIGURE_LABEL_MAX_CHARS = 60;

// ============================================================================
// ABSTRACT DETECTION THRESHOLDS
// ============================================================================

// A block marked as anomaly will be "rehabilitated" as normal text if:
// - It's substantial (>= this many chars)
// - It's early in the document (< EARLY_DOCUMENT_THRESHOLD chars of normal text before it)
export const SUBSTANTIAL_BLOCK_MIN = 250;
export const EARLY_DOCUMENT_THRESHOLD = 500;

// ============================================================================
// ANOMALY CLUSTER CONSTANTS
// ============================================================================

// Anomaly cluster expansion: blocks shorter than this are absorbed into clusters
export const CLUSTER_SHORT_THRESHOLD = 100;

// Types that act as cluster boundaries (anomalies won't expand past these)
export const CLUSTER_BOUNDARY_TYPES = new Set(["heading", "toc", "bibliography"]);

// Types that can be part of an anomaly cluster
export const CLUSTER_MEMBER_TYPES = new Set(["anomaly", "legend"]);

// ============================================================================
// OUTLINE MATCHING CONSTANTS
// ============================================================================

// Bonus for matching PDF outline entry (adds to heading score)
export const OUTLINE_MATCH_BONUS = 20;

// ============================================================================
// ANOMALY SCORING CONSTANTS
// ============================================================================

// Minimum score to be flagged as anomaly
export const ANOMALY_THRESHOLD = 4;
// Short block threshold for anomaly scoring
export const SHORT_BLOCK_THRESHOLD = 100; // Characters
// Long block threshold (reduces anomaly score)
export const LONG_BLOCK_THRESHOLD = 200; // Characters
// Points added for being in violation zone
export const ZONE_SCORE_BONUS = 4;

// ============================================================================
// DEBUG FLAGS
// ============================================================================

// Debug flag for anomaly scoring
export const DEBUG_ANOMALY_SCORING = false;
export const DEBUG_ANOMALY_PATTERN = "";

// Debug flag for line break investigation
export const DEBUG_LINE_BREAK = false;
export const DEBUG_LINE_BREAK_PATTERN = "schematic of a bhj";

// Debug flag for heading detection investigation
export const DEBUG_HEADING = false;
export const DEBUG_HEADING_PATTERN = "";

// Debug flag for superscript position investigation
export const DEBUG_SUPERSCRIPT = false;
export const DEBUG_SUPERSCRIPT_PATTERN = "";

// Debug flag for line joining investigation
export const DEBUG_LINE_JOIN = false;
export const DEBUG_LINE_JOIN_PATTERN = "";

// Debug flag for writing mode (vertical text) investigation
export const DEBUG_WMODE = false;
export const DEBUG_WMODE_PATTERN = "";

// ============================================================================
// SHARED TYPES
// ============================================================================

/** Font signature for comparing font styles */
export interface FontSignature {
  size: number;
  weight: string;
}

/** Get a unique key for a font signature */
export function getFontSignatureKey(sig: FontSignature): string {
  return `${sig.size.toFixed(1)}-${sig.weight}`;
}
