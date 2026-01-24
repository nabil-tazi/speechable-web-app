import type {
  StructuredPage,
  StructuredBlock,
  StructuredLine,
  HighlightType,
  FontRange,
  BlockHeadingCandidate,
  OutlineEntry,
} from "../types";
import { repairLigatures } from "./ligature-repair";
import { detectArtifacts, type ArtifactType } from "./artifact-cleaning";
import { detectAuthorBlock, isAuthorBlockCandidate } from "./author-detection";
import { detectTOC } from "./toc-detection";
import { detectBibliography } from "./bibliography-detection";

// Import constants and types from shared module
import {
  DEFAULT_OPTIONS,
  isSentenceEnding,
  CLUSTER_SHORT_THRESHOLD,
  DEBUG_HEADING,
  DEBUG_HEADING_PATTERN,
  DEBUG_LINE_BREAK,
  DEBUG_LINE_BREAK_PATTERN,
  DEBUG_LINE_JOIN,
  DEBUG_LINE_JOIN_PATTERN,
  DEBUG_ANOMALY_SCORING,
  DEBUG_ANOMALY_PATTERN,
  DEBUG_WMODE,
  DEBUG_WMODE_PATTERN,
  ANOMALY_THRESHOLD,
  SHORT_BLOCK_THRESHOLD,
  LONG_BLOCK_THRESHOLD,
  ZONE_SCORE_BONUS,
  type FontSignature,
} from "./pdf-utils-common";
import type { ParagraphJoiningOptions } from "./pdf-utils-common";

// Import from heading-patterns
import { normalizePageQuotes } from "./heading-patterns";

// Import from heading-scoring
import { detectBlockHeadingCandidate } from "./heading-scoring";

// Import from heading-detection
import { detectHeadingsFromText } from "./heading-detection";

// Import from block-splitting
import {
  splitBlocksByFontBoundary,
  calculateBodyTextSignature,
} from "./block-splitting";

// Import from text-joining
import { endsWithHyphen, processBlockWithTracking } from "./text-joining";

// Import from highlight-processing
import {
  expandAnomalyHighlights,
  removeHighlightedRanges,
  adjustFontRangesForRemovals,
} from "./highlight-processing";

// Import from reference-detection
import {
  detectReferences,
  detectURLs,
  detectEmails,
} from "./reference-detection";

// Import from superscript-detection
import { findFontBasedSuperscripts } from "./superscript-detection";

// Re-export types for backward compatibility
export type { ParagraphJoiningOptions } from "./pdf-utils-common";
export type { ConfirmedHeading } from "./heading-detection";

// ============================================================================
// LOCAL CONSTANTS (these are specific to paragraph-joining.ts and not extracted)
// ============================================================================

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

// Patterns for text continuation detection (used by blockContinuesToNext/blockContinuesFromPrevious)
const CONTINUES_PATTERN = /[,;:\-–—]["']?$/;
const LIST_ITEM_PATTERN =
  /^(\s*[-•●◦▪▸►]\s+|\s*\(?[0-9]+[).]\s+|\s*\(?[a-zA-Z][).]\s+|\s*\([ivxlcdm]+\)\s+)/i;
const HYPHEN_END_PATTERN = /[a-zA-Z\u00C0-\u024F][-\u00AD\u2010\u2011]$/;

// ============================================================================
// LOCAL FUNCTIONS (orchestration logic that uses the imported utilities)
// ============================================================================

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
  if (isSentenceEnding(lastLine)) return false;

  // If ends with continuation characters (comma, hyphen, dash), it continues
  if (CONTINUES_PATTERN.test(lastLine)) return true;

  // Find the last "content" character, looking past any closing brackets
  // Closing brackets don't determine sentence ending - the content before them does
  const closingBrackets = /[)\]"'»›]/;
  let checkIndex = lastLine.length - 1;
  while (checkIndex >= 0 && closingBrackets.test(lastLine[checkIndex])) {
    checkIndex--;
  }

  // If we found a content character, check if it's alphanumeric (continues)
  // or sentence-ending punctuation (complete)
  if (checkIndex >= 0) {
    const contentChar = lastLine[checkIndex];
    // If content char is alphanumeric, text continues
    if (/[a-zA-Z0-9\u00C0-\u024F]/.test(contentChar)) return true;
    // If content char is sentence-ending, text is complete (already handled by isSentenceEnding above)
    // If content char is something else (comma, etc.), check continuation pattern
    if (/[,;:\-–—]/.test(contentChar)) return true;
  }

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

// Anomaly scoring constants are imported from pdf-utils-common

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
 * - Block is short (< 100 chars): +1
 * - Adjacent to confirmed anomaly: +1-2
 * - Reading order violation: +3
 * - Block length > 200 chars: -2
 * - Isolated (large gaps before AND after): +2
 * - Semi-isolated (large gap on one side): +1
 * - Much shorter than neighbors (< 30% of avg, only if font <= 115% body): +1
 * - Font size < 85% of body text: +2
 * - Font size > 115% of body text: -3 (likely heading, not anomaly)
 */
// Debug flags are imported from pdf-utils-common

function calculateAnomalyScore(
  blockText: string,
  context: {
    distanceToColumn: number;
    hasReadingOrderViolation: boolean;
    adjacentAnomalies: number;
    inViolationZone: boolean;
    // Isolation detection
    verticalGapBefore: number;
    verticalGapAfter: number;
    avgFontSize: number;
    textLengthRatio: number; // Current block length / average neighbor length (< 1 means shorter)
    // Font comparison
    blockFontSize: number; // Block's font size for comparison with body text
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
      score += 1;
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

  // 7. Isolation detection - block surrounded by large gaps
  const gapThreshold = context.avgFontSize * 1.5; // Gap > 1.5x font size is significant
  const hasLargeGapBefore = context.verticalGapBefore > gapThreshold;
  const hasLargeGapAfter = context.verticalGapAfter > gapThreshold;

  if (hasLargeGapBefore && hasLargeGapAfter) {
    // Fully isolated - large gaps on both sides
    score += 2;
    factors.push(`isolated(gaps:${context.verticalGapBefore.toFixed(0)}/${context.verticalGapAfter.toFixed(0)})`);
  } else if (hasLargeGapBefore || hasLargeGapAfter) {
    // Partially isolated - large gap on one side
    score += 1;
    factors.push(`semi-isolated(gaps:${context.verticalGapBefore.toFixed(0)}/${context.verticalGapAfter.toFixed(0)})`);
  }

  // 8. Text length ratio - block much shorter than neighbors
  // Skip this check if font is large (headings are naturally shorter than body paragraphs)
  const fontRatioForLengthCheck = context.avgFontSize > 0 && context.blockFontSize > 0
    ? context.blockFontSize / context.avgFontSize
    : 1;
  if (context.textLengthRatio > 0 && context.textLengthRatio < 0.3 && fontRatioForLengthCheck <= 1.15) {
    // Current block is less than 30% of neighbor average length
    score += 1;
    factors.push(`short-vs-neighbors(${(context.textLengthRatio * 100).toFixed(0)}%)`);
  }

  // 9. Font size comparison with body text
  if (context.avgFontSize > 0 && context.blockFontSize > 0) {
    const fontRatio = context.blockFontSize / context.avgFontSize;
    if (fontRatio < 0.85) {
      // Smaller fonts suggest captions/labels
      score += 2;
      factors.push(`small-font(${(fontRatio * 100).toFixed(0)}%)`);
    } else if (fontRatio > 1.15) {
      // Larger fonts suggest headings, NOT anomalies - reduce score
      score -= 3;
      factors.push(`large-font(${(fontRatio * 100).toFixed(0)}%)`);
    }
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
    console.log(`  verticalGaps: before=${context.verticalGapBefore.toFixed(1)}, after=${context.verticalGapAfter.toFixed(1)}`);
    console.log(`  textLengthRatio: ${(context.textLengthRatio * 100).toFixed(1)}%`);
    console.log(`  fontSize: block=${context.blockFontSize.toFixed(1)}, body=${context.avgFontSize.toFixed(1)} (${((context.blockFontSize / context.avgFontSize) * 100).toFixed(0)}%)`);
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
 * Calculate isolation metrics for a block
 * Returns vertical gaps before/after and text length ratio compared to neighbors
 */
function calculateIsolationMetrics(
  blockData: Array<{
    text: string;
    bbox: { x: number; y: number; w: number; h: number };
    sectionType: string;
  }>,
  index: number
): {
  verticalGapBefore: number;
  verticalGapAfter: number;
  textLengthRatio: number;
} {
  const current = blockData[index];
  const currentTop = current.bbox.y;
  const currentBottom = current.bbox.y + current.bbox.h;

  // Calculate vertical gap before (from previous block's bottom to current top)
  let verticalGapBefore = 0;
  if (index > 0) {
    const prev = blockData[index - 1];
    const prevBottom = prev.bbox.y + prev.bbox.h;
    verticalGapBefore = Math.max(0, currentTop - prevBottom);
  } else {
    // First block - use distance from top of page as "gap"
    verticalGapBefore = currentTop;
  }

  // Calculate vertical gap after (from current bottom to next block's top)
  let verticalGapAfter = 0;
  if (index < blockData.length - 1) {
    const next = blockData[index + 1];
    verticalGapAfter = Math.max(0, next.bbox.y - currentBottom);
  } else {
    // Last block - consider it as having a large gap after
    verticalGapAfter = 100; // Arbitrary large value
  }

  // Calculate text length ratio compared to neighbors
  // Only compare with "normal" blocks to avoid comparing with other anomalies
  let neighborTotalLength = 0;
  let neighborCount = 0;

  // Look at up to 2 blocks before and after
  for (let i = Math.max(0, index - 2); i <= Math.min(blockData.length - 1, index + 2); i++) {
    if (i !== index && blockData[i].sectionType === "normal") {
      neighborTotalLength += blockData[i].text.length;
      neighborCount++;
    }
  }

  const avgNeighborLength = neighborCount > 0 ? neighborTotalLength / neighborCount : 0;
  const textLengthRatio = avgNeighborLength > 0 ? current.text.length / avgNeighborLength : 1;

  return { verticalGapBefore, verticalGapAfter, textLengthRatio };
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
 *
 * @param pages - Structured pages to join
 * @param pdfOutline - Optional PDF outline entries for heading enrichment
 */
export function joinPagesWithHyphenHandling(
  pages: StructuredPage[],
  pdfOutline: OutlineEntry[] = []
): JoinedPagesResult {
  if (pages.length === 0)
    return { text: "", highlights: [], fontRanges: [], headingCandidates: [] };

  let result = pages[0].rawText;
  const allHighlights: Array<{
    start: number;
    end: number;
    type: HighlightType;
    sectionLevel?: number; // For heading type
    sectionTitle?: string;
    verified?: boolean;
  }> = [];
  const allFontRanges: FontRange[] = [];
  const allHeadingCandidates: BlockHeadingCandidate[] = [];

  // Track page break positions for outline matching (character offset where each page starts)
  // First page starts at 0, subsequent pages are recorded during joining
  const pageBreakPositions: number[] = [0];

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

    // Record page break position (where this page starts in joined text)
    pageBreakPositions.push(textOffset);

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

  // Adjust page break positions for artifact removal (map to cleaned text coordinates)
  const cleanedPageBreakPositions = pageBreakPositions.map(pos =>
    positionMap.toClean(pos)
  );

  // Run text-based heading detection with exclude ranges, Stage 1 candidates, and PDF outline
  const headingHighlights = detectHeadingsFromText(
    cleanedText,
    cleanedFontRanges,
    excludeRanges,
    cleanedHeadingCandidates,
    pdfOutline,
    cleanedPageBreakPositions
  );
  for (const heading of headingHighlights) {
    // Map positions back to original text
    adjustedHighlights.push({
      start: positionMap.toOriginal(heading.start),
      end: positionMap.toOriginal(heading.end),
      type: heading.type,
      sectionLevel: heading.sectionLevel,
      sectionTitle: heading.sectionTitle,
      verified: heading.verified,
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
  options: ParagraphJoiningOptions = {},
  pdfOutline: OutlineEntry[] = []
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
      // Debug: Check for vertical text
      if (DEBUG_WMODE) {
        const blockFullText = block.lines.map(l => l.text).join(' ').toLowerCase();
        const matchesPattern = DEBUG_WMODE_PATTERN && blockFullText.includes(DEBUG_WMODE_PATTERN.toLowerCase());

        // Targeted logging for specific pattern
        if (matchesPattern) {
          console.log(`[WmodeDebug] Found "${DEBUG_WMODE_PATTERN}" on page ${page.pageNumber}:`);
          console.log(`  block bbox: x=${block.bbox.x.toFixed(1)}, y=${block.bbox.y.toFixed(1)}, w=${block.bbox.w.toFixed(1)}, h=${block.bbox.h.toFixed(1)}`);
          console.log(`  block type: ${block.type}`);
          console.log(`  lines: ${block.lines.length}`);
          block.lines.forEach((l, i) => {
            console.log(`    Line ${i}: "${l.text}"`);
            console.log(`      wmode: ${l.wmode}`);
            console.log(`      bbox: x=${l.bbox.x.toFixed(1)}, y=${l.bbox.y.toFixed(1)}, w=${l.bbox.w.toFixed(1)}, h=${l.bbox.h.toFixed(1)}`);
            console.log(`      font: ${l.font.size}pt ${l.font.weight} "${l.font.name}"`);
          });
        }

        // Check wmode property
        for (const line of block.lines) {
          if (line.wmode !== 0) {
            console.log(`[WmodeDebug] Vertical text (wmode) on page ${page.pageNumber}:`);
            console.log(`  wmode: ${line.wmode}`);
            console.log(`  text: "${line.text.slice(0, 50)}${line.text.length > 50 ? '...' : ''}"`);
            console.log(`  bbox: x=${line.bbox.x.toFixed(1)}, y=${line.bbox.y.toFixed(1)}, w=${line.bbox.w.toFixed(1)}, h=${line.bbox.h.toFixed(1)}`);
          }
        }

        // Fallback: Detect vertical text by bounding box analysis
        // Vertical text blocks typically have: height >> width, short lines
        const blockWidth = block.bbox.w;
        const blockHeight = block.bbox.h;
        const aspectRatio = blockHeight / blockWidth;
        const avgLineLength = block.lines.length > 0
          ? block.lines.reduce((sum, l) => sum + l.text.length, 0) / block.lines.length
          : 0;

        // Heuristic: tall narrow block (aspect ratio > 3) with very short lines (avg < 3 chars)
        const looksVertical = aspectRatio > 3 && avgLineLength < 3 && block.lines.length > 2;

        if (looksVertical) {
          const fullText = block.lines.map(l => l.text).join('');
          console.log(`[WmodeDebug] Possible vertical text (bbox heuristic) on page ${page.pageNumber}:`);
          console.log(`  block bbox: w=${blockWidth.toFixed(1)}, h=${blockHeight.toFixed(1)}, aspectRatio=${aspectRatio.toFixed(1)}`);
          console.log(`  lines: ${block.lines.length}, avgLineLength: ${avgLineLength.toFixed(1)}`);
          console.log(`  text (joined): "${fullText.slice(0, 50)}${fullText.length > 50 ? '...' : ''}"`);
          console.log(`  individual lines:`);
          block.lines.slice(0, 5).forEach((l, i) => {
            console.log(`    ${i}: "${l.text}" (wmode=${l.wmode})`);
          });
          if (block.lines.length > 5) console.log(`    ... and ${block.lines.length - 5} more`);
        }
      }

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
        // Get weighted average font size from block lines (weighted by text length)
        // This prevents short superscript/subscript lines from skewing the average
        const linesWithSize = block.lines.filter(
          (l) => l.font.size > 0 && l.text.length > 0
        );
        const totalWeight = linesWithSize.reduce(
          (sum, l) => sum + l.text.length,
          0
        );
        const weightedSum = linesWithSize.reduce(
          (sum, l) => sum + l.font.size * l.text.length,
          0
        );
        const avgFontSize = totalWeight > 0 ? weightedSum / totalWeight : 12;

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

        // Calculate anomaly score (first pass, no adjacency/isolation info yet)
        // Isolation metrics will be calculated in second pass when we have all blocks
        const anomalyScore = calculateAnomalyScore(blockText, {
          distanceToColumn,
          hasReadingOrderViolation: blockIsReadingOrderAnomaly,
          adjacentAnomalies: 0, // Will be updated in second pass
          inViolationZone,
          verticalGapBefore: 0, // Will be updated in second pass
          verticalGapAfter: 0,  // Will be updated in second pass
          avgFontSize: opts.bodyFontSize,
          textLengthRatio: 1,   // Will be updated in second pass
          blockFontSize: avgFontSize, // Block's weighted average font size
        });

        if (block.isVertical) {
          // Vertical/rotated text (detected via bbox h/w ratio) - treat as anomaly
          sectionType = "anomaly";
        } else if (artifactType) {
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
        // Skip heading detection for anomaly/artifact blocks to avoid overlapping highlights
        // textPosition is 0 here - will be adjusted when blocks are joined
        // Pass PDF outline for bonus scoring on outline matches
        const headingCandidate = sectionType === "normal"
          ? detectBlockHeadingCandidate(
              block,
              prevBlockForHeading,
              opts.bodyFontSize,
              0, // Position will be adjusted during page joining
              pdfOutline
            )
          : null;

        // Fix heading textEnd using actual processed text positions from fontRanges
        // This ensures the heading end position matches the actual text, not the trimmed version
        if (headingCandidate && processedResult.fontRanges.length > 0) {
          const headingLineCount = headingCandidate.lineCount;
          // Get the end position of the last heading line from fontRanges
          const lastHeadingLineIndex = Math.min(headingLineCount, processedResult.fontRanges.length) - 1;
          if (lastHeadingLineIndex >= 0) {
            const actualTextEnd = processedResult.fontRanges[lastHeadingLineIndex].end;
            headingCandidate.textEnd = actualTextEnd;
          }
        }

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

    // Second pass: Re-evaluate normal blocks with adjacency and isolation context
    // Now that we have all blocks, we can calculate isolation metrics
    for (let i = 0; i < blockData.length; i++) {
      const block = blockData[i];
      if (block.sectionType === "normal") {
        const adjacentAnomalies = countAdjacentAnomalies(blockData, i);
        const isolationMetrics = calculateIsolationMetrics(blockData, i);

        // Recalculate score with full context (adjacency + isolation)
        const newScore = calculateAnomalyScore(block.text, {
          distanceToColumn: block.distanceToColumn,
          hasReadingOrderViolation: block.hasReadingOrderViolation,
          adjacentAnomalies,
          inViolationZone: block.inViolationZone,
          verticalGapBefore: isolationMetrics.verticalGapBefore,
          verticalGapAfter: isolationMetrics.verticalGapAfter,
          avgFontSize: opts.bodyFontSize,
          textLengthRatio: isolationMetrics.textLengthRatio,
          blockFontSize: block.fontSize,
        });
        if (newScore.total >= ANOMALY_THRESHOLD) {
          block.sectionType = "anomaly";
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

      if (shouldDebugThisBlock || shouldDebugBlockJoin) {
        console.log(`[BlockJoinAnalysis] Block ${i}:`);
        console.log(
          `  isHeadingToBody: ${isHeadingToBody} (boundaryFontSizeDiff=${boundaryFontSizeDiff.toFixed(1)}, prevLastBold=${prevBlockData.lastLineBold}, currFirstBold=${currentBlockData.firstLineBold})`
        );
        console.log(
          `  isBodyToHeading: ${isBodyToHeading} (strongSignals=${strongSignals}, weakSignals=${weakSignals}, total=${totalSignals})`
        );
        console.log(`  signals: [${signals.join(", ")}]`);
        console.log(
          `  isSpecialBlock: ${isSpecialBlock}, wasSpecialBlock: ${wasSpecialBlock}, sectionChanged: ${sectionChanged}`
        );
        console.log(
          `  prevBlock: fontSize=${prevBlockData.fontSize.toFixed(1)}, isBold=${prevBlockData.isBold}, lastLineFontSize=${prevBlockData.lastLineFontSize.toFixed(1)}`
        );
        console.log(
          `  currBlock: fontSize=${currentBlockData.fontSize.toFixed(1)}, isBold=${currentBlockData.isBold}, firstLineFontSize=${currentBlockData.firstLineFontSize.toFixed(1)}`
        );
        console.log(
          `  verticalGap: ${verticalGap.toFixed(1)}px (threshold: ${(fontSize * 0.7).toFixed(1)}px)`
        );
        console.log(
          `  blocksOnSameRow: ${blocksOnSameRow}, yDiff: ${yDiff.toFixed(1)}px`
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
      const currentContinuesFromPrev = blockContinuesFromPrevious(currentBlockText);

      // Check if fonts match (same section) - required for joining based on prevContinues
      // Different fonts indicate section change (e.g., keywords → body text)
      const fontsMatch = Math.abs(prevBlockData.lastLineFontSize - currentBlockData.firstLineFontSize) < 0.5 &&
        prevBlockData.lastLineBold === currentBlockData.firstLineBold;

      // Determine if we should join:
      // - If fonts match: use either signal (prevContinues OR currentContinuesFromPrev)
      // - If fonts don't match: only join if current starts lowercase (strong continuation signal)
      const shouldJoin = fontsMatch
        ? (prevContinues || currentContinuesFromPrev)
        : currentContinuesFromPrev;

      if (shouldDebugBlockJoin) {
        console.log(`  prevContinues: ${prevContinues}, currentContinuesFromPrev: ${currentContinuesFromPrev}`);
        console.log(`  fontsMatch: ${fontsMatch} (prev: ${prevBlockData.lastLineFontSize}/${prevBlockData.lastLineBold ? 'bold' : 'normal'}, curr: ${currentBlockData.firstLineFontSize}/${currentBlockData.firstLineBold ? 'bold' : 'normal'})`);
        console.log(
          `  isHeadingToBody: ${isHeadingToBody}, isBodyToHeading: ${isBodyToHeading}`
        );
        console.log(
          `  Decision: ${
            shouldJoin && !isHeadingToBody && !isBodyToHeading
              ? "JOIN with space"
              : "SEPARATE with \\n\\n"
          }`
        );
      }

      // Join based on continuation signals, but require font match for weaker signals
      // BUT NOT if it's a heading transition (either direction)
      if (shouldJoin && !isHeadingToBody && !isBodyToHeading) {
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
        if (shouldDebugBlock || shouldDebugBlockJoin) {
          console.log(
            `[BlockSeparation] Adding \\n\\n between blocks:`
          );
          console.log(
            `  prevBlockText ends with: "${prevBlockText.slice(-60).replace(/\n/g, "\\n")}"`
          );
          console.log(
            `  currBlockText starts with: "${currentBlockText.slice(0, 60).replace(/\n/g, "\\n")}"`
          );
          console.log(
            `  REASON: prevContinues=${prevContinues}, isHeadingToBody=${isHeadingToBody}, isBodyToHeading=${isBodyToHeading}`
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
