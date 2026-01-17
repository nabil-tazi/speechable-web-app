import type {
  StructuredPage,
  StructuredBlock,
  StructuredLine,
  HighlightType,
  FontRange,
  BlockHeadingCandidate,
} from "../types";
import { repairLigatures } from "./ligature-repair";
import { detectArtifacts, type ArtifactType } from "./artifact-cleaning";
import { detectAuthorBlock, isAuthorBlockCandidate } from "./author-detection";
import { detectTOC } from "./toc-detection";
import { detectBibliography } from "./bibliography-detection";

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

const DEFAULT_OPTIONS: Required<ParagraphJoiningOptions> = {
  paragraphGapRatio: 1.5,
  removeHyphens: true,
  fullWidthRatio: 0.85,
  metadataAuthor: "",
  bodyFontSize: 0,
  bodyFontWeight: "",
};

// Characters that indicate end of sentence
const SENTENCE_END_CHARS = /[.!?]["']?$/;

/**
 * Normalize curly/smart quotes to straight quotes.
 * This simplifies all downstream text processing.
 */
function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u201C\u201D]/g, '"') // " " → "
    .replace(/[\u2018\u2019]/g, "'"); // ' ' → '
}

/**
 * Apply quote normalization to all text in a page's blocks and lines.
 */
function normalizePageQuotes(page: StructuredPage): StructuredPage {
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

// Minimum short blocks on a page to trigger figure label detection
const FIGURE_LABEL_MIN_BLOCKS = 4;
// Maximum characters for a block to be considered a potential figure label
const FIGURE_LABEL_MAX_CHARS = 60;

// Abstract detection thresholds
// A block marked as anomaly will be "rehabilitated" as normal text if:
// - It's substantial (>= this many chars)
// - It's early in the document (< EARLY_DOCUMENT_THRESHOLD chars of normal text before it)
const SUBSTANTIAL_BLOCK_MIN = 250;
const EARLY_DOCUMENT_THRESHOLD = 500;

// Special keywords that are headings regardless of numbering
const SPECIAL_HEADING_KEYWORDS = [
  "abstract",
  "introduction",
  "conclusion",
  "references",
];

// Font size difference threshold to trigger block splitting (in points)
const FONT_SPLIT_THRESHOLD = 1.5;

// Anomaly cluster expansion: blocks shorter than this are absorbed into clusters
const CLUSTER_SHORT_THRESHOLD = 100;

// ============================================================================
// HEADING CANDIDATE SCORING (Stage 1)
// ============================================================================

/**
 * Scoring weights for heading candidate detection.
 * A block is a candidate if total score >= HEADING_SCORE_THRESHOLD
 */
const HEADING_SCORE_WEIGHTS = {
  PATTERN_NUMBERED: 30, // "1.", "Chapter 1", "1.2.3" etc.
  PATTERN_KEYWORD: 25, // "Introduction", "Conclusion", etc.
  FONT_SIZE_LARGE: 25, // Significantly larger than body text (≥1.3x)
  FONT_SIZE_MEDIUM: 15, // Moderately larger than body text (≥1.15x)
  FONT_WEIGHT_BOLD: 20, // Bold text
  FONT_ITALIC: 10, // Italic text (common for subheadings)
  VERTICAL_GAP_LARGE: 20, // Large gap before block (>2x line height)
  VERTICAL_GAP_MEDIUM: 10, // Medium gap (>1.5x line height)
  SHORT_LINE: 5, // Single line, not paragraph-length
};

const HEADING_SCORE_THRESHOLD = 40;

// ============================================================================
// POST-JOIN ANOMALY EXPANSION
// ============================================================================

/**
 * Types that act as cluster boundaries (anomalies won't expand past these)
 */
const CLUSTER_BOUNDARY_TYPES = new Set(["heading", "toc", "bibliography"]);

/**
 * Types that can be part of an anomaly cluster
 */
const CLUSTER_MEMBER_TYPES = new Set(["anomaly", "legend"]);

/**
 * Expand anomaly highlights in the final joined text.
 *
 * After text is joined and headings are detected, this function expands
 * anomaly clusters to absorb short gaps of normal text between them.
 *
 * Rules:
 * - Short gaps (< threshold chars) adjacent to anomalies are absorbed
 * - Headings, TOC, and bibliography act as cluster boundaries
 * - Legends are part of clusters but keep their type
 */
function expandAnomalyHighlights(
  text: string,
  highlights: Array<{
    start: number;
    end: number;
    type: HighlightType;
    sectionLevel?: number;
  }>,
  shortThreshold: number = CLUSTER_SHORT_THRESHOLD
): Array<{
  start: number;
  end: number;
  type: HighlightType;
  sectionLevel?: number;
}> {
  if (highlights.length === 0) return highlights;

  // Sort highlights by start position
  const sorted = [...highlights].sort((a, b) => a.start - b.start);

  // Find gaps and check if they should be absorbed
  const newAnomalyRanges: Array<{ start: number; end: number }> = [];

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];

    // Skip if current is a boundary type (don't expand from boundaries)
    if (CLUSTER_BOUNDARY_TYPES.has(current.type)) continue;

    // Check if current is an anomaly or legend (cluster member)
    if (!CLUSTER_MEMBER_TYPES.has(current.type)) continue;

    // Check gap after current highlight
    if (next) {
      const gapStart = current.end;
      const gapEnd = next.start;
      const gapLength = gapEnd - gapStart;

      // Skip if next is a boundary (don't expand into boundaries)
      if (CLUSTER_BOUNDARY_TYPES.has(next.type)) continue;

      // If gap is short and next is also a cluster member, absorb the gap
      if (
        gapLength > 0 &&
        gapLength < shortThreshold &&
        CLUSTER_MEMBER_TYPES.has(next.type)
      ) {
        newAnomalyRanges.push({ start: gapStart, end: gapEnd });
      }
    }
  }

  // Also check gaps before first anomaly and after last anomaly in a cluster
  // by looking at the boundaries more carefully
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];

    if (!CLUSTER_MEMBER_TYPES.has(current.type)) continue;

    // Look backward for short gap from previous highlight
    const prev = sorted[i - 1];
    if (prev && !CLUSTER_BOUNDARY_TYPES.has(prev.type)) {
      const gapStart = prev.end;
      const gapEnd = current.start;
      const gapLength = gapEnd - gapStart;

      // If previous is also a cluster member and gap is short, absorb
      if (
        gapLength > 0 &&
        gapLength < shortThreshold &&
        CLUSTER_MEMBER_TYPES.has(prev.type)
      ) {
        // Already handled in forward pass
      } else if (gapLength > 0 && gapLength < shortThreshold) {
        // Previous is not a cluster member but gap is short
        // Check if there's an anomaly on the other side (after current)
        // This handles: [normal short gap] [anomaly] case
        // We only absorb if there's anomaly context
      }
    }
  }

  if (newAnomalyRanges.length === 0) return highlights;

  // Add new anomaly highlights for the gaps
  const expandedHighlights: Array<{
    start: number;
    end: number;
    type: HighlightType;
    sectionLevel?: number;
  }> = [...highlights];
  for (const range of newAnomalyRanges) {
    expandedHighlights.push({
      start: range.start,
      end: range.end,
      type: "anomaly" as HighlightType,
    });
  }

  // Merge overlapping anomaly highlights
  return mergeOverlappingHighlights(expandedHighlights);
}

/**
 * Merge overlapping highlights of the same type.
 */
function mergeOverlappingHighlights(
  highlights: Array<{
    start: number;
    end: number;
    type: HighlightType;
    sectionLevel?: number;
  }>
): Array<{
  start: number;
  end: number;
  type: HighlightType;
  sectionLevel?: number;
}> {
  if (highlights.length === 0) return highlights;

  // Group by type
  const byType = new Map<
    HighlightType,
    Array<{
      start: number;
      end: number;
      type: HighlightType;
      sectionLevel?: number;
    }>
  >();
  for (const h of highlights) {
    const group = byType.get(h.type) || [];
    group.push(h);
    byType.set(h.type, group);
  }

  // Merge each type's highlights
  const result: Array<{
    start: number;
    end: number;
    type: HighlightType;
    sectionLevel?: number;
  }> = [];
  for (const [type, group] of byType) {
    if (type === "anomaly") {
      // Merge overlapping anomalies
      const sorted = group.sort((a, b) => a.start - b.start);
      const merged: typeof group = [sorted[0]];
      for (let i = 1; i < sorted.length; i++) {
        const last = merged[merged.length - 1];
        const curr = sorted[i];
        if (curr.start <= last.end) {
          last.end = Math.max(last.end, curr.end);
        } else {
          merged.push(curr);
        }
      }
      result.push(...merged);
    } else {
      // Keep other types as-is
      result.push(...group);
    }
  }

  return result;
}

// ============================================================================
// BLOCK PRE-PROCESSING: SPLIT BY FONT BOUNDARIES
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
// SEQUENTIAL HEADING DETECTION
// ============================================================================

/** Font signature for grouping headings */
interface FontSignature {
  size: number;
  weight: string;
}

/** Heading pattern types */
type HeadingPatternType =
  | "numbered" // 1., 2., 3. or 1, 2, 3
  | "decimal" // 1.1, 1.2, 2.1
  | "roman" // I., II., III.
  | "letter" // A., B., C.
  | "named" // Chapter 1, Section 2
  | "keyword"; // abstract, introduction, etc.

/** A potential heading candidate */
interface HeadingCandidate {
  pageNumber: number;
  blockIndex: number;
  lineIndex: number; // Line index within the block
  text: string;
  patternType: HeadingPatternType;
  numbers: number[]; // e.g., [1] for "1.", [1, 2] for "1.2", [4] for "IV"
  fontSignature: FontSignature;
  level: number; // h2, h3, h4...
}

/** Confirmed heading */
export interface ConfirmedHeading {
  pageNumber: number;
  blockIndex: number;
  lineIndex: number; // Line index within the block
  level: number; // 2 = h2, 3 = h3, etc.
  text: string;
  fontSignature: FontSignature; // For level hierarchy calculation
}

/**
 * Create a font signature key for grouping
 */
function getFontSignatureKey(sig: FontSignature): string {
  return `${sig.size}|${sig.weight}`;
}

/**
 * Get font signature from a block (uses first line)
 */
function getBlockFontSignature(block: StructuredBlock): FontSignature {
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
 * Calculate the body text font signature (most common by character count)
 */
function calculateBodyTextSignature(pages: StructuredPage[]): FontSignature {
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

/**
 * Convert roman numeral to number
 */
function romanToNumber(roman: string): number | null {
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
function letterToNumber(letter: string): number | null {
  const upper = letter.toUpperCase();
  if (upper.length !== 1 || upper < "A" || upper > "Z") return null;
  return upper.charCodeAt(0) - "A".charCodeAt(0) + 1;
}

/**
 * Extract heading pattern from text
 * Returns null if no pattern matches
 */
function extractHeadingPattern(text: string): {
  type: HeadingPatternType;
  numbers: number[];
  level: number;
} | null {
  const trimmed = text.trim();

  // Debug: Log pattern matching for target heading
  if (
    DEBUG_HEADING &&
    trimmed.toLowerCase().includes(DEBUG_HEADING_PATTERN)
  ) {
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

/**
 * Check if text is a special keyword heading
 */
function isSpecialKeywordHeading(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return SPECIAL_HEADING_KEYWORDS.includes(trimmed);
}

/**
 * Get the first line of text from a block (for heading detection)
 */
function getFirstLineText(block: StructuredBlock): string {
  if (block.lines.length === 0) return "";
  return block.lines[0].text.trim();
}

/**
 * Get the full heading text from a block by extending from first line
 * while subsequent lines have matching font (size, weight, italic).
 * This handles multi-line headings that wrap across lines.
 */
function getHeadingTextFromBlock(block: StructuredBlock): {
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

/**
 * Get the dominant font size from a block (first line's size)
 */
function getDominantFontSize(block: StructuredBlock): number {
  if (block.lines.length === 0) return 12;
  return block.lines[0].font.size;
}

/**
 * Check if the block's dominant font is bold
 */
function isDominantBold(block: StructuredBlock): boolean {
  if (block.lines.length === 0) return false;
  return block.lines[0].font.weight === "bold";
}

/**
 * Check if the block's dominant font is italic
 */
function isDominantItalic(block: StructuredBlock): boolean {
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
function estimateLineHeight(block: StructuredBlock): number {
  if (block.lines.length === 0) return 12;
  // Use font size as approximation, typical line height is 1.2x font size
  return block.lines[0].font.size * 1.2;
}

/**
 * Detect if a block is a heading candidate based on scoring.
 * Stage 1 of two-stage heading detection - runs at block level where
 * we have access to vertical gaps, italic, and other signals.
 *
 * @param block The block to evaluate
 * @param prevBlock Previous block (for gap calculation)
 * @param bodyFontSize The document's body text font size
 * @param textPosition Starting position in joined text
 * @returns HeadingCandidate if score >= threshold, null otherwise
 */
function detectBlockHeadingCandidate(
  block: StructuredBlock,
  prevBlock: StructuredBlock | null,
  bodyFontSize: number,
  textPosition: number
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
    } else if (sizeRatio >= 1.15) {
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

  // Debug logging for target pattern
  if (
    DEBUG_HEADING &&
    fullHeadingText.toLowerCase().includes(DEBUG_HEADING_PATTERN)
  ) {
    console.log(
      `[HeadingCandidate] "${fullHeadingText.slice(0, 60)}${fullHeadingText.length > 60 ? "..." : ""}"`
    );
    console.log(
      `  score=${score} (threshold=${HEADING_SCORE_THRESHOLD}) factors=[${factors.join(", ")}]`
    );
    console.log(
      `  font: ${blockFontSize}/${isDominantBold(block) ? "bold" : "normal"}, bodyFontSize: ${bodyFontSize}`
    );
    console.log(`  result: ${score >= HEADING_SCORE_THRESHOLD ? "ACCEPTED" : "REJECTED"}`);
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
    };
  }

  return null;
}

/**
 * Check if two numbers arrays are consecutive
 * For single-level: [1] → [2] is consecutive
 * For multi-level: [1,1] → [1,2] is consecutive, [1,3] → [2,1] is consecutive
 */
function areNumbersConsecutive(prev: number[], curr: number[]): boolean {
  if (prev.length !== curr.length) return false;

  if (prev.length === 1) {
    // Single level: just check n → n+1
    return curr[0] === prev[0] + 1;
  }

  // Multi-level: check if same parent and child increments, OR parent increments and child resets
  const prevParent = prev.slice(0, -1);
  const currParent = curr.slice(0, -1);
  const prevChild = prev[prev.length - 1];
  const currChild = curr[curr.length - 1];

  // Same parent, child increments
  if (
    prevParent.every((v, i) => v === currParent[i]) &&
    currChild === prevChild + 1
  ) {
    return true;
  }

  // Parent increments (at some level), child resets to 1
  // e.g., [1,3] → [2,1] or [1,2,3] → [1,3,1]
  for (let i = prevParent.length - 1; i >= 0; i--) {
    if (currParent[i] === prevParent[i] + 1) {
      // All subsequent parent levels should be same or reset to 1
      const parentMatch = prevParent
        .slice(0, i)
        .every((v, j) => v === currParent[j]);
      if (parentMatch && currChild === 1) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Find consecutive sequences in a sorted array of candidates
 * Returns groups of consecutive candidates (at least 2 in each group)
 */
function findConsecutiveGroups(
  candidates: HeadingCandidate[]
): HeadingCandidate[][] {
  if (candidates.length < 2) return [];

  // Sort by numbers
  const sorted = [...candidates].sort((a, b) => {
    for (let i = 0; i < Math.max(a.numbers.length, b.numbers.length); i++) {
      const aNum = a.numbers[i] ?? 0;
      const bNum = b.numbers[i] ?? 0;
      if (aNum !== bNum) return aNum - bNum;
    }
    return 0;
  });

  const groups: HeadingCandidate[][] = [];
  let currentGroup: HeadingCandidate[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    if (areNumbersConsecutive(prev.numbers, curr.numbers)) {
      currentGroup.push(curr);
    } else {
      // End current group if it has at least 2
      if (currentGroup.length >= 2) {
        groups.push(currentGroup);
      }
      currentGroup = [curr];
    }
  }

  // Don't forget the last group
  if (currentGroup.length >= 2) {
    groups.push(currentGroup);
  }

  return groups;
}

/**
 * Assign heading levels based on font hierarchy.
 *
 * Groups headings by font signature, sorts by visual prominence (larger size = more important),
 * and assigns levels (h2, h3, h4...) based on the hierarchy.
 *
 * The final level is the MAX of:
 * - Pattern-implied level (e.g., "2.1" implies at least h3)
 * - Font-based level (based on visual hierarchy)
 *
 * This ensures proper nesting while respecting visual styling.
 */
function assignHeadingLevelsByFontHierarchy(
  confirmedHeadings: Map<string, ConfirmedHeading>
): void {
  if (confirmedHeadings.size === 0) return;

  // Step 1: Collect unique font signatures from all headings
  const fontSignatures = new Map<string, FontSignature>();

  for (const heading of confirmedHeadings.values()) {
    const key = getFontSignatureKey(heading.fontSignature);
    if (!fontSignatures.has(key)) {
      fontSignatures.set(key, heading.fontSignature);
    }
  }

  // Step 2: Sort font signatures by visual prominence
  // Larger size = more prominent; if same size, bold > normal
  const sortedSignatures = [...fontSignatures.values()].sort((a, b) => {
    // Primary sort: larger font size first
    if (b.size !== a.size) {
      return b.size - a.size;
    }
    // Secondary sort: bold before normal
    const aWeight = a.weight === "bold" ? 1 : 0;
    const bWeight = b.weight === "bold" ? 1 : 0;
    return bWeight - aWeight;
  });

  // Step 3: Create font signature to level mapping
  // Most prominent = h2, second = h3, etc.
  const fontToLevel = new Map<string, number>();
  for (let i = 0; i < sortedSignatures.length; i++) {
    const key = getFontSignatureKey(sortedSignatures[i]);
    fontToLevel.set(key, 2 + i); // h2, h3, h4...
  }

  // Step 4: Assign levels to each heading
  for (const [key, heading] of confirmedHeadings) {
    const fontKey = getFontSignatureKey(heading.fontSignature);
    const fontBasedLevel = fontToLevel.get(fontKey) || 2;

    // Pattern-implied level is already in heading.level
    // Use MAX to ensure proper nesting (e.g., "2.1" can't be h2 even if font says so)
    const patternImpliedLevel = heading.level;
    const finalLevel = Math.max(patternImpliedLevel, fontBasedLevel);

    // Update the heading's level
    heading.level = finalLevel;
  }
}

/**
 * Heading candidate from text-based detection
 */
interface TextHeadingCandidate {
  start: number;
  end: number;
  text: string;
  patternType: HeadingPatternType | "keyword";
  numbers: number[];
  fontSignature: FontSignature;
  level: number;
}

/**
 * Look up font signature at a given position in the text
 */
function getFontAtPosition(
  position: number,
  fontRanges: FontRange[],
  debug: boolean = false
): FontSignature | null {
  if (debug) {
    console.log(`[FontLookupDebug] Looking for font at position ${position}`);
    // Show nearby font ranges
    const nearbyRanges = fontRanges.filter(
      (fr) =>
        Math.abs(fr.start - position) < 200 ||
        (position >= fr.start && position < fr.end)
    );
    console.log(`  Nearby font ranges:`);
    nearbyRanges.slice(0, 10).forEach((fr) => {
      const marker =
        position >= fr.start && position < fr.end ? " <-- MATCH" : "";
      console.log(
        `    [${fr.start}-${fr.end}]: ${fr.size}/${fr.weight}${marker}`
      );
    });
  }
  for (const fr of fontRanges) {
    if (position >= fr.start && position < fr.end) {
      return { size: fr.size, weight: fr.weight };
    }
  }
  return null;
}

/**
 * Calculate body font signature from font ranges (most common by character count)
 */
function calculateBodyFontFromRanges(fontRanges: FontRange[]): FontSignature {
  const fontCharCounts = new Map<
    string,
    { sig: FontSignature; count: number }
  >();

  for (const fr of fontRanges) {
    const key = `${fr.size}|${fr.weight}`;
    const charCount = fr.end - fr.start;
    const existing = fontCharCounts.get(key);
    if (existing) {
      existing.count += charCount;
    } else {
      fontCharCounts.set(key, {
        sig: { size: fr.size, weight: fr.weight },
        count: charCount,
      });
    }
  }

  let maxCount = 0;
  let bodySig: FontSignature = { size: 12, weight: "normal" };

  for (const { sig, count } of fontCharCounts.values()) {
    if (count > maxCount) {
      maxCount = count;
      bodySig = sig;
    }
  }

  return bodySig;
}

/**
 * Check if a position falls within any of the exclude ranges
 */
function isInExcludeRanges(
  position: number,
  excludeRanges: Array<{ start: number; end: number }>
): boolean {
  for (const range of excludeRanges) {
    if (position >= range.start && position < range.end) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// ARTIFACT REMOVAL FOR CLEAN DETECTION
// ============================================================================

/**
 * Position map that tracks how positions in cleaned text map back to original text.
 * Used when we remove artifacts before detection, then need to map results back.
 */
interface PositionMap {
  /**
   * Convert a position in cleaned text to the corresponding position in original text.
   */
  toOriginal(cleanedPos: number): number;
  /**
   * Convert a position in original text to the corresponding position in cleaned text.
   */
  toClean(originalPos: number): number;
}

/**
 * Remove highlighted ranges from text and create a position map for converting
 * positions back to original text coordinates.
 *
 * @param text - Original text
 * @param highlights - Highlights to remove (e.g., header, footer, page_number)
 * @returns Cleaned text and a position map
 */
function removeHighlightedRanges(
  text: string,
  highlights: Array<{ start: number; end: number }>
): { cleanedText: string; positionMap: PositionMap } {
  if (highlights.length === 0) {
    return {
      cleanedText: text,
      positionMap: { toOriginal: (pos) => pos, toClean: (pos) => pos },
    };
  }

  // Sort highlights by start position and merge overlapping ones
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];

  for (const h of sorted) {
    const last = merged[merged.length - 1];
    if (last && h.start <= last.end) {
      last.end = Math.max(last.end, h.end);
    } else {
      merged.push({ start: h.start, end: h.end });
    }
  }

  // Build cleaned text by removing highlighted ranges
  let cleanedText = "";
  let lastEnd = 0;

  // Track removal offsets: array of { originalPos, removedChars }
  // For each removal, we track how many chars were removed up to that point
  const removalOffsets: Array<{
    originalPos: number;
    cumulativeRemoved: number;
  }> = [];
  let cumulativeRemoved = 0;

  for (const range of merged) {
    // Add text before this range
    cleanedText += text.slice(lastEnd, range.start);

    // Track the removal
    cumulativeRemoved += range.end - range.start;
    removalOffsets.push({
      originalPos: range.end,
      cumulativeRemoved,
    });

    lastEnd = range.end;
  }

  // Add remaining text after last range
  cleanedText += text.slice(lastEnd);

  // Create position map
  const positionMap: PositionMap = {
    toOriginal(cleanedPos: number): number {
      // Find how much was removed before this cleaned position
      let removed = 0;

      for (const offset of removalOffsets) {
        // The original position where this removal ends
        const originalPosAfterRemoval = offset.originalPos;
        // The cleaned position where this removal ends
        const cleanedPosAfterRemoval =
          originalPosAfterRemoval - offset.cumulativeRemoved;

        if (cleanedPos < cleanedPosAfterRemoval) {
          // The cleaned position is before this removal point
          break;
        }
        removed = offset.cumulativeRemoved;
      }

      return cleanedPos + removed;
    },
    toClean(originalPos: number): number {
      // Find how much was removed before this original position
      let removed = 0;

      for (const offset of removalOffsets) {
        if (originalPos < offset.originalPos) {
          // Original position is before this removal ends
          // Check if it's inside the removed range
          const rangeStart =
            offset.originalPos - (offset.cumulativeRemoved - removed);
          if (originalPos >= rangeStart) {
            // Position is inside removed range, map to the end of the gap
            return rangeStart - removed;
          }
          break;
        }
        removed = offset.cumulativeRemoved;
      }

      return originalPos - removed;
    },
  };

  return { cleanedText, positionMap };
}

/**
 * Adjust font ranges after removing highlighted sections from text.
 *
 * @param fontRanges - Original font ranges
 * @param removedHighlights - Highlights that were removed from text
 * @returns Adjusted font ranges with updated positions
 */
function adjustFontRangesForRemovals(
  fontRanges: FontRange[],
  removedHighlights: Array<{ start: number; end: number }>
): FontRange[] {
  if (removedHighlights.length === 0) {
    return fontRanges;
  }

  // Sort and merge highlights (same as in removeHighlightedRanges)
  const sorted = [...removedHighlights].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];

  for (const h of sorted) {
    const last = merged[merged.length - 1];
    if (last && h.start <= last.end) {
      last.end = Math.max(last.end, h.end);
    } else {
      merged.push({ start: h.start, end: h.end });
    }
  }

  // Adjust each font range
  const adjusted: FontRange[] = [];

  for (const fr of fontRanges) {
    let newStart = fr.start;
    let newEnd = fr.end;
    let skipRange = false;

    for (const removal of merged) {
      // If font range is entirely within a removed section, skip it
      if (fr.start >= removal.start && fr.end <= removal.end) {
        skipRange = true;
        break;
      }

      // If removal is entirely before this font range, shift both start and end
      if (removal.end <= fr.start) {
        const shift = removal.end - removal.start;
        newStart -= shift;
        newEnd -= shift;
      }
      // If removal overlaps with start of font range
      else if (
        removal.start < fr.start &&
        removal.end > fr.start &&
        removal.end < fr.end
      ) {
        const overlapSize = removal.end - fr.start;
        newStart = removal.start; // Start moves to removal start
        newEnd -= removal.end - removal.start; // End shifts by full removal size
      }
      // If removal is entirely within font range
      else if (removal.start >= fr.start && removal.end <= fr.end) {
        newEnd -= removal.end - removal.start;
      }
      // If removal overlaps with end of font range
      else if (
        removal.start > fr.start &&
        removal.start < fr.end &&
        removal.end >= fr.end
      ) {
        newEnd = removal.start - (newStart - fr.start + fr.start - newStart); // Complex case, simplify
        // Actually just clip to removal start
        const prevRemovals = merged.filter((r) => r.end <= removal.start);
        const prevRemoved = prevRemovals.reduce(
          (sum, r) => sum + (r.end - r.start),
          0
        );
        newEnd = removal.start - prevRemoved;
      }
    }

    if (!skipRange && newEnd > newStart) {
      // Debug: log ranges near position 41244 that are being adjusted
      adjusted.push({
        ...fr,
        start: newStart,
        end: newEnd,
      });
    }
  }

  return adjusted;
}

/**
 * Detect sequential headings from joined text and font ranges.
 * This is the new text-based version that works after page joining.
 *
 * @param text - The joined document text
 * @param fontRanges - Font information for text ranges
 * @param excludeRanges - Ranges to exclude (TOC, bibliography)
 * @param headingCandidates - Stage 1 heading candidates from block-level detection
 * @returns Array of heading highlights
 */
export function detectHeadingsFromText(
  text: string,
  fontRanges: FontRange[],
  excludeRanges: Array<{ start: number; end: number }> = [],
  blockHeadingCandidates: BlockHeadingCandidate[] = []
): Array<{
  start: number;
  end: number;
  type: "heading";
  sectionLevel: number;
}> {
  if (fontRanges.length === 0 && blockHeadingCandidates.length === 0) {
    return [];
  }

  // Step 0: Process Stage 1 heading candidates
  // These already passed the scoring threshold, so we accept them directly
  // (filtering out any in excluded ranges)
  const candidateHeadings: Array<{
    start: number;
    end: number;
    type: "heading";
    sectionLevel: number;
  }> = [];

  for (const candidate of blockHeadingCandidates) {
    // Skip if in excluded range
    if (isInExcludeRanges(candidate.textStart, excludeRanges)) {
      continue;
    }

    // Debug logging for target pattern
    if (
      DEBUG_HEADING &&
      candidate.text.toLowerCase().includes(DEBUG_HEADING_PATTERN)
    ) {
      console.log(
        `[HeadingFromCandidate] "${candidate.text.slice(0, 50)}..." score=${candidate.score} factors=[${candidate.factors.join(", ")}]`
      );
    }

    // Assign level based on font size (larger = lower level number = higher hierarchy)
    // For now use level 2 as default, will refine with font hierarchy later
    const level = candidate.fontSize >= 14 ? 2 : 3;

    candidateHeadings.push({
      start: candidate.textStart,
      end: candidate.textEnd,
      type: "heading",
      sectionLevel: level,
    });
  }

  if (fontRanges.length === 0) {
    return candidateHeadings;
  }

  // Step 1: Calculate body font signature
  const bodySignature = calculateBodyFontFromRanges(fontRanges);
  const bodySignatureKey = getFontSignatureKey(bodySignature);

  // Step 2: Scan text line by line for heading patterns
  const candidates: TextHeadingCandidate[] = [];
  const lines = text.split("\n");
  let currentOffset = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Debug: Check if this line matches our target pattern
    const shouldDebugHeading =
      DEBUG_HEADING &&
      trimmedLine.toLowerCase().includes(DEBUG_HEADING_PATTERN);

    if (trimmedLine && trimmedLine.length <= 150) {
      // Check if line is in excluded range
      const isExcluded = isInExcludeRanges(currentOffset, excludeRanges);

      if (shouldDebugHeading) {
        console.log(`[HeadingDebug] Line: "${trimmedLine.slice(0, 60)}..."`);
        console.log(
          `  length: ${trimmedLine.length}, isExcluded: ${isExcluded}`
        );
      }

      if (!isExcluded) {
        // Check for heading pattern
        const pattern = extractHeadingPattern(trimmedLine);
        const isKeyword = !pattern && isSpecialKeywordHeading(trimmedLine);

        if (shouldDebugHeading) {
          console.log(
            `  pattern: ${
              pattern ? JSON.stringify(pattern) : "null"
            }, isKeyword: ${isKeyword}`
          );
        }

        if (pattern || isKeyword) {
          // Look up font at this position
          const font = getFontAtPosition(
            currentOffset,
            fontRanges,
            shouldDebugHeading
          );

          if (shouldDebugHeading) {
            console.log(`  font: ${font ? JSON.stringify(font) : "null"}`);
            console.log(`  bodySignature: ${bodySignatureKey}`);
            console.log(`  currentOffset: ${currentOffset}`);
            // Show the actual character at the offset and surrounding text
            const charAtOffset = text.charAt(currentOffset);
            const surroundingText = text.slice(
              Math.max(0, currentOffset - 5),
              currentOffset + 10
            );
            console.log(
              `  charAtOffset: "${charAtOffset}" (code: ${charAtOffset.charCodeAt(
                0
              )})`
            );
            console.log(
              `  surroundingText: "${surroundingText.replace(/\n/g, "\\n")}"`
            );
          }

          if (font) {
            const fontKey = getFontSignatureKey(font);

            if (shouldDebugHeading) {
              console.log(
                `  fontKey: ${fontKey}, matches body: ${
                  fontKey === bodySignatureKey
                }`
              );
            }

            // Only add if font differs from body text
            if (fontKey !== bodySignatureKey) {
              const lineStart =
                currentOffset + (line.length - line.trimStart().length);
              const lineEnd = currentOffset + line.trimEnd().length;

              candidates.push({
                start: lineStart,
                end: lineEnd,
                text: trimmedLine,
                patternType: pattern?.type || "keyword",
                numbers: pattern?.numbers || [],
                fontSignature: font,
                level: pattern?.level || 2,
              });

              if (shouldDebugHeading) {
                console.log(`  -> ADDED as candidate`);
              }
            } else if (shouldDebugHeading) {
              console.log(`  -> REJECTED: font matches body text`);
            }
          }
        } else if (shouldDebugHeading) {
          console.log(`  -> REJECTED: no pattern or keyword match`);
        }
      }
    } else if (shouldDebugHeading) {
      console.log(`[HeadingDebug] Line: "${trimmedLine.slice(0, 60)}..."`);
      console.log(
        `  -> REJECTED: empty or too long (${trimmedLine.length} chars)`
      );
    }

    currentOffset += line.length + 1; // +1 for the newline
  }

  if (candidates.length === 0) {
    return [];
  }

  // Step 3: Group candidates by (patternType, fontSignature)
  const groupedCandidates = new Map<string, TextHeadingCandidate[]>();

  for (const candidate of candidates) {
    const groupKey = `${candidate.patternType}|${getFontSignatureKey(
      candidate.fontSignature
    )}`;
    const group = groupedCandidates.get(groupKey) || [];
    group.push(candidate);
    groupedCandidates.set(groupKey, group);
  }

  // Step 4: Find consecutive sequences in each group
  const confirmedHeadings: TextHeadingCandidate[] = [];

  for (const [, group] of groupedCandidates) {
    // Sort by position
    group.sort((a, b) => a.start - b.start);

    // Find consecutive number sequences
    let sequenceStart = 0;
    for (let i = 1; i <= group.length; i++) {
      const isEnd = i === group.length;
      const isConsecutive =
        !isEnd &&
        group[i].numbers.length > 0 &&
        group[i - 1].numbers.length > 0 &&
        areNumbersConsecutive(group[i - 1].numbers, group[i].numbers);

      if (isEnd || !isConsecutive) {
        // Check sequence length (at least 2 for consecutive patterns)
        const sequenceLength = i - sequenceStart;
        if (
          sequenceLength >= 2 ||
          group[sequenceStart].patternType === "keyword"
        ) {
          // Add all candidates in this sequence
          for (let j = sequenceStart; j < i; j++) {
            confirmedHeadings.push(group[j]);
          }
        }
        sequenceStart = i;
      }
    }
  }

  // Step 5: Position-based fallback - detect dense heading clusters
  // If we have 10+ headings in first 15% of doc → likely TOC, exclude them
  // If we have 10+ headings in last 20% of doc → likely bibliography, exclude them
  const textLength = text.length;
  const tocThreshold = textLength * 0.15;
  const bibThreshold = textLength * 0.8;

  const headingsInTOCZone = confirmedHeadings.filter(
    (h) => h.start < tocThreshold
  );
  const headingsInBibZone = confirmedHeadings.filter(
    (h) => h.start > bibThreshold
  );

  let filteredHeadings = confirmedHeadings;

  if (headingsInTOCZone.length >= 10) {
    // Dense cluster at start - likely TOC, exclude them
    filteredHeadings = filteredHeadings.filter((h) => h.start >= tocThreshold);
  }

  if (headingsInBibZone.length >= 10) {
    // Dense cluster at end - likely bibliography, exclude them
    filteredHeadings = filteredHeadings.filter((h) => h.start <= bibThreshold);
  }

  // Step 6: Assign final levels based on font hierarchy
  const fontToLevel = new Map<string, number>();
  const uniqueFonts = [
    ...new Set(
      filteredHeadings.map((h) => getFontSignatureKey(h.fontSignature))
    ),
  ];

  // Sort by font size (larger = more prominent = lower level number)
  const sortedFonts = uniqueFonts
    .map((key) => {
      const parts = key.split("|");
      return { key, size: parseFloat(parts[0]), weight: parts[1] };
    })
    .sort((a, b) => {
      if (b.size !== a.size) return b.size - a.size;
      return (b.weight === "bold" ? 1 : 0) - (a.weight === "bold" ? 1 : 0);
    });

  sortedFonts.forEach((font, index) => {
    fontToLevel.set(font.key, 2 + index); // h2, h3, h4, ...
  });

  // Step 7: Convert to TextHighlight format
  const patternHeadings = filteredHeadings.map((h) => {
    const fontKey = getFontSignatureKey(h.fontSignature);
    const fontLevel = fontToLevel.get(fontKey) || 2;
    const finalLevel = Math.max(h.level, fontLevel);

    return {
      start: h.start,
      end: h.end,
      type: "heading" as const,
      sectionLevel: finalLevel,
    };
  });

  // Step 8: Merge candidate headings (Stage 1) with pattern-based headings
  // Avoid duplicates by checking for position overlap
  const allHeadings = [...patternHeadings];

  for (const candidate of candidateHeadings) {
    // Check if this candidate overlaps with any existing pattern-based heading
    const overlaps = patternHeadings.some(
      (h) =>
        (candidate.start >= h.start && candidate.start < h.end) ||
        (candidate.end > h.start && candidate.end <= h.end) ||
        (candidate.start <= h.start && candidate.end >= h.end)
    );

    if (!overlaps) {
      allHeadings.push(candidate);
    }
  }

  // Sort by position
  allHeadings.sort((a, b) => a.start - b.start);

  return allHeadings;
}

/**
 * Detect sequential headings across the entire document
 * Returns a map of (pageNumber, blockIndex) → heading level
 * @deprecated Use detectHeadingsFromText for new code
 */
export function detectSequentialHeadings(
  pages: StructuredPage[]
): Map<string, ConfirmedHeading> {
  const confirmedHeadings = new Map<string, ConfirmedHeading>();

  if (pages.length === 0) return confirmedHeadings;

  // Step 1: Calculate body text signature
  const bodySignature = calculateBodyTextSignature(pages);
  const bodySignatureKey = getFontSignatureKey(bodySignature);

  // Step 2: Collect all heading candidates
  const candidates: HeadingCandidate[] = [];
  const keywordCandidates: HeadingCandidate[] = [];

  // Pattern for standalone numbers: "1", "2", "1.", "2.", "1.1", "1.1.", etc.
  const STANDALONE_NUMBER_PATTERN = /^(\d+(?:\.\d+)*)\.?$/;

  for (const page of pages) {
    for (let blockIndex = 0; blockIndex < page.blocks.length; blockIndex++) {
      const block = page.blocks[blockIndex];
      const text = block.lines
        .map((l) => l.text)
        .join(" ")
        .trim();

      // Check EACH LINE individually for heading patterns (handles headings buried in large blocks)
      for (let li = 0; li < block.lines.length; li++) {
        const line = block.lines[li];
        const lineText = line.text.trim();

        if (!lineText || lineText.length > 150) continue; // Skip empty or too-long lines

        // Check for standalone number that might need merging with next line
        const standaloneMatch = lineText.match(STANDALONE_NUMBER_PATTERN);
        if (standaloneMatch && li + 1 < block.lines.length) {
          const nextLine = block.lines[li + 1];
          const nextLineText = nextLine.text.trim();

          // Check if they're on the same visual line (Y positions within 2pt tolerance)
          const sameY = Math.abs(line.bbox.y - nextLine.bbox.y) < 2;

          // Check if they have the same font
          const lineFontSig = {
            size: Math.round(line.font.size * 10) / 10,
            weight: line.font.weight,
          };
          const nextFontSig = {
            size: Math.round(nextLine.font.size * 10) / 10,
            weight: nextLine.font.weight,
          };
          const sameFont =
            getFontSignatureKey(lineFontSig) ===
            getFontSignatureKey(nextFontSig);

          if (sameY && sameFont && nextLineText && nextLineText.length < 100) {
            // Merge into a combined heading
            const combinedText = `${lineText} ${nextLineText}`;
            const combinedPattern = extractHeadingPattern(combinedText);

            if (combinedPattern) {
              const fontKey = getFontSignatureKey(lineFontSig);

              if (fontKey !== bodySignatureKey) {
                candidates.push({
                  pageNumber: page.pageNumber,
                  blockIndex,
                  lineIndex: li,
                  text: combinedText,
                  patternType: combinedPattern.type,
                  numbers: combinedPattern.numbers,
                  fontSignature: lineFontSig,
                  level: combinedPattern.level,
                });
                // Skip the next line since we merged it
                li++;
                continue;
              }
            }
          }
        }

        const linePattern = extractHeadingPattern(lineText);
        if (linePattern) {
          const lineFontSig = {
            size: Math.round(line.font.size * 10) / 10,
            weight: line.font.weight,
          };
          // Only add if font differs from body text (likely a heading)
          const lineFontKey = getFontSignatureKey(lineFontSig);

          if (lineFontKey !== bodySignatureKey) {
            candidates.push({
              pageNumber: page.pageNumber,
              blockIndex,
              lineIndex: li,
              text: lineText,
              patternType: linePattern.type,
              numbers: linePattern.numbers,
              fontSignature: lineFontSig,
              level: linePattern.level,
            });
          }
        }

        // Also check for keyword headings at line level
        if (isSpecialKeywordHeading(lineText)) {
          const lineFontSig = {
            size: Math.round(line.font.size * 10) / 10,
            weight: line.font.weight,
          };
          const lineFontKey = getFontSignatureKey(lineFontSig);
          if (lineFontKey !== bodySignatureKey) {
            keywordCandidates.push({
              pageNumber: page.pageNumber,
              blockIndex,
              lineIndex: li,
              text: lineText,
              patternType: "keyword",
              numbers: [],
              fontSignature: lineFontSig,
              level: 2,
            });
          }
        }
      }
    }
  }

  // Step 3: Group candidates by (patternType, fontSignature)
  const groupedCandidates = new Map<string, HeadingCandidate[]>();

  for (const candidate of candidates) {
    const groupKey = `${candidate.patternType}|${getFontSignatureKey(
      candidate.fontSignature
    )}`;
    const group = groupedCandidates.get(groupKey) || [];
    group.push(candidate);
    groupedCandidates.set(groupKey, group);
  }

  // Step 4: Validate each group
  for (const [groupKey, group] of groupedCandidates) {
    // Check if font differs from body text
    const fontKey = groupKey.split("|").slice(1).join("|");
    if (fontKey === bodySignatureKey) {
      continue; // Same font as body text, skip
    }

    // Find consecutive sequences
    const consecutiveGroups = findConsecutiveGroups(group);

    // Mark all candidates in consecutive groups as confirmed headings
    for (const consecutiveGroup of consecutiveGroups) {
      for (const candidate of consecutiveGroup) {
        const key = `${candidate.pageNumber}|${candidate.blockIndex}|${candidate.lineIndex}`;
        confirmedHeadings.set(key, {
          pageNumber: candidate.pageNumber,
          blockIndex: candidate.blockIndex,
          lineIndex: candidate.lineIndex,
          level: candidate.level,
          text: candidate.text,
          fontSignature: candidate.fontSignature,
        });
      }
    }
  }

  // Step 5: Handle special keywords (must have different font from body)
  for (const candidate of keywordCandidates) {
    const fontKey = getFontSignatureKey(candidate.fontSignature);
    if (fontKey !== bodySignatureKey) {
      const key = `${candidate.pageNumber}|${candidate.blockIndex}|${candidate.lineIndex}`;
      confirmedHeadings.set(key, {
        pageNumber: candidate.pageNumber,
        blockIndex: candidate.blockIndex,
        lineIndex: candidate.lineIndex,
        level: candidate.level,
        text: candidate.text,
        fontSignature: candidate.fontSignature,
      });
    }
  }

  // Step 6: Assign heading levels based on font hierarchy
  assignHeadingLevelsByFontHierarchy(confirmedHeadings);

  return confirmedHeadings;
}

// Characters that indicate text continues (not a complete sentence)
const CONTINUES_PATTERN = /[,;:\-–—]["']?$/;

// Characters that indicate a list item
const LIST_ITEM_PATTERN =
  /^[\s]*([•\-\*\u2022\u2023\u2043]|\d+[.)\]]|[a-zA-Z][.)\]]|\([a-zA-Z0-9]+\))\s/;

// Hyphenated word at end of line (letter followed by hyphen at end)
// Includes: regular hyphen (-), soft hyphen (\u00AD), hyphen (\u2010), non-breaking hyphen (\u2011)
const HYPHEN_END_PATTERN = /[a-zA-Z\u00C0-\u024F][-\u00AD\u2010\u2011]$/;

// Common figure/table legend patterns
// Matches: "Fig. 1 Description", "Figure 1: Text", "Table 2. Results", etc.
// Uses [\s\u00A0] to handle non-breaking spaces from PDFs
const LEGEND_PATTERN =
  /^(fig\.?|figure|table|chart|graph|diagram|box|panel|source|note|image|photo|illustration|exhibit|map|scheme|plate|appendix)[\s\u00A0]*\d+/i;

// Reference patterns for detecting citations/superscripts
const REFERENCE_PATTERNS = [
  /[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g, // Unicode superscript numbers
  /\[\d+(?:[,\-–]\s*\d+)*\]/g, // [1], [1,2], [1-3]
  // Inline superscript numbers after lowercase letters or sentence-ending punctuation
  // Matches: "word1", "word12,13", "word1-3" (reference lists)
  // Excludes: "CO2" (uppercase), "0.5" (decimal), "1,000" (thousands - 3 digits after comma)
  // Requires 3+ letters before the number to avoid matching units like "a²", "km²", "m³"
  /(?<=[a-z]{3,}|[;:!?'"])\d{1,3}(?:[,\-–]\d{1,2})*(?=[.,;:\s]|$)/g,
  // Multi-digit reference lists: "104,105" - both sides have 2-3 digits (can't be thousands)
  // Thousands format is always 1-3 digits + comma + exactly 3 digits, so 2-3 + 2-3 is safe
  /(?<=[a-z]{3,}|[;:!?'"])\d{2,3}(?:[,\-–]\d{2,3})+(?=[.,;:\s]|$)/g,

  // === INLINE CITATION PATTERNS (Author, Year) style ===

  // Year-only citations: (2012), ( 2002 ), (2010 )
  /\(\s*(?:19|20)\d{2}\s*\)/g,

  // Year with page number(s): (2001, 16), (2001, 16–22), (2001, 16, 22, 45)
  /\(\s*(?:19|20)\d{2}\s*,\s*\d+(?:\s*[-–,]\s*\d+)*\s*\)/g,

  // Single author with year (comma): (Author, Year) or (M. Collier, 2001) or (Ministry of Tourism, 2020)
  // Author: Optional initials, starts with capital, may include lowercase words
  /\(\s*(?:[A-Z]\.\s*)*[A-Z][a-zA-Z\-']+(?:\s+[a-zA-Z\-']+)*\s*,\s*(?:19|20)\d{2}\s*\)/g,

  // Single author with year (no comma): (Buckley 2010) or (M. Smith 2015)
  /\(\s*(?:[A-Z]\.\s*)*[A-Z][a-zA-Z\-']+\s+(?:19|20)\d{2}\s*\)/g,

  // Author Year with page number(s): (Edgar 2004, 94) or (M. Collier 2001, 45) or (Edwards 2001, 87–96, 98)
  // Format: (Author Year, Page(s)) - optional initials, no comma before year, comma before page(s)
  /\(\s*(?:[A-Z]\.\s*)*[A-Z][a-zA-Z\-']+(?:\s+[a-zA-Z\-']+)*\s+(?:19|20)\d{2}\s*,\s*\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*\s*\)/g,

  // Author Year with colon page: (MacDougall 2006: 28) or (Smith 2010: 45-50)
  /\(\s*(?:[A-Z]\.\s*)*[A-Z][a-zA-Z\-']+(?:\s+[a-zA-Z\-']+)*\s+(?:19|20)\d{2}\s*:\s*\d+(?:\s*[-–]\s*\d+)?\s*\)/g,

  // Author et al. with year: (Kumar et al., 2013)
  /\(\s*[A-Z][a-zA-Z\-']+\s+et\s+al\.?\s*,\s*(?:19|20)\d{2}\s*\)/g,

  // Author et al. Year with page(s): (Kumar et al. 2013, 45) or (Kumar et al. 2013, 45-50, 52)
  /\(\s*[A-Z][a-zA-Z\-']+\s+et\s+al\.?\s+(?:19|20)\d{2}\s*,\s*\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*\s*\)/g,

  // Two authors with & or "and": (Author1 & Author2, Year) or (Kuhn and McAllister, 2006)
  /\(\s*[A-Z][a-zA-Z\-']+(?:\s+[A-Z][a-zA-Z\-']+)*\s*(?:&|and)\s*[A-Z][a-zA-Z\-']+(?:\s+[A-Z][a-zA-Z\-']+)*\s*,\s*(?:19|20)\d{2}\s*\)/g,

  // Two authors with & or "and" (no comma before year): (Kuhn and McAllister 2006)
  /\(\s*[A-Z][a-zA-Z\-']+(?:\s+[A-Z][a-zA-Z\-']+)*\s+(?:&|and)\s+[A-Z][a-zA-Z\-']+(?:\s+[A-Z][a-zA-Z\-']+)*\s+(?:19|20)\d{2}\s*\)/g,

  // Citation with prefix: (eg Copeland, 1991) or (see Author, Year)
  /\(\s*(?:e\.?g\.?|cf\.?|see)\s+[A-Z][a-zA-Z\-']+(?:\s+[a-zA-Z\-']+)*(?:\s+et\s+al\.?)?\s*,\s*(?:19|20)\d{2}\s*\)/g,

  // Citation with prefix, no comma before year: (see Dudding 2005) or (see Author Year, Page)
  /\(\s*(?:e\.?g\.?|cf\.?|see)\s+[A-Z][a-zA-Z\-']+(?:\s+[a-zA-Z\-']+)*(?:\s+et\s+al\.?)?\s+(?:19|20)\d{2}(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)?\s*\)/g,

  // Citation with combined prefix + two authors: (see, e.g., Kuhn and McAllister 2006)
  /\(\s*(?:see(?:\s+also)?)?[,\s]*(?:e\.?g\.?|cf\.?)?[,\s]*[A-Z][a-zA-Z\-']+\s+(?:&|and)\s+[A-Z][a-zA-Z\-']+(?:\s+[A-Z][a-zA-Z\-']+)*\s+(?:19|20)\d{2}\s*\)/g,

  // Same patterns for square brackets
  /\[\s*(?:19|20)\d{2}\s*\]/g,
  /\[\s*[A-Z][a-zA-Z\-']+(?:\s+[a-zA-Z\-']+)*\s*,\s*(?:19|20)\d{2}\s*\]/g,
  /\[\s*[A-Z][a-zA-Z\-']+\s+et\s+al\.?\s*,\s*(?:19|20)\d{2}\s*\]/g,

  // Multiple citations with semicolons - greedy match for parentheses/brackets containing
  // multiple year patterns separated by semicolons (handles line breaks)
  /\(\s*(?:e\.?g\.?\s*|cf\.?\s*|see\s+)?[^()]*?(?:19|20)\d{2}[^()]*?;[^()]*?(?:19|20)\d{2}[^()]*?\)/g,
  /\[\s*[^\[\]]*?(?:19|20)\d{2}[^\[\]]*?;[^\[\]]*?(?:19|20)\d{2}[^\[\]]*?\]/g,

  // === FIGURE/TABLE REFERENCES ===
  // (Figure 1), ( Figure 1 ), (Fig. 1), (Fig 1), (Figures 1-3), (Figure 1a)
  // Also with prefix: (see Figure 1), (see also Fig. 1)
  /\(\s*(?:see\s+(?:also\s+)?)?(?:Figures?|Figs?\.?)\s*\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?\s*\)/gi,
  // (Table 1), ( Table 1 ), (Tables 1-3), (Table 1a), (see Table 1)
  /\(\s*(?:see\s+(?:also\s+)?)?Tables?\s*\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?\s*\)/gi,
  // (Chart 1), (Graph 1), (Diagram 1), (Panel A), (Box 1), (Appendix A), (see Chart 1)
  /\(\s*(?:see\s+(?:also\s+)?)?(?:Charts?|Graphs?|Diagrams?|Panels?|Box(?:es)?|Appendix|Appendices)\s*[A-Z0-9]+[a-z]?(?:\s*[-–]\s*[A-Z0-9]+[a-z]?)?\s*\)/gi,
  // (Eq. 1), (Equation 1), (Eqs. 1-3), (see Eq. 1)
  /\(\s*(?:see\s+(?:also\s+)?)?(?:Equations?|Eqs?\.?)\s*\d+(?:\s*[-–]\s*\d+)?\s*\)/gi,
  // Same for square brackets
  /\[\s*(?:see\s+(?:also\s+)?)?(?:Figures?|Figs?\.?)\s*\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?\s*\]/gi,
  /\[\s*(?:see\s+(?:also\s+)?)?Tables?\s*\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?\s*\]/gi,

  // === PAGE REFERENCES ===
  // (p. 124), (p 124), (pp. 45-50), (page 124), (pages 45-50)
  /\(\s*(?:p\.?|pp\.?|pages?)\s*\d+(?:\s*[-–]\s*\d+)?\s*\)/gi,
];

// URL pattern - matches http(s):// URLs and www. URLs without protocol
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"{}|\\^`[\]]+/gi;

// Email pattern - matches standard email addresses
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Font-based superscript detection thresholds
const SUPERSCRIPT_FONT_RATIO = 0.78; // Font must be < 78% of average
const SUPERSCRIPT_MAX_LENGTH = 20; // Max characters for superscript (allows "104,105,106,107")

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
 * Validate that a superscript group is actually adjacent to normal-sized text
 * This prevents false positives like "25" in "Article 25" where the whole region is same size
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

/**
 * Check if a span is positioned as superscript (raised above baseline)
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

/**
 * Check if text is an ordinal suffix (st, nd, rd, th) following a number
 * Examples: 1st, 2nd, 3rd, 4th, 21st, 22nd, 23rd, 40th
 * Also handles "40 th" with space between number and suffix
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
 * Check if the word preceding a superscript position is too short (1-2 chars)
 * Short words like "a", "I", "to", "of" followed by small numbers are unlikely to be citations
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
 * Check if a superscript position is preceded by text on the same line
 * Superscripts should follow words (like "word¹"), not appear at start of lines
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
 * Check if a position in text is part of a number (decimal, thousands separator, or embedded in larger number)
 * This helps exclude false positives like "0.5", "1,000", or digits in the MIDDLE of "2014"
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

/**
 * Identify which span indices are superscripts
 * Returns a Set of span indices that should be treated as superscripts
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

/**
 * Calculate the dominant (most frequent) font size within a block
 * This is the reference for detecting superscripts in this block
 */
function getBlockDominantFontSize(
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
 * Find font-based superscript positions within a block's text
 * Uses tracked span positions for stable matching (no text searching)
 *
 * @param block - The structured block with span data
 * @param processedResult - The processed block text with position tracking
 * @param documentAvgFontSize - Fallback font size for reference
 */
function findFontBasedSuperscripts(
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

/**
 * Check if a line appears to be a list item
 */
function isListItem(text: string): boolean {
  return LIST_ITEM_PATTERN.test(text);
}

/**
 * Check if text appears to be a figure/table legend or caption
 * Exported for use in outline-matching
 */
export function isLegendOrCaption(text: string): boolean {
  return LEGEND_PATTERN.test(text.trim());
}

/**
 * Check if text matches common section heading patterns
 * These should NOT be treated as figure labels
 */
function isSectionHeadingPattern(text: string): boolean {
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
 * Check if a block appears to be a heading based on font styling
 * Headings are typically bold or have larger font size
 */
function isStyledAsHeading(
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

/**
 * Check if text is a potential figure label (short, no sentence-ending punctuation)
 */
function isPotentialFigureLabel(text: string): boolean {
  const trimmed = text.trim();
  // Short text without sentence-ending punctuation
  return (
    trimmed.length > 0 &&
    trimmed.length < FIGURE_LABEL_MAX_CHARS &&
    !/[.!?]$/.test(trimmed)
  );
}

/**
 * Detect figure labels on a page by identifying clusters of short non-sentence text blocks
 * Returns a Set of block indices that should be marked as figure labels
 */
function detectFigureLabels(
  blocks: StructuredBlock[],
  avgFontSize: number
): Set<number> {
  const labelBlockIndices = new Set<number>();

  // Find blocks that look like figure labels
  const potentialLabels: Array<{ index: number; text: string }> = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const text = block.lines
      .map((l) => l.text)
      .join(" ")
      .trim();

    if (isPotentialFigureLabel(text)) {
      // Exclude section headings (by pattern or styling)
      if (isSectionHeadingPattern(text)) continue;
      if (isStyledAsHeading(block, avgFontSize)) continue;

      potentialLabels.push({ index: i, text });
    }
  }

  // If page has enough short non-sentence blocks, mark them as figure labels
  if (potentialLabels.length >= FIGURE_LABEL_MIN_BLOCKS) {
    for (const { index } of potentialLabels) {
      labelBlockIndices.add(index);
    }
  }

  return labelBlockIndices;
}

/**
 * Detect reference citations in text (superscripts, bracketed numbers, etc.)
 * Returns array of {start, end} positions for each detected reference
 */
export function detectReferences(
  text: string
): Array<{ start: number; end: number }> {
  const references: Array<{ start: number; end: number }> = [];

  // Apply each pattern
  for (const pattern of REFERENCE_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      references.push({
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  // Sort by start position
  references.sort((a, b) => a.start - b.start);

  // Merge overlapping ranges
  const merged: Array<{ start: number; end: number }> = [];
  for (const ref of references) {
    const last = merged[merged.length - 1];
    if (last && ref.start <= last.end) {
      // Overlapping, extend the previous range
      last.end = Math.max(last.end, ref.end);
    } else {
      merged.push({ ...ref });
    }
  }

  return merged;
}

/**
 * Detect URLs in text (http(s):// and www. URLs)
 * Returns array of {start, end} positions for each detected URL
 */
export function detectURLs(
  text: string
): Array<{ start: number; end: number }> {
  const urls: Array<{ start: number; end: number }> = [];

  URL_PATTERN.lastIndex = 0;
  let match;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    // Clean trailing punctuation that's likely not part of the URL
    let url = match[0];
    let end = match.index + url.length;

    // Remove trailing punctuation that's commonly not part of URLs
    while (url.length > 0 && /[.,;:!?)}\]>]$/.test(url)) {
      url = url.slice(0, -1);
      end--;
    }

    if (url.length > 0) {
      urls.push({ start: match.index, end });
    }
  }

  return urls;
}

/**
 * Detect email addresses in text
 * Returns array of {start, end} positions for each detected email
 */
export function detectEmails(
  text: string
): Array<{ start: number; end: number }> {
  const emails: Array<{ start: number; end: number }> = [];

  EMAIL_PATTERN.lastIndex = 0;
  let match;
  while ((match = EMAIL_PATTERN.exec(text)) !== null) {
    emails.push({ start: match.index, end: match.index + match[0].length });
  }

  return emails;
}

/**
 * Check if text ends with a hyphenated word break
 */
function endsWithHyphen(text: string): boolean {
  return HYPHEN_END_PATTERN.test(text.trim());
}

/**
 * Check if line ends with sentence-ending punctuation
 */
function endsWithPunctuation(text: string): boolean {
  return SENTENCE_END_CHARS.test(text.trim());
}

/**
 * Check if there's a significant vertical gap between lines
 */
function hasLargeVerticalGap(
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
 * Check if a line is "full width" (reaches near the typical line width)
 * Compares against max line width in block, not block bbox (which may include margins)
 */
function isFullWidthLine(
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
 * Check if font changed significantly (indicating heading/body transition)
 * Only triggers if previous line ends with punctuation (complete heading)
 * This avoids breaking on inline bold labels like "Ice shelves. Text continues..."
 */
function hasFontChange(
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
    if (SENTENCE_END_CHARS.test(prevText)) {
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
function areOnSameRow(line1: StructuredLine, line2: StructuredLine): boolean {
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
 * Check if current line has significant indentation (new paragraph)
 * Only applies to vertically stacked lines, not horizontally adjacent text
 */
function hasIndentation(
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

/**
 * Determine if we should keep a line break between two lines
 */
function shouldKeepLineBreak(
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

/**
 * Join two text strings, handling hyphenation
 */
function joinText(
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
function processBlockLines(
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

/**
 * Result of processing a block with position tracking
 */
interface ProcessedBlockResult {
  text: string;
  spanPositions: Map<number, { start: number; end: number }>; // spanIndex → position in text
  fontRanges: FontRange[]; // Font info for each portion of text
}

/**
 * Process a block's lines into text while tracking where each span lands
 * This enables stable superscript position mapping without text searching
 */
function processBlockWithTracking(
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
        // Only skip adding space if the previous text ends with whitespace or
        // current text starts with whitespace (MuPDF already provided it).
        const prevEndsWithSpace = /\s$/.test(result);
        const currStartsWithSpace = /^\s/.test(currentText);

        // Detect mid-word line breaks using Y position AND X gap
        // If two MuPDF "lines" have the same Y position AND are close together (small X gap),
        // it's a word split and should be joined without a space.
        // If they have the same Y but a larger gap, they're separate words needing a space.
        let isWordSplit = false;
        const fontSize = prevLine.font.size || 12;

        if (sameVisualLine) {
          // Check X gap to distinguish word splits from separate words
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
          currentText.length > 0;

        if (needsSpace) {
          result += " ";
        }
        const startPos = result.length;
        result += currentText;
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

/**
 * Check if a block's text likely continues into the next block
 * (for multi-column layouts where sentences span columns)
 */
function blockContinuesToNext(blockText: string): boolean {
  const trimmed = blockText.trim();
  if (!trimmed) return false;

  // Get the last line of the block
  const lines = trimmed.split("\n");
  const lastLine = lines[lines.length - 1].trim();
  if (!lastLine) return false;

  // If ends with sentence-ending punctuation, it's complete
  if (SENTENCE_END_CHARS.test(lastLine)) return false;

  // If ends with continuation characters (comma, hyphen, dash), it continues
  if (CONTINUES_PATTERN.test(lastLine)) return true;

  // If ends with a word (no punctuation), likely continues
  // Check if last character is alphanumeric
  const lastChar = lastLine[lastLine.length - 1];
  if (/[a-zA-Z0-9\u00C0-\u024F]/.test(lastChar)) return true;

  return false;
}

/**
 * Check if a block's text is a continuation from a previous block
 */
function blockContinuesFromPrevious(blockText: string): boolean {
  const trimmed = blockText.trim();
  if (!trimmed) return false;

  // Get the first line of the block
  const lines = trimmed.split("\n");
  const firstLine = lines[0].trim();
  if (!firstLine) return false;

  // If starts with lowercase letter, it's a continuation
  if (/^[a-z\u00E0-\u00FF]/.test(firstLine)) return true;

  // If starts with a list item, it's NOT a continuation
  if (LIST_ITEM_PATTERN.test(firstLine)) return false;

  return false;
}

/**
 * Find the nearest column X position and return the distance
 */
function findNearestColumnDistance(
  x: number,
  typicalXPositions: Set<number>
): number {
  if (typicalXPositions.size === 0) return 0;

  let minDistance = Infinity;
  for (const colX of typicalXPositions) {
    const distance = Math.abs(x - colX);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }
  return minDistance;
}

// Anomaly scoring constants
const ANOMALY_THRESHOLD = 4; // Minimum score to be flagged as anomaly
const SHORT_BLOCK_THRESHOLD = 100; // Characters
const LONG_BLOCK_THRESHOLD = 200; // Characters

// Violation zone constants
const ZONE_SCORE_BONUS = 4; // Points added for being in violation zone

/**
 * Tracks a "violation zone" - a region where reading order violations indicate
 * figure/caption content. Blocks in this zone are likely anomalies even if they
 * don't individually violate reading order.
 */
interface ViolationZone {
  active: boolean;
  anchorX: number; // X position that defines the zone
  prevNormalY: number; // Y of last normal block before zone started
  prevNormalColumn: number; // Column index of last normal block
}

// Legend pattern for scoring
const LEGEND_SCORE_PATTERN =
  /^(fig\.?|figure|table|chart|graph|diagram|box|panel|source|note|image|photo|illustration|exhibit|map|scheme|plate|appendix)[\s\u00A0]*(\d+)/i;

/**
 * Result of calculating anomaly score
 */
interface AnomalyScore {
  total: number;
  factors: string[]; // For debugging
}

/**
 * Calculate anomaly score for a block based on multiple factors.
 * Higher score = more likely to be an anomaly (caption, figure label, etc.)
 *
 * Scoring factors:
 * - Distance from column (41-80px): +2
 * - Distance from column (>80px): +4
 * - Starts with "Figure/Table X." (with delimiter): +3
 * - Starts with "Figure/Table X" (no delimiter): +1
 * - Block is short (< 100 chars): +2
 * - Adjacent to confirmed anomaly: +1-2
 * - Reading order violation: +3
 * - Block length > 200 chars: -2
 */
// Debug flag for anomaly scoring
const DEBUG_ANOMALY_SCORING = false;
const DEBUG_ANOMALY_PATTERN = "differences are relative";

// Debug flag for line break investigation
const DEBUG_LINE_BREAK = false;
const DEBUG_LINE_BREAK_PATTERN = "schematic of a bhj";

// Debug flag for heading detection investigation
const DEBUG_HEADING = true;
const DEBUG_HEADING_PATTERN = "1 introduction";

// Debug flag for line joining investigation
const DEBUG_LINE_JOIN = false;
const DEBUG_LINE_JOIN_PATTERN = "";

function calculateAnomalyScore(
  blockText: string,
  context: {
    distanceToColumn: number;
    hasReadingOrderViolation: boolean;
    adjacentAnomalies: number;
    inViolationZone: boolean;
  }
): AnomalyScore {
  let score = 0;
  const factors: string[] = [];

  const text = blockText.trim();
  const shouldDebug =
    DEBUG_ANOMALY_SCORING && text.toLowerCase().includes(DEBUG_ANOMALY_PATTERN);

  // 1. Distance from column
  if (context.distanceToColumn > 80) {
    score += 4;
    factors.push(`far-from-column(${context.distanceToColumn}px)`);
  } else if (context.distanceToColumn > 40) {
    score += 2;
    factors.push(`off-column(${context.distanceToColumn}px)`);
  }

  // 2. Figure/Table pattern
  const legendMatch = text.match(LEGEND_SCORE_PATTERN);
  if (legendMatch) {
    // Check for delimiter after number
    const afterNumber = text.slice(legendMatch[0].length);
    const hasDelimiter = /^[.:)\-–—]/.test(afterNumber.trim());

    if (hasDelimiter) {
      score += 3;
      factors.push("legend-pattern-with-delimiter");
    } else {
      score += 1;
      factors.push("legend-pattern-weak");
    }
  }

  // 3. Block length - skip penalty if in violation zone (figure legends can be long)
  if (!context.inViolationZone) {
    if (text.length < SHORT_BLOCK_THRESHOLD) {
      score += 2;
      factors.push("short-block");
    } else if (text.length > LONG_BLOCK_THRESHOLD) {
      score -= 2;
      factors.push("long-block");
    }
  }

  // 4. Adjacent anomalies (clustering)
  if (context.adjacentAnomalies > 0) {
    const adjacencyBonus = Math.min(context.adjacentAnomalies, 2); // +1 per adjacent, max +2
    score += adjacencyBonus;
    factors.push(`adjacent-anomalies(${context.adjacentAnomalies})`);
  }

  // 5. Reading order violation
  if (context.hasReadingOrderViolation) {
    score += 3;
    factors.push("reading-order-violation");
  }

  // 6. Violation zone membership
  if (context.inViolationZone) {
    score += ZONE_SCORE_BONUS;
    factors.push("in-violation-zone");
  }

  // Debug output
  if (shouldDebug) {
    console.log(`[AnomalyDebug] Block containing "${DEBUG_ANOMALY_PATTERN}":`);
    console.log(
      `  text: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`
    );
    console.log(`  length: ${text.length} chars`);
    console.log(`  distanceToColumn: ${context.distanceToColumn}px`);
    console.log(
      `  hasReadingOrderViolation: ${context.hasReadingOrderViolation}`
    );
    console.log(`  inViolationZone: ${context.inViolationZone}`);
    console.log(`  adjacentAnomalies: ${context.adjacentAnomalies}`);
    console.log(`  factors: [${factors.join(", ")}]`);
    console.log(`  SCORE: ${score} (threshold: ${ANOMALY_THRESHOLD})`);
    console.log(
      `  RESULT: ${score >= ANOMALY_THRESHOLD ? "ANOMALY" : "NORMAL"}`
    );
  }

  return { total: score, factors };
}

/**
 * Count adjacent anomaly blocks (immediately before and after)
 */
function countAdjacentAnomalies(
  blockData: Array<{ sectionType: string }>,
  index: number
): number {
  let count = 0;
  if (index > 0 && blockData[index - 1].sectionType === "anomaly") {
    count++;
  }
  if (
    index < blockData.length - 1 &&
    blockData[index + 1].sectionType === "anomaly"
  ) {
    count++;
  }
  return count;
}

/**
 * Determine which column a block belongs to (0-indexed from left)
 * Returns the column index, or -1 if not aligned with any column
 *
 * @param x - Block's X position
 * @param sortedColumnXPositions - Array of column X positions sorted left-to-right
 * @param tolerancePx - Max distance to be considered "in" a column
 */
function getBlockColumnIndex(
  x: number,
  sortedColumnXPositions: number[],
  tolerancePx: number = 40
): number {
  if (sortedColumnXPositions.length === 0) return -1;

  for (let i = 0; i < sortedColumnXPositions.length; i++) {
    const colX = sortedColumnXPositions[i];
    if (Math.abs(x - colX) <= tolerancePx) {
      return i;
    }
  }

  return -1; // Not aligned with any column
}

/**
 * Calculate typical X positions across all pages (column detection)
 * Counts exact X positions and keeps only high-frequency ones (main columns)
 */
function calculateTypicalXPositions(pages: StructuredPage[]): Set<number> {
  // Count exact X positions across all pages
  const xCounts = new Map<number, number>();

  for (const page of pages) {
    for (const block of page.blocks) {
      const x = Math.round(block.bbox.x); // Round to nearest pixel
      xCounts.set(x, (xCounts.get(x) || 0) + 1);
    }
  }

  // Find the maximum count
  const maxCount = Math.max(...xCounts.values());

  // Keep positions that have at least 30% of the max count (these are columns)
  const threshold = maxCount * 0.3;
  const typicalPositions = new Set<number>();
  const excluded: Array<{ x: number; count: number }> = [];

  for (const [x, count] of xCounts) {
    if (count >= threshold) {
      typicalPositions.add(x);
    } else {
      excluded.push({ x, count });
    }
  }

  return typicalPositions;
}

/**
 * Join lines within blocks into coherent paragraphs
 * Lines that are part of the same paragraph are joined with spaces
 * Paragraph breaks are preserved as double newlines
 * Also handles multi-column layouts where sentences span blocks
 */
/**
 * Result of joining pages with highlights
 */
export interface JoinedPagesResult {
  text: string;
  highlights: Array<{ start: number; end: number; type: HighlightType }>;
  fontRanges: FontRange[];
  headingCandidates: BlockHeadingCandidate[];
}

/**
 * Join pages into final text, handling cross-page hyphens
 * Also aggregates highlights with correct offsets
 */
export function joinPagesWithHyphenHandling(
  pages: StructuredPage[]
): JoinedPagesResult {
  if (pages.length === 0)
    return { text: "", highlights: [], fontRanges: [], headingCandidates: [] };

  let result = pages[0].rawText;
  const allHighlights: Array<{
    start: number;
    end: number;
    type: HighlightType;
    sectionLevel?: number; // For heading type
  }> = [];
  const allFontRanges: FontRange[] = [];
  const allHeadingCandidates: BlockHeadingCandidate[] = [];

  // Add highlights from first page (offset 0)
  if (pages[0].highlights) {
    for (const h of pages[0].highlights) {
      allHighlights.push({ ...h });
    }
  }

  // Add font ranges from first page (offset 0)
  if (pages[0].fontRanges) {
    for (const fr of pages[0].fontRanges) {
      allFontRanges.push({ ...fr });
    }
  }

  // Add heading candidates from first page (offset 0)
  if (pages[0].headingCandidates) {
    for (const hc of pages[0].headingCandidates) {
      allHeadingCandidates.push({ ...hc });
    }
  }

  for (let i = 1; i < pages.length; i++) {
    const currentPage = pages[i];

    // Check for existing paragraph breaks at the boundary BEFORE trimming
    const prevEndsWithParagraphBreak = /\n\n\s*$/.test(result);
    const currStartsWithParagraphBreak = /^\s*\n\n/.test(currentPage.rawText);
    const hasExistingParagraphBreak =
      prevEndsWithParagraphBreak || currStartsWithParagraphBreak;

    const prevText = result.trimEnd();
    const trimmedResultLength = prevText.length;
    const currentText = currentPage.rawText.trimStart();

    // IMPORTANT: Update previous font ranges that extend past the trimmed length
    // Without this, ranges would overlap after page joining
    for (const fr of allFontRanges) {
      if (fr.end > trimmedResultLength) {
        fr.end = trimmedResultLength;
      }
    }

    // Calculate the leading whitespace trimmed from current page
    const leadingTrimmed =
      currentPage.rawText.length - currentPage.rawText.trimStart().length;

    let textOffset: number;

    // Check if previous page ends with hyphenated word
    if (HYPHEN_END_PATTERN.test(prevText)) {
      // Remove hyphen and join directly (no space, no newlines)
      result = prevText.slice(0, -1) + currentText;
      textOffset = prevText.length - 1; // -1 for removed hyphen
    } else if (hasExistingParagraphBreak) {
      // Preserve existing paragraph break from either page
      result = prevText + "\n\n" + currentText;
      textOffset = prevText.length + 2; // +2 for \n\n
    } else if (blockContinuesToNext(prevText)) {
      // Previous page ends mid-sentence, join with space
      result = prevText + " " + currentText;
      textOffset = prevText.length + 1; // +1 for space
    } else {
      // Normal page break
      result = prevText + "\n\n" + currentText;
      textOffset = prevText.length + 2; // +2 for \n\n
    }

    // Add highlights from current page with adjusted offset
    if (currentPage.highlights) {
      for (const h of currentPage.highlights) {
        allHighlights.push({
          ...h, // Preserve all properties (sectionLevel, sectionTitle, verified, etc.)
          start: h.start - leadingTrimmed + textOffset,
          end: h.end - leadingTrimmed + textOffset,
        });
      }
    }

    // Add font ranges from current page with adjusted offset
    if (currentPage.fontRanges) {
      for (const fr of currentPage.fontRanges) {
        const adjustedStart = fr.start - leadingTrimmed + textOffset;
        const adjustedEnd = fr.end - leadingTrimmed + textOffset;
        if (adjustedEnd > adjustedStart) {
          allFontRanges.push({
            ...fr,
            start: adjustedStart,
            end: adjustedEnd,
          });
        }
      }
    }

    // Add heading candidates from current page with adjusted offset
    if (currentPage.headingCandidates) {
      for (const hc of currentPage.headingCandidates) {
        const adjustedStart = hc.textStart - leadingTrimmed + textOffset;
        const adjustedEnd = hc.textEnd - leadingTrimmed + textOffset;
        if (adjustedEnd > adjustedStart) {
          allHeadingCandidates.push({
            ...hc,
            textStart: adjustedStart,
            textEnd: adjustedEnd,
          });
        }
      }
    }
  }

  const trimmedResult = result.trim();
  const leadingWhitespace = result.length - result.trimStart().length;

  // Adjust all highlights for final trim
  const adjustedHighlights = allHighlights
    .map((h) => ({
      ...h,
      start: Math.max(0, h.start - leadingWhitespace),
      end: Math.max(0, h.end - leadingWhitespace),
    }))
    .filter((h) => h.end > h.start && h.start < trimmedResult.length);

  // Adjust all font ranges for final trim
  const adjustedFontRanges = allFontRanges
    .map((fr) => ({
      ...fr,
      start: Math.max(0, fr.start - leadingWhitespace),
      end: Math.max(0, fr.end - leadingWhitespace),
    }))
    .filter((fr) => fr.end > fr.start && fr.start < trimmedResult.length);

  // Adjust all heading candidates for final trim
  const adjustedHeadingCandidates = allHeadingCandidates
    .map((hc) => ({
      ...hc,
      textStart: Math.max(0, hc.textStart - leadingWhitespace),
      textEnd: Math.max(0, hc.textEnd - leadingWhitespace),
    }))
    .filter(
      (hc) => hc.textEnd > hc.textStart && hc.textStart < trimmedResult.length
    );

  // Run reference detection on the FINAL joined text to catch references split across pages
  // Example: "(see Author, 2005" on page 1 and "; Other, 2006)" on page 2
  const crossPageRefs = detectReferences(trimmedResult);
  for (const ref of crossPageRefs) {
    // Only add if not overlapping with existing highlights
    const overlapsExisting = adjustedHighlights.some(
      (h) =>
        (ref.start >= h.start && ref.start < h.end) ||
        (ref.end > h.start && ref.end <= h.end)
    );
    if (!overlapsExisting) {
      adjustedHighlights.push({
        start: ref.start,
        end: ref.end,
        type: "reference",
      });
    }
  }

  // ============================================================================
  // ARTIFACT REMOVAL → TOC/BIB DETECTION → HEADING DETECTION
  // Remove artifacts FIRST so they don't interfere with section detection
  // ============================================================================

  // Step 1: Extract artifact highlights (header, footer, page_number)
  const artifactHighlights = adjustedHighlights.filter(
    (h) =>
      h.type === "header" || h.type === "footer" || h.type === "page_number"
  );

  // Step 2: Create cleaned text by removing artifact ranges
  const { cleanedText, positionMap } = removeHighlightedRanges(
    trimmedResult,
    artifactHighlights
  );

  // Step 3: Adjust font ranges for the cleaned text
  const cleanedFontRanges = adjustFontRangesForRemovals(
    adjustedFontRanges,
    artifactHighlights
  );

  // Step 3b: Adjust heading candidates for the cleaned text
  // Convert positions from original text to cleaned text coordinates
  const cleanedHeadingCandidates: BlockHeadingCandidate[] = [];
  for (const hc of adjustedHeadingCandidates) {
    const cleanedStart = positionMap.toClean(hc.textStart);
    const cleanedEnd = positionMap.toClean(hc.textEnd);
    if (cleanedEnd > cleanedStart && cleanedStart < cleanedText.length) {
      cleanedHeadingCandidates.push({
        ...hc,
        textStart: cleanedStart,
        textEnd: Math.min(cleanedEnd, cleanedText.length),
      });
    }
  }

  // Step 4: Detect TOC on cleaned text (typically at beginning of document)
  const tocResult = detectTOC(cleanedText, pages);
  if (tocResult.hasTOC) {
    // Map positions back to original text
    adjustedHighlights.push({
      start: positionMap.toOriginal(tocResult.tocStartOffset),
      end: positionMap.toOriginal(tocResult.tocEndOffset),
      type: "toc",
    });
  }

  // Step 5: Detect Bibliography on cleaned text (typically at end of document)
  const bibResult = detectBibliography(cleanedText, pages, []);
  if (bibResult.hasBibliography) {
    // Map positions back to original text
    adjustedHighlights.push({
      start: positionMap.toOriginal(bibResult.startOffset),
      end: positionMap.toOriginal(bibResult.endOffset),
      type: "bibliography",
    });
  }

  // Step 6: Detect headings on cleaned text
  // Exclude TOC and bibliography ranges (in cleaned text coordinates)
  const excludeRanges: Array<{ start: number; end: number }> = [];
  if (tocResult.hasTOC) {
    excludeRanges.push({
      start: tocResult.tocStartOffset,
      end: tocResult.tocEndOffset,
    });
  }
  if (bibResult.hasBibliography) {
    excludeRanges.push({
      start: bibResult.startOffset,
      end: bibResult.endOffset,
    });
  }

  // Run text-based heading detection with exclude ranges and Stage 1 candidates
  const headingHighlights = detectHeadingsFromText(
    cleanedText,
    cleanedFontRanges,
    excludeRanges,
    cleanedHeadingCandidates
  );
  for (const heading of headingHighlights) {
    // Map positions back to original text
    adjustedHighlights.push({
      start: positionMap.toOriginal(heading.start),
      end: positionMap.toOriginal(heading.end),
      type: heading.type,
      sectionLevel: heading.sectionLevel,
    });
  }

  // Step 7: Expand anomaly clusters in the final joined text
  // Now that headings are confirmed, we can safely expand anomalies
  // to absorb short gaps between them (respecting heading boundaries)
  const expandedHighlights = expandAnomalyHighlights(
    trimmedResult,
    adjustedHighlights,
    CLUSTER_SHORT_THRESHOLD
  );

  return {
    text: trimmedResult,
    highlights: expandedHighlights,
    fontRanges: adjustedFontRanges,
    headingCandidates: adjustedHeadingCandidates,
  };
}

export function joinLinesIntoParagraphs(
  pages: StructuredPage[],
  averageFontSize: number,
  options: ParagraphJoiningOptions = {}
): StructuredPage[] {
  // Pre-process: Normalize curly quotes to straight quotes
  // This simplifies all downstream pattern matching
  const normalizedPages = pages.map(normalizePageQuotes);

  // Pre-process: Split blocks at significant font boundaries
  // This separates headings from body text when MuPDF groups them together
  const splitPages = splitBlocksByFontBoundary(normalizedPages);

  // Calculate body text font signature for heading line detection
  const bodySignature = calculateBodyTextSignature(splitPages);

  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
    bodyFontSize: bodySignature.size,
    bodyFontWeight: bodySignature.weight,
  };

  // Calculate typical X positions across entire document (column detection)

  const typicalXPositions = calculateTypicalXPositions(splitPages);

  // Create sorted array of column positions for reading order detection
  const sortedColumnXPositions = [...typicalXPositions].sort((a, b) => a - b);

  // Detect repeating artifacts (headers, footers, page numbers) across all pages
  const { pageArtifacts } = detectArtifacts(splitPages);

  // NOTE: Heading detection is now done AFTER text joining in joinPagesWithHyphenHandling
  // using detectHeadingsFromText, which runs after TOC/bibliography detection to avoid
  // false positives from dense numbered entries in those sections.

  // Track cumulative normal text across pages for abstract detection
  let cumulativeNormalTextLength = 0;

  const totalPages = splitPages.length;

  return splitPages.map((page, pageIndex) => {
    // Calculate position in document (0 = first page, 1 = last page)
    const pagePosition = pageIndex / Math.max(1, totalPages - 1);

    // Section types for marking (includes artifact types)
    // NOTE: "heading" is no longer a block-level section type - headings are detected
    // post-hoc on joined text via detectHeadingsFromText in joinPagesWithHyphenHandling
    type SectionType =
      | "normal"
      | "legend"
      | "anomaly"
      | "footnote"
      | "figure_label"
      | "header"
      | "footer"
      | "page_number"
      | "author";

    // Get artifact info for this page
    const pageArtifactBlocks = pageArtifacts.get(page.pageNumber);

    // Detect figure labels on this page (clusters of short non-sentence blocks)
    // TEMPORARILY DISABLED for testing - too many false positives
    // const figureLabelIndices = detectFigureLabels(page.blocks, averageFontSize);
    const figureLabelIndices = new Set<number>();

    // Store block text with position and font info for anomaly detection
    const blockData: Array<{
      text: string;
      x: number;
      bbox: { x: number; y: number; w: number; h: number };
      fontSize: number;
      isBold: boolean;
      firstLineBold: boolean; // Whether first line is bold (for section heading detection)
      firstLineDifferentSize: boolean; // Whether first line has different font size (heading indicator)
      sectionType: SectionType;
      fontSuperscripts: Array<{ start: number; end: number }>; // Font-based superscripts within block
      columnIndex: number; // Which column this block belongs to (-1 if not aligned)
      fontRanges: FontRange[]; // Font info for each line in block (block-relative offsets)
      // Scoring context for two-pass adjacency scoring
      distanceToColumn: number;
      hasReadingOrderViolation: boolean;
      inViolationZone: boolean; // Whether block is in a violation zone (figure region)
      // Line Y positions for same-row detection
      firstLineY: number; // Y position of first line in block
      lastLineY: number; // Y position of last line in block
      // Line font info for heading transition detection at block boundaries
      firstLineFontSize: number;
      lastLineFontSize: number;
      lastLineBold: boolean;
      // Stage 1 heading candidate (detected at block level with full signal access)
      headingCandidate: BlockHeadingCandidate | null;
    }> = [];

    // Track violation zone state across blocks within this page
    let violationZone: ViolationZone = {
      active: false,
      anchorX: 0,
      prevNormalY: 0,
      prevNormalColumn: -1,
    };

    let blockIndex = 0;
    let prevBlockForHeading: StructuredBlock | null = null; // For heading gap calculation
    for (const block of page.blocks) {
      // Debug: Check if this block contains our target pattern
      const blockFirstLine = block.lines.length > 0 ? block.lines[0].text : "";
      if (
        DEBUG_HEADING &&
        blockFirstLine.toLowerCase().includes(DEBUG_HEADING_PATTERN)
      ) {
        console.log(
          `[BlockLoop] Found block with target pattern on page ${page.pageNumber}`
        );
        console.log(`  firstLine: "${blockFirstLine}"`);
        console.log(`  lines: ${block.lines.length}`);
      }

      // Process block with position tracking for stable superscript detection
      const processedResult = processBlockWithTracking(block, opts);
      const blockText = processedResult.text;

      if (blockText.length > 1) {
        // Get average font size from block lines
        const fontSizes = block.lines
          .map((l) => l.font.size)
          .filter((s) => s > 0);
        const avgFontSize =
          fontSizes.length > 0
            ? fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length
            : 12;

        // Check if block is predominantly bold
        const boldLines = block.lines.filter(
          (l) => l.font.weight === "bold"
        ).length;
        const isBold = boldLines > block.lines.length / 2;

        // Check if first line is bold (for detecting section headings)
        const firstLineBold =
          block.lines.length > 0 && block.lines[0].font.weight === "bold";

        // Check if first line has different font size (heading typically has larger/different font)
        const firstLineSize =
          block.lines.length > 0 ? block.lines[0].font.size : avgFontSize;
        const firstLineDifferentSize =
          Math.abs(firstLineSize - avgFontSize) > 1;

        // Determine section type for this block
        // Check artifacts first (highest priority - repeating headers/footers/page numbers)
        const artifactType = pageArtifactBlocks?.get(blockIndex);

        // Calculate distance to nearest column for scoring
        const blockX = Math.round(block.bbox.x);
        const distanceToColumn = findNearestColumnDistance(
          blockX,
          typicalXPositions
        );

        const blockIsFigureLabel = figureLabelIndices.has(blockIndex);
        // Note: footnote detection needs comparison with previous block, done later

        // Get column index for reading order detection (blockX already calculated above)
        const columnIndex = getBlockColumnIndex(blockX, sortedColumnXPositions);

        // Reading order anomaly detection:
        // If this block is higher on the page (smaller Y) than the previous NORMAL block,
        // it's only valid if it moved to a column to the RIGHT.
        // If it's in the same column or a column to the LEFT, it's an anomaly.
        //
        // We only compare against previous "normal" blocks, not blocks already tagged
        // as legend, anomaly, artifact, etc. (those can appear anywhere on the page).
        // Also skip blocks in the bottom zone (likely page numbers/footers not caught
        // by artifact detection but extracted first due to PDF internal ordering).
        let blockIsReadingOrderAnomaly = false;

        // Find the last "normal" block to compare against
        // Skip blocks in the bottom 15% of the page (likely footers/page numbers)
        const bottomZoneThreshold = page.height * 0.85;
        let prevNormalBlock: (typeof blockData)[number] | undefined;
        for (let i = blockData.length - 1; i >= 0; i--) {
          const isInBottomZone = blockData[i].bbox.y > bottomZoneThreshold;
          if (blockData[i].sectionType === "normal" && !isInBottomZone) {
            prevNormalBlock = blockData[i];
            break;
          }
        }

        if (prevNormalBlock) {
          const currentY = block.bbox.y;
          const prevY = prevNormalBlock.bbox.y;

          // Block is higher on page than previous normal block
          if (currentY < prevY) {
            const prevColumnIndex = prevNormalBlock.columnIndex;

            // Both blocks must be aligned with columns for this check to apply
            if (columnIndex !== -1 && prevColumnIndex !== -1) {
              // If current column is same or to the left of previous column, it's an anomaly
              if (columnIndex <= prevColumnIndex) {
                blockIsReadingOrderAnomaly = true;
              }
            }
          }
        }

        // Violation zone tracking:
        // When a reading order violation is detected, establish a "zone" that captures
        // subsequent blocks with similar X position until we exit back to normal reading.
        const blockY = block.bbox.y;

        // Check if we should EXIT the zone
        if (violationZone.active) {
          const atMainColumn = distanceToColumn <= 40;
          const resumedForwardReading = blockY >= violationZone.prevNormalY;

          if (atMainColumn && resumedForwardReading) {
            violationZone.active = false;
          }
        }

        // Check if block is IN the zone (before checking if it starts a new zone)
        // Zone membership: any block with Y < prevNormalY while zone is active
        // (X check removed - figure regions can span multiple columns)
        let inViolationZone = false;
        if (violationZone.active) {
          const stillBehind = blockY < violationZone.prevNormalY;
          if (stillBehind) {
            inViolationZone = true;
          }
        }

        // Check if this block STARTS a new zone (reading order violation)
        if (
          blockIsReadingOrderAnomaly &&
          !violationZone.active &&
          prevNormalBlock
        ) {
          violationZone = {
            active: true,
            anchorX: blockX,
            prevNormalY: prevNormalBlock.bbox.y,
            prevNormalColumn: prevNormalBlock.columnIndex,
          };
          inViolationZone = true;
        }

        // Check for author block
        // Only detect author blocks in the first 15% of the document.
        // This prevents bibliography entries (at document end) from being
        // incorrectly marked as "author" blocks, which would cause them to
        // get separated with \n\n and break multi-line bibliography entries.
        let blockIsAuthor = false;
        const isEarlyInDocument = pagePosition < 0.15;

        if (isEarlyInDocument) {
          // Check if block contains metadata author (bypass candidate pre-filter)
          const containsMetadataAuthor =
            opts.metadataAuthor &&
            opts.metadataAuthor.trim().length >= 3 &&
            blockText
              .toLowerCase()
              .includes(opts.metadataAuthor.trim().toLowerCase());

          if (isAuthorBlockCandidate(blockText) || containsMetadataAuthor) {
            const authorResult = detectAuthorBlock(blockText, {
              debug: false,
              metadataAuthor: opts.metadataAuthor,
            });
            blockIsAuthor = authorResult.isAuthorBlock;
          }
        }

        let sectionType: SectionType = "normal";

        // NOTE: Heading detection is now done post-hoc on joined text via detectHeadingsFromText
        // in joinPagesWithHyphenHandling. Block-level heading detection has been removed.

        // Calculate anomaly score (first pass, no adjacency info yet)
        const anomalyScore = calculateAnomalyScore(blockText, {
          distanceToColumn,
          hasReadingOrderViolation: blockIsReadingOrderAnomaly,
          adjacentAnomalies: 0, // Will be updated in second pass
          inViolationZone,
        });

        if (artifactType) {
          // Artifact types: 'header' | 'footer' | 'page_number'
          sectionType = artifactType;
        } else if (blockIsAuthor) {
          sectionType = "author";
        } else if (blockIsFigureLabel) {
          // Figure labels take precedence over anomaly detection
          sectionType = "figure_label";
        } else if (anomalyScore.total >= ANOMALY_THRESHOLD) {
          sectionType = "anomaly";
        }
        // Footnote detection is relative, will be updated in the joining loop

        // Find font-based superscripts using tracked positions (stable matching)
        const fontSuperscripts = findFontBasedSuperscripts(
          block,
          processedResult,
          averageFontSize
        );

        // Debug logging for block section types in later pages
        const DEBUG_BLOCK_SECTIONS = false; // Disabled - using targeted logging
        if (DEBUG_BLOCK_SECTIONS && pagePosition > 0.7) {
          const preview = blockText.slice(0, 50).replace(/\n/g, "\\n");
          if (sectionType !== "normal") {
            console.log(
              `[BlockSection] p${page.pageNumber} block ${blockIndex}: type=${sectionType} text="${preview}..."`
            );
          }
        }

        // Get first and last line Y positions for same-row detection
        const firstLineY =
          block.lines.length > 0 ? block.lines[0].bbox.y : block.bbox.y;
        const lastLineY =
          block.lines.length > 0
            ? block.lines[block.lines.length - 1].bbox.y
            : block.bbox.y;

        // Get first and last line font info for heading transition detection at block boundaries
        const firstLine = block.lines.length > 0 ? block.lines[0] : null;
        const lastLine =
          block.lines.length > 0 ? block.lines[block.lines.length - 1] : null;
        const firstLineFontSize = firstLine ? firstLine.font.size : avgFontSize;
        const lastLineFontSize = lastLine ? lastLine.font.size : avgFontSize;
        const lastLineBold = lastLine
          ? lastLine.font.weight === "bold"
          : isBold;

        // Detect heading candidate at block level (Stage 1)
        // textPosition is 0 here - will be adjusted when blocks are joined
        const headingCandidate = detectBlockHeadingCandidate(
          block,
          prevBlockForHeading,
          opts.bodyFontSize,
          0 // Position will be adjusted during page joining
        );

        blockData.push({
          text: blockText,
          x: block.bbox.x,
          bbox: block.bbox,
          fontSize: avgFontSize,
          isBold,
          firstLineBold,
          firstLineDifferentSize,
          sectionType,
          fontSuperscripts,
          columnIndex,
          fontRanges: processedResult.fontRanges,
          // Scoring context for two-pass adjacency scoring
          distanceToColumn,
          hasReadingOrderViolation: blockIsReadingOrderAnomaly,
          inViolationZone,
          // Line Y positions for same-row detection
          firstLineY,
          lastLineY,
          // Line font info for heading transition detection at block boundaries
          firstLineFontSize,
          lastLineFontSize,
          lastLineBold,
          headingCandidate,
        });

        prevBlockForHeading = block;
      }
      blockIndex++;
    }

    // Smart joining of blocks - detect cross-column sentence continuations
    if (blockData.length === 0) {
      return { ...page, rawText: "" };
    }

    // Abstract rehabilitation: Don't tag substantial early content as anomalies
    // This prevents abstracts (often indented/formatted differently) from being flagged
    for (const block of blockData) {
      if (block.sectionType === "anomaly") {
        const isSubstantial = block.text.length >= SUBSTANTIAL_BLOCK_MIN;
        const isEarly = cumulativeNormalTextLength < EARLY_DOCUMENT_THRESHOLD;

        if (isSubstantial && isEarly) {
          block.sectionType = "normal";
        }
      }

      // Track cumulative normal text (after potential rehabilitation)
      if (block.sectionType === "normal") {
        cumulativeNormalTextLength += block.text.length;
      }
    }

    // Second pass: Re-evaluate normal blocks with adjacency context
    // Short normal blocks next to anomalies may need to be flagged as anomalies too
    for (let i = 0; i < blockData.length; i++) {
      const block = blockData[i];
      if (block.sectionType === "normal") {
        const adjacentAnomalies = countAdjacentAnomalies(blockData, i);
        if (adjacentAnomalies > 0) {
          // Recalculate score with adjacency info
          const newScore = calculateAnomalyScore(block.text, {
            distanceToColumn: block.distanceToColumn,
            hasReadingOrderViolation: block.hasReadingOrderViolation,
            adjacentAnomalies,
            inViolationZone: block.inViolationZone,
          });
          if (newScore.total >= ANOMALY_THRESHOLD) {
            block.sectionType = "anomaly";
          }
        }
      }
    }

    // Footnote detection: Update section types for footnotes
    // Footnotes must be: smaller font AND at bottom of page
    const footnoteThreshold = averageFontSize * 0.85;
    const bottomZone = page.height * 0.75; // Bottom 25% of page
    for (let i = 0; i < blockData.length; i++) {
      const currentBlockData = blockData[i];

      // If block has smaller font AND is at bottom of page, mark as footnote
      // (but only if not already marked as legend/anomaly)
      const isFootnoteSize = currentBlockData.fontSize < footnoteThreshold;
      const isAtBottom = currentBlockData.bbox.y > bottomZone;
      if (
        isFootnoteSize &&
        isAtBottom &&
        currentBlockData.sectionType === "normal"
      ) {
        currentBlockData.sectionType = "footnote";
      }
    }

    // NOTE: Pre-join anomaly clustering removed - now handled by post-join
    // expandAnomalyHighlights() in joinPagesWithHyphenHandling which has access
    // to confirmed headings and accurate merged text lengths.

    // Second pass: Build result and track highlights (no markers in text)
    // NOTE: "heading" is not included - heading highlights are added post-hoc
    // by detectHeadingsFromText in joinPagesWithHyphenHandling
    const highlights: Array<{
      start: number;
      end: number;
      type:
        | "anomaly"
        | "legend"
        | "footnote"
        | "figure_label"
        | "reference"
        | "header"
        | "footer"
        | "page_number"
        | "author"
        | "url"
        | "email";
    }> = [];

    // Collect font ranges from all blocks for the page
    const pageFontRanges: FontRange[] = [];

    // Collect heading candidates from all blocks for the page
    const pageHeadingCandidates: BlockHeadingCandidate[] = [];

    // Helper to add heading candidate with offset adjustment
    const addHeadingCandidateWithOffset = (
      candidate: BlockHeadingCandidate | null,
      offset: number
    ) => {
      if (candidate) {
        pageHeadingCandidates.push({
          ...candidate,
          textStart: offset + candidate.textStart,
          textEnd: offset + candidate.textEnd,
        });
      }
    };

    // Helper to add font ranges with offset adjustment
    const addFontRangesWithOffset = (
      blockFontRanges: FontRange[],
      offset: number,
      trimStart: number = 0
    ) => {
      for (const fr of blockFontRanges) {
        // Adjust for trimStart (characters removed from beginning)
        const adjustedStart = Math.max(0, fr.start - trimStart);
        const adjustedEnd = Math.max(0, fr.end - trimStart);
        if (adjustedEnd > adjustedStart) {
          pageFontRanges.push({
            ...fr,
            start: offset + adjustedStart,
            end: offset + adjustedEnd,
          });
        }
      }
    };

    let currentSection: SectionType = blockData[0].sectionType;
    let result = blockData[0].text;
    let highlightStart = 0; // Track start of current highlight section

    // Add font ranges from first block (offset 0)
    addFontRangesWithOffset(blockData[0].fontRanges, 0);

    // Add heading candidate from first block (offset 0)
    addHeadingCandidateWithOffset(blockData[0].headingCandidate, 0);

    // Add font-based superscripts from first block
    for (const sup of blockData[0].fontSuperscripts) {
      highlights.push({
        start: sup.start,
        end: sup.end,
        type: "reference",
      });
    }

    // If first block is special, start tracking highlight
    if (currentSection !== "normal") {
      highlightStart = 0;
    }

    // Debug flag for block joining decisions (declared once for the loop)
    const DEBUG_BLOCK_JOINING = false; // Disabled - using targeted logging instead

    for (let i = 1; i < blockData.length; i++) {
      const prevBlockData = blockData[i - 1];
      const currentBlockData = blockData[i];
      const prevBlockText = prevBlockData.text;
      const currentBlockText = currentBlockData.text;
      const currentBlockSection = currentBlockData.sectionType;

      // Targeted debug logging - log all blocks near the pattern
      const shouldDebugThisBlock =
        DEBUG_LINE_BREAK &&
        currentBlockText.toLowerCase().includes(DEBUG_LINE_BREAK_PATTERN);
      const shouldDebugNearby =
        DEBUG_LINE_BREAK &&
        (prevBlockText.toLowerCase().includes("figure 13") ||
          currentBlockText.toLowerCase().includes("figure 13") ||
          currentBlockText.toLowerCase().includes(DEBUG_LINE_BREAK_PATTERN));
      // Debug for line join investigation - check if prev block ends with or curr block starts with pattern
      const shouldDebugBlockJoin =
        DEBUG_LINE_JOIN &&
        (prevBlockText.toLowerCase().includes(DEBUG_LINE_JOIN_PATTERN) ||
          currentBlockText.toLowerCase().includes(DEBUG_LINE_JOIN_PATTERN));

      if (shouldDebugNearby) {
        console.log(`[BlockSequence] Block ${i}:`);
        console.log(
          `  prev: "${prevBlockText
            .slice(0, 50)
            .replace(
              /\n/g,
              "\\n"
            )}..." (lastLineY=${prevBlockData.lastLineY.toFixed(1)})`
        );
        console.log(
          `  curr: "${currentBlockText
            .slice(0, 50)
            .replace(
              /\n/g,
              "\\n"
            )}..." (firstLineY=${currentBlockData.firstLineY.toFixed(1)})`
        );
      }

      if (shouldDebugBlockJoin) {
        console.log(`[BlockJoinDebug2] Block ${i}:`);
        console.log(
          `  prev ends with: "${prevBlockText
            .slice(-80)
            .replace(/\n/g, "\\n")}"`
        );
        console.log(
          `  curr starts with: "${currentBlockText
            .slice(0, 80)
            .replace(/\n/g, "\\n")}"`
        );
        console.log(
          `  prevSection: ${prevBlockData.sectionType}, currSection: ${currentBlockSection}`
        );
        console.log(
          `  boundary fonts: prevLastLine=${prevBlockData.lastLineFontSize.toFixed(
            1
          )}/${
            prevBlockData.lastLineBold ? "bold" : "normal"
          }, currFirstLine=${currentBlockData.firstLineFontSize.toFixed(1)}/${
            currentBlockData.firstLineBold ? "bold" : "normal"
          }`
        );
      }

      // SAME-ROW CHECK: Compare last line of prev block with first line of current block
      // This handles cases where blocks have multiple lines (e.g., "\nFigure 13:" where bbox.y is for the newline)
      // This takes priority over all other checks (section transitions, heading transitions, etc.)
      const SAME_ROW_TOLERANCE = 5; // pixels
      const yDiff = Math.abs(
        prevBlockData.lastLineY - currentBlockData.firstLineY
      );
      const blocksOnSameRow = yDiff <= SAME_ROW_TOLERANCE;

      if (shouldDebugThisBlock) {
        console.log(
          `  Y positions: prevLastLine=${prevBlockData.lastLineY.toFixed(
            1
          )}, currFirstLine=${currentBlockData.firstLineY.toFixed(
            1
          )}, diff=${yDiff.toFixed(1)}px`
        );
        console.log(
          `  blocksOnSameRow: ${blocksOnSameRow} (tolerance: ${SAME_ROW_TOLERANCE}px)`
        );
      }

      if (blocksOnSameRow) {
        if (shouldDebugThisBlock) {
          console.log(`  -> SAME ROW: joining with space`);
        }
        // Join with space - these are on the same visual line
        const trimmedLength = result.trimEnd().length;
        const blockOffsetSpace = trimmedLength + 1; // +1 for space

        // Update previous font ranges that extend past the trimmed length
        for (const fr of pageFontRanges) {
          if (fr.end > trimmedLength) {
            fr.end = trimmedLength;
          }
        }

        result = result.trimEnd() + " " + currentBlockText.trimStart();

        // Inherit section from previous block (they're visually together)
        // Don't change currentSection - keep tracking the same section

        // Add font ranges from current block
        const trimStartLength =
          currentBlockText.length - currentBlockText.trimStart().length;
        addFontRangesWithOffset(
          currentBlockData.fontRanges,
          blockOffsetSpace,
          trimStartLength
        );

        // Add heading candidate from current block
        addHeadingCandidateWithOffset(
          currentBlockData.headingCandidate,
          blockOffsetSpace
        );

        // Add font-based superscripts from current block
        for (const sup of currentBlockData.fontSuperscripts) {
          if (sup.start >= trimStartLength) {
            highlights.push({
              start: blockOffsetSpace + sup.start - trimStartLength,
              end: blockOffsetSpace + sup.end - trimStartLength,
              type: "reference",
            });
          }
        }
        continue;
      }

      // Check for heading → body transition (don't join headings with body text)
      // Use BOUNDARY line font info: last line of prev block vs first line of curr block
      // This catches cases where a heading is at the END of a block (e.g., "...text\n4 Design of materials")
      const boundaryFontSizeDiff =
        prevBlockData.lastLineFontSize - currentBlockData.firstLineFontSize;
      const isHeadingToBody =
        boundaryFontSizeDiff > 2 ||
        (prevBlockData.lastLineBold && !currentBlockData.firstLineBold);

      // Block-level font size diff (used for body → heading detection below)
      const fontSizeDiff = prevBlockData.fontSize - currentBlockData.fontSize;

      // Check for body → heading transition using combined signals
      // Any combination of: vertical gap, font size change, bold change, short text
      const prevBlockBottom = prevBlockData.bbox.y + prevBlockData.bbox.h;
      const currentBlockTop = currentBlockData.bbox.y;
      const verticalGap = currentBlockTop - prevBlockBottom;
      const avgBlockHeight =
        (prevBlockData.bbox.h + currentBlockData.bbox.h) / 2;

      // Collect signals that suggest the current block is a new section/heading
      // Strong signals: font-related (actual visual heading indicators)
      // Weak signals: structural (can occur in normal body text too)
      let strongSignals = 0;
      let weakSignals = 0;
      const signals: string[] = [];

      // STRONG SIGNALS (font-related)
      // Font size change (any direction) indicates different text type
      if (Math.abs(fontSizeDiff) > 1.5) {
        strongSignals++;
        signals.push(`fontSizeDiff=${fontSizeDiff.toFixed(1)}`);
      }
      // Bold transition: either entire block becomes bold, or first line is bold (section heading)
      if (
        (!prevBlockData.isBold && currentBlockData.isBold) ||
        (!prevBlockData.firstLineBold && currentBlockData.firstLineBold)
      ) {
        strongSignals++;
        signals.push("boldTransition");
      }
      // First line has different font size (heading indicator)
      if (currentBlockData.firstLineDifferentSize) {
        strongSignals++;
        signals.push("firstLineDifferentSize");
      }

      // WEAK SIGNALS (structural - can happen in normal body text)
      if (currentBlockText.length < 80) {
        weakSignals++;
        signals.push(`shortText(${currentBlockText.length})`);
      }
      // Compare vertical gap to typical inter-line spacing within a paragraph
      // Normal line spacing is ~20-30% of font size. Gap > 0.7x font size indicates extra space.
      const fontSize = prevBlockData.fontSize;
      if (verticalGap > fontSize * 0.7) {
        weakSignals++;
        signals.push(
          `verticalGap(${verticalGap.toFixed(1)}>${(fontSize * 0.7).toFixed(
            1
          )})`
        );
      }

      // Require at least one STRONG signal (font-related) to consider this a heading transition.
      // Weak signals alone (shortText + verticalGap) are not enough - they occur in normal
      // body text like bibliography entries, multi-line paragraphs, etc.
      const totalSignals = strongSignals + weakSignals;
      const isBodyToHeading = strongSignals >= 1 && totalSignals >= 2;

      // Determine if we're changing sections
      const sectionChanged = currentBlockSection !== currentSection;

      // Don't join if current block is special (legend/anomaly/footnote)
      const isSpecialBlock = currentBlockSection !== "normal";
      const wasSpecialBlock = currentSection !== "normal";

      if (shouldDebugThisBlock) {
        console.log(
          `  isHeadingToBody: ${isHeadingToBody}, isBodyToHeading: ${isBodyToHeading}`
        );
        console.log(
          `  isSpecialBlock: ${isSpecialBlock}, wasSpecialBlock: ${wasSpecialBlock}`
        );
        console.log(`  signals: [${signals.join(", ")}]`);
        console.log(
          `  prevBlock fontSize: ${prevBlockData.fontSize}, isBold: ${prevBlockData.isBold}`
        );
        console.log(
          `  currentBlock fontSize: ${currentBlockData.fontSize}, isBold: ${currentBlockData.isBold}`
        );
      }

      // FIRST: Handle hyphen breaks (before any section logic)
      const prevEndsWithHyphen =
        opts.removeHyphens && endsWithHyphen(prevBlockText.trim());

      if (prevEndsWithHyphen && !isHeadingToBody && !isBodyToHeading) {
        // Join the hyphenated word (remove hyphen, concatenate)
        const joinedText = currentBlockText.trimStart();
        result = result.trimEnd().slice(0, -1) + joinedText;

        // Find where the first word of joined text ends (to avoid highlighting mid-word)
        const firstWordMatch = joinedText.match(/^\S+/);
        const firstWordLength = firstWordMatch ? firstWordMatch[0].length : 0;
        const afterJoinedWord =
          result.length - joinedText.length + firstWordLength;

        // Handle section transitions - but avoid cutting words in half
        if (sectionChanged) {
          // Close previous highlight AFTER the joined word (word belongs to prev section)
          if (wasSpecialBlock) {
            highlights.push({
              start: highlightStart,
              end: afterJoinedWord,
              type: currentSection as
                | "anomaly"
                | "legend"
                | "footnote"
                | "figure_label"
                | "header"
                | "footer"
                | "page_number"
                | "author",
            });
          }

          // Start new highlight AFTER the joined word
          if (isSpecialBlock) {
            highlightStart = afterJoinedWord;
          }
        }

        // Add font ranges from current block with adjusted offset
        const blockOffset = result.length - currentBlockText.trimStart().length;
        const trimmedLength =
          currentBlockText.length - currentBlockText.trimStart().length;
        addFontRangesWithOffset(
          currentBlockData.fontRanges,
          blockOffset,
          trimmedLength
        );

        // Add heading candidate from current block
        addHeadingCandidateWithOffset(
          currentBlockData.headingCandidate,
          blockOffset
        );

        // Add font-based superscripts from current block with adjusted offset
        for (const sup of currentBlockData.fontSuperscripts) {
          highlights.push({
            start: blockOffset + sup.start,
            end: blockOffset + sup.end,
            type: "reference",
          });
        }

        currentSection = currentBlockSection;
        continue;
      }

      // Handle section transitions
      if (sectionChanged) {
        // Debug logging for section changes
        if (DEBUG_BLOCK_JOINING && pagePosition > 0.7) {
          const prevText = prevBlockText.slice(-30).replace(/\n/g, "\\n");
          const currText = currentBlockText.slice(0, 30).replace(/\n/g, "\\n");
          console.log(
            `[SectionChange] p${page.pageNumber}: "${prevText}" (${currentSection}) -> "${currText}" (${currentBlockSection})`
          );
        }

        // Close previous highlight if it was special
        if (wasSpecialBlock) {
          highlights.push({
            start: highlightStart,
            end: result.length,
            type: currentSection as
              | "anomaly"
              | "legend"
              | "footnote"
              | "figure_label"
              | "header"
              | "footer"
              | "page_number"
              | "author",
          });
        }

        // Add separator and text
        const blockOffsetSectionChange = result.length + 2; // +2 for \n\n
        result += "\n\n" + currentBlockText;

        // Add font ranges from current block
        addFontRangesWithOffset(
          currentBlockData.fontRanges,
          blockOffsetSectionChange
        );

        // Add heading candidate from current block
        addHeadingCandidateWithOffset(
          currentBlockData.headingCandidate,
          blockOffsetSectionChange
        );

        // Add font-based superscripts from current block
        for (const sup of currentBlockData.fontSuperscripts) {
          highlights.push({
            start: blockOffsetSectionChange + sup.start,
            end: blockOffsetSectionChange + sup.end,
            type: "reference",
          });
        }

        if (isSpecialBlock) {
          // Start new highlight if entering special section
          highlightStart = result.length - currentBlockText.length;
        }
        currentSection = currentBlockSection;
        continue;
      }

      // Same section - check if we should join or separate
      if (DEBUG_BLOCK_JOINING && pagePosition > 0.7) {
        const prevText = prevBlockText.slice(-40).replace(/\n/g, "\\n");
        const currText = currentBlockText.slice(0, 40).replace(/\n/g, "\\n");
        const prevContinuesCheck = blockContinuesToNext(prevBlockText);
        console.log(
          `[BlockJoin] page=${page.pageNumber} pos=${(
            pagePosition * 100
          ).toFixed(0)}%`
        );
        console.log(
          `  prev: "${prevText}" section=${prevBlockData.sectionType}`
        );
        console.log(`  curr: "${currText}" section=${currentBlockSection}`);
        console.log(
          `  isSpecialBlock=${isSpecialBlock} prevContinues=${prevContinuesCheck} isHeadingToBody=${isHeadingToBody} isBodyToHeading=${isBodyToHeading}`
        );
      }

      if (isSpecialBlock) {
        // Within a special section, always separate blocks (no joining)
        const blockOffsetSpecial = result.length + 2; // +2 for \n\n
        result += "\n\n" + currentBlockText;

        // Add font ranges from current block
        addFontRangesWithOffset(
          currentBlockData.fontRanges,
          blockOffsetSpecial
        );

        // Add heading candidate from current block
        addHeadingCandidateWithOffset(
          currentBlockData.headingCandidate,
          blockOffsetSpecial
        );

        // Add font-based superscripts from current block
        for (const sup of currentBlockData.fontSuperscripts) {
          highlights.push({
            start: blockOffsetSpecial + sup.start,
            end: blockOffsetSpecial + sup.end,
            type: "reference",
          });
        }
        continue;
      }

      // Check if blocks should be joined (sentence continues across columns/after artifacts)
      const prevContinues = blockContinuesToNext(prevBlockText);

      if (shouldDebugBlockJoin) {
        console.log(`  prevContinues: ${prevContinues}`);
        console.log(
          `  isHeadingToBody: ${isHeadingToBody}, isBodyToHeading: ${isBodyToHeading}`
        );
        console.log(
          `  Decision: ${
            prevContinues && !isHeadingToBody && !isBodyToHeading
              ? "JOIN with space"
              : "SEPARATE with \\n\\n"
          }`
        );
      }

      // Join if previous block ends mid-sentence (without punctuation)
      // BUT NOT if it's a heading transition (either direction)
      if (prevContinues && !isHeadingToBody && !isBodyToHeading) {
        // Join with space - sentence continues across blocks/columns
        const trimmedLength = result.trimEnd().length;
        const blockOffsetSpace = trimmedLength + 1; // +1 for space

        // IMPORTANT: Update previous font ranges that extend past the trimmed length
        // Without this, ranges would overlap with the new block's ranges
        for (const fr of pageFontRanges) {
          if (fr.end > trimmedLength) {
            fr.end = trimmedLength;
          }
        }

        result = result.trimEnd() + " " + currentBlockText.trimStart();

        // Add font ranges from current block (adjusted for trimStart)
        const trimStartLength =
          currentBlockText.length - currentBlockText.trimStart().length;
        addFontRangesWithOffset(
          currentBlockData.fontRanges,
          blockOffsetSpace,
          trimStartLength
        );

        // Add heading candidate from current block
        addHeadingCandidateWithOffset(
          currentBlockData.headingCandidate,
          blockOffsetSpace
        );

        // Add font-based superscripts from current block (adjusted for trimStart)
        for (const sup of currentBlockData.fontSuperscripts) {
          // Only add if the superscript position is still valid after trimStart
          if (sup.start >= trimStartLength) {
            highlights.push({
              start: blockOffsetSpace + sup.start - trimStartLength,
              end: blockOffsetSpace + sup.end - trimStartLength,
              type: "reference",
            });
          }
        }
      } else {
        // Normal block separation - double newline
        // Debug: log why blocks weren't joined
        const shouldDebugBlock =
          DEBUG_LINE_BREAK &&
          currentBlockText.toLowerCase().includes(DEBUG_LINE_BREAK_PATTERN);
        if (DEBUG_BLOCK_JOINING && pagePosition > 0.7) {
          const prevText = prevBlockText.slice(-30).replace(/\n/g, "\\n");
          const currText = currentBlockText.slice(0, 30).replace(/\n/g, "\\n");
          console.log(
            `[NotJoined] p${page.pageNumber}: "${prevText}" -> "${currText}"`
          );
          console.log(
            `  prevContinues=${prevContinues} isHeadingToBody=${isHeadingToBody} isBodyToHeading=${isBodyToHeading}`
          );
        }
        if (shouldDebugBlock) {
          console.log(
            `[BlockBreakDebug] Double newline BEFORE: "${currentBlockText.slice(
              0,
              60
            )}..."`
          );
          console.log(
            `  prevBlockText ends with: "${prevBlockText.slice(-60)}"`
          );
          console.log(
            `  prevContinues=${prevContinues}, isHeadingToBody=${isHeadingToBody}, isBodyToHeading=${isBodyToHeading}`
          );
        }
        const blockOffsetNormal = result.length + 2; // +2 for \n\n
        result = result + "\n\n" + currentBlockText;

        // Add font ranges from current block
        addFontRangesWithOffset(currentBlockData.fontRanges, blockOffsetNormal);

        // Add heading candidate from current block
        addHeadingCandidateWithOffset(
          currentBlockData.headingCandidate,
          blockOffsetNormal
        );

        // Add font-based superscripts from current block
        for (const sup of currentBlockData.fontSuperscripts) {
          highlights.push({
            start: blockOffsetNormal + sup.start,
            end: blockOffsetNormal + sup.end,
            type: "reference",
          });
        }
      }
    }

    // Close final highlight if last section was special
    if (currentSection !== "normal") {
      highlights.push({
        start: highlightStart,
        end: result.length,
        type: currentSection as
          | "anomaly"
          | "legend"
          | "footnote"
          | "figure_label"
          | "header"
          | "footer"
          | "page_number"
          | "author",
      });
    }

    // Detect references (citations, superscripts) in the built text
    const detectedRefs = detectReferences(result);
    for (const ref of detectedRefs) {
      // Only add if not overlapping with existing highlights
      const overlapsExisting = highlights.some(
        (h) =>
          (ref.start >= h.start && ref.start < h.end) ||
          (ref.end > h.start && ref.end <= h.end)
      );
      if (!overlapsExisting) {
        highlights.push({
          start: ref.start,
          end: ref.end,
          type: "reference",
        });
      }
    }

    // Detect URLs in the built text
    const detectedURLs = detectURLs(result);
    for (const url of detectedURLs) {
      // Only add if not overlapping with existing highlights
      const overlapsExisting = highlights.some(
        (h) =>
          (url.start >= h.start && url.start < h.end) ||
          (url.end > h.start && url.end <= h.end)
      );
      if (!overlapsExisting) {
        highlights.push({
          start: url.start,
          end: url.end,
          type: "url",
        });
      }
    }

    // Detect emails in the built text
    const detectedEmails = detectEmails(result);
    for (const email of detectedEmails) {
      // Only add if not overlapping with existing highlights
      const overlapsExisting = highlights.some(
        (h) =>
          (email.start >= h.start && email.start < h.end) ||
          (email.end > h.start && email.end <= h.end)
      );
      if (!overlapsExisting) {
        highlights.push({
          start: email.start,
          end: email.end,
          type: "email",
        });
      }
    }

    // Calculate leading whitespace that will be trimmed
    const leadingWhitespace = result.length - result.trimStart().length;
    const trimmedResult = result.trim();

    // Adjust highlight positions for trimmed leading whitespace
    const adjustedHighlights = highlights
      .map((h) => ({
        ...h,
        start: Math.max(0, h.start - leadingWhitespace),
        end: Math.max(0, h.end - leadingWhitespace),
      }))
      .filter((h) => h.end > h.start && h.start < trimmedResult.length);

    // Adjust font range positions for trimmed leading whitespace
    const adjustedFontRanges = pageFontRanges
      .map((fr) => ({
        ...fr,
        start: Math.max(0, fr.start - leadingWhitespace),
        end: Math.max(0, fr.end - leadingWhitespace),
      }))
      .filter((fr) => fr.end > fr.start && fr.start < trimmedResult.length);

    // Adjust heading candidate positions for trimmed leading whitespace
    const adjustedHeadingCandidates = pageHeadingCandidates
      .map((hc) => ({
        ...hc,
        textStart: Math.max(0, hc.textStart - leadingWhitespace),
        textEnd: Math.max(0, hc.textEnd - leadingWhitespace),
      }))
      .filter(
        (hc) => hc.textEnd > hc.textStart && hc.textStart < trimmedResult.length
      );

    return {
      ...page,
      rawText: trimmedResult,
      highlights:
        adjustedHighlights.length > 0 ? adjustedHighlights : undefined,
      fontRanges:
        adjustedFontRanges.length > 0 ? adjustedFontRanges : undefined,
      headingCandidates:
        adjustedHeadingCandidates.length > 0
          ? adjustedHeadingCandidates
          : undefined,
    };
  });
}
