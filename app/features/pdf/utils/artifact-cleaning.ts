import type {
  StructuredPage,
  StructuredBlock,
  StructuredLine,
  DetectedArtifact,
  BoundingBox,
} from "../types";

export interface ArtifactCleaningOptions {
  removePageNumbers?: boolean;
  removeHeaders?: boolean;
  removeFooters?: boolean;
  removeWatermarks?: boolean;
  // Thresholds (as percentage of page height/width)
  headerZonePercent?: number; // Default 8%
  footerZonePercent?: number; // Default 8%
}

const DEFAULT_OPTIONS: Required<ArtifactCleaningOptions> = {
  removePageNumbers: true,
  removeHeaders: true,
  removeFooters: true,
  removeWatermarks: false, // Disabled by default as it's harder to detect reliably
  headerZonePercent: 12, // Increased from 8% to catch headers further from top
  footerZonePercent: 18, // Increased from 12% to catch page numbers positioned higher
};

/**
 * Normalize text for similarity comparison
 * - Replaces numbers with placeholder (so "page 235" matches "page 237")
 * - Collapses multiple spaces
 * - Lowercases
 */
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+/g, "#") // Replace all numbers with #
    .replace(/\s+/g, " ") // Collapse whitespace
    .trim();
}

/**
 * Check if two texts are similar enough to be considered the same header/footer
 * Uses normalized comparison + allows for small differences
 */
function areTextsSimilar(text1: string, text2: string): boolean {
  const norm1 = normalizeForComparison(text1);
  const norm2 = normalizeForComparison(text2);

  // Exact match after normalization
  if (norm1 === norm2) return true;

  // If lengths are very different, not similar
  if (Math.abs(norm1.length - norm2.length) > 5) return false;

  // Calculate simple similarity (shared characters)
  const longer = norm1.length > norm2.length ? norm1 : norm2;
  const shorter = norm1.length > norm2.length ? norm2 : norm1;

  if (longer.length === 0) return true;

  // Count matching characters (simple approach)
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] === longer[i]) matches++;
  }

  const similarity = matches / longer.length;
  return similarity >= 0.85; // 85% similarity threshold
}

/**
 * Check if a line appears to be a page number
 */
function isPageNumber(
  line: StructuredLine,
  pageHeight: number,
  footerZone: number,
  headerZone: number
): boolean {
  const text = line.text.trim();

  // Page numbers are typically short
  if (text.length > 15) return false;

  // Check if it's in header or footer zone
  const isInFooterZone = line.bbox.y + line.bbox.h > pageHeight - footerZone;
  const isInHeaderZone = line.bbox.y < headerZone;

  if (!isInFooterZone && !isInHeaderZone) return false;

  // Common page number patterns
  const pageNumberPatterns = [
    /^\d+$/, // Just a number: "1", "42"
    /^[ivxlcdm]+$/i, // Roman numerals: "i", "IV", "XII"
    /^page\s*\d+$/i, // "Page 1", "PAGE 42"
    /^-\s*\d+\s*-$/, // "- 1 -", "- 42 -"
    /^\[\s*\d+\s*\]$/, // "[1]", "[ 42 ]"
    /^\d+\s*\/\s*\d+$/, // "1/10", "5 / 20"
    /^p\.\s*\d+$/i, // "p. 1", "P. 42"
  ];

  return pageNumberPatterns.some((pattern) => pattern.test(text));
}

/**
 * Get the full text content of a block (all lines joined)
 */
function getBlockText(block: StructuredBlock): string {
  return block.lines
    .map(line => line.text.trim())
    .filter(text => text.length > 0)
    .join(" ");
}

/**
 * Check if a block is in the header or footer zone
 * Uses the block's bounding box to determine position
 */
function isBlockInZone(
  block: StructuredBlock,
  pageHeight: number,
  zone: "header" | "footer",
  zonePercent: number
): boolean {
  const zoneHeight = pageHeight * (zonePercent / 100);

  if (zone === "header") {
    // Block starts in header zone (top of block is within zone)
    return block.bbox.y < zoneHeight;
  } else {
    // Block ends in footer zone (bottom of block is within zone)
    return block.bbox.y + block.bbox.h > pageHeight - zoneHeight;
  }
}

// Tolerance for Y position matching (in pixels)
const Y_POSITION_TOLERANCE = 20;

/**
 * Check if Y positions are consistent (within tolerance)
 * Returns true if the standard deviation of Y positions is within tolerance
 */
function areYPositionsConsistent(yPositions: number[]): boolean {
  if (yPositions.length < 2) return true;

  // Calculate average Y position
  const avgY = yPositions.reduce((a, b) => a + b, 0) / yPositions.length;

  // Check if all positions are within tolerance of the average
  return yPositions.every((y) => Math.abs(y - avgY) <= Y_POSITION_TOLERANCE);
}

/**
 * Find repeating blocks across pages (likely headers/footers)
 * Operates at block level to capture multi-line headers/footers as single units
 * Uses normalized text matching to catch variations like different page numbers
 * Also verifies blocks appear at consistent Y positions across pages
 */
function findRepeatingBlocks(
  pages: StructuredPage[],
  zone: "header" | "footer",
  zonePercent: number
): Map<string, { pageNumbers: number[]; originalTexts: Set<string>; yPositions: number[] }> {
  // Map from normalized text -> { page numbers, original texts, Y positions }
  const blockOccurrences = new Map<string, { pageNumbers: number[]; originalTexts: Set<string>; yPositions: number[] }>();

  for (const page of pages) {
    for (const block of page.blocks) {
      // Check if block is in the target zone
      if (!isBlockInZone(block, page.height, zone, zonePercent)) {
        continue;
      }

      // Get full block text
      const blockText = getBlockText(block);
      if (!blockText || blockText.length < 3) continue;

      // Use normalized text as key for grouping
      const normalizedText = normalizeForComparison(blockText);

      const existing = blockOccurrences.get(normalizedText) || {
        pageNumbers: [],
        originalTexts: new Set<string>(),
        yPositions: [],
      };

      // Only count once per page
      if (!existing.pageNumbers.includes(page.pageNumber)) {
        existing.pageNumbers.push(page.pageNumber);
        existing.yPositions.push(block.bbox.y);
      }
      existing.originalTexts.add(blockText.toLowerCase());
      blockOccurrences.set(normalizedText, existing);
    }
  }

  return blockOccurrences;
}

/**
 * Detected block artifact - includes block index for efficient removal
 */
interface DetectedBlockArtifact {
  type: "header" | "footer" | "page_number";
  text: string;
  pageNumber: number;
  blockIndex: number;
  bbox: BoundingBox;
}

/**
 * Detect block-level artifacts (headers, footers, page numbers) in a single page
 * Operates at block level to capture multi-line artifacts as single units
 */
function detectBlockArtifacts(
  page: StructuredPage,
  options: Required<ArtifactCleaningOptions>,
  repeatingHeaderPatterns: Set<string>,
  repeatingFooterPatterns: Set<string>
): DetectedBlockArtifact[] {
  const artifacts: DetectedBlockArtifact[] = [];
  const headerZonePercent = options.headerZonePercent;
  const footerZonePercent = options.footerZonePercent;
  const headerZone = page.height * (headerZonePercent / 100);
  const footerZone = page.height * (footerZonePercent / 100);

  for (let blockIndex = 0; blockIndex < page.blocks.length; blockIndex++) {
    const block = page.blocks[blockIndex];
    const blockText = getBlockText(block);
    if (!blockText) continue;

    const normalizedText = normalizeForComparison(blockText);

    // Check for page numbers (short blocks that match page number patterns)
    // Use block text instead of line count - MuPDF sometimes extracts page numbers with extra empty lines
    if (options.removePageNumbers && blockText.length <= 15) {
      // Create a synthetic line from the block for zone checking
      const syntheticLine: StructuredLine = {
        text: blockText,
        bbox: block.bbox,
        font: block.lines[0]?.font || { name: "", family: "", size: 12, weight: "normal", style: "normal" },
        wmode: block.lines[0]?.wmode,
      };
      if (isPageNumber(syntheticLine, page.height, footerZone, headerZone)) {
        artifacts.push({
          type: "page_number",
          text: blockText,
          pageNumber: page.pageNumber,
          blockIndex,
          bbox: block.bbox,
        });
        continue;
      }
    }

    // Check for repeating headers (block in header zone with matching pattern)
    if (
      options.removeHeaders &&
      isBlockInZone(block, page.height, "header", headerZonePercent) &&
      repeatingHeaderPatterns.has(normalizedText)
    ) {
      artifacts.push({
        type: "header",
        text: blockText,
        pageNumber: page.pageNumber,
        blockIndex,
        bbox: block.bbox,
      });
      continue;
    }

    // Check for repeating footers (block in footer zone with matching pattern)
    if (
      options.removeFooters &&
      isBlockInZone(block, page.height, "footer", footerZonePercent) &&
      repeatingFooterPatterns.has(normalizedText)
    ) {
      artifacts.push({
        type: "footer",
        text: blockText,
        pageNumber: page.pageNumber,
        blockIndex,
        bbox: block.bbox,
      });
      continue;
    }
  }

  return artifacts;
}


/**
 * Clean a single page by removing artifact blocks
 */
function cleanPage(
  page: StructuredPage,
  blockArtifacts: DetectedBlockArtifact[]
): StructuredPage {
  // Get set of block indices to remove entirely
  const blocksToRemove = new Set(
    blockArtifacts
      .filter(a => a.pageNumber === page.pageNumber)
      .map(a => a.blockIndex)
  );

  const cleanedBlocks: StructuredBlock[] = [];

  for (let blockIndex = 0; blockIndex < page.blocks.length; blockIndex++) {
    // Skip entire block if it's a block-level artifact
    if (blocksToRemove.has(blockIndex)) {
      continue;
    }

    const block = page.blocks[blockIndex];
    cleanedBlocks.push(block);
  }

  // Rebuild raw text from cleaned blocks
  const rawText = cleanedBlocks
    .map((block) =>
      block.lines
        .map((line) => line.text)
        .filter((text) => text.trim())
        .join("\n")
    )
    .join("\n\n")
    .trim();

  return {
    ...page,
    blocks: cleanedBlocks,
    rawText,
  };
}

/**
 * Detect and optionally remove artifacts from structured pages
 * Uses block-level detection for headers, footers, and page numbers
 */
export function cleanArtifacts(
  pages: StructuredPage[],
  options: ArtifactCleaningOptions = {}
): {
  cleanedPages: StructuredPage[];
  removedArtifacts: DetectedArtifact[];
} {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Find repeating blocks across pages (appears on 45%+ of pages)
  // Higher threshold to avoid false positives like figure captions near page top
  const minOccurrences = Math.max(2, Math.floor(pages.length * 0.45));

  const headerBlockMap = findRepeatingBlocks(pages, "header", opts.headerZonePercent);
  const footerBlockMap = findRepeatingBlocks(pages, "footer", opts.footerZonePercent);

  // Collect normalized patterns that repeat across pages AND appear at consistent Y positions
  const repeatingHeaderPatterns = new Set<string>();
  const repeatingFooterPatterns = new Set<string>();

  for (const [normalizedPattern, data] of headerBlockMap) {
    if (data.pageNumbers.length >= minOccurrences && areYPositionsConsistent(data.yPositions)) {
      repeatingHeaderPatterns.add(normalizedPattern);
      console.log(`[Artifact] Repeating header block: "${normalizedPattern.slice(0, 50)}${normalizedPattern.length > 50 ? '...' : ''}" (${data.pageNumbers.length} pages)`);
    }
  }

  for (const [normalizedPattern, data] of footerBlockMap) {
    if (data.pageNumbers.length >= minOccurrences && areYPositionsConsistent(data.yPositions)) {
      repeatingFooterPatterns.add(normalizedPattern);
      console.log(`[Artifact] Repeating footer block: "${normalizedPattern.slice(0, 50)}${normalizedPattern.length > 50 ? '...' : ''}" (${data.pageNumbers.length} pages)`);
    }
  }

  // Detect block-level artifacts (headers, footers, page numbers) on each page
  const allBlockArtifacts: DetectedBlockArtifact[] = [];
  for (const page of pages) {
    const blockArtifacts = detectBlockArtifacts(
      page,
      opts,
      repeatingHeaderPatterns,
      repeatingFooterPatterns
    );
    allBlockArtifacts.push(...blockArtifacts);
  }

  // Clean pages by removing artifact blocks
  const cleanedPages = pages.map((page) => cleanPage(page, allBlockArtifacts));

  // Convert block artifacts to DetectedArtifact format for return value
  const allArtifacts: DetectedArtifact[] = allBlockArtifacts.map(a => ({
    type: a.type,
    text: a.text,
    pageNumber: a.pageNumber,
    bbox: a.bbox,
  }));

  return {
    cleanedPages,
    removedArtifacts: allArtifacts,
  };
}

/**
 * Get clean text from pages after artifact removal
 */
export function getCleanText(
  pages: StructuredPage[],
  options: ArtifactCleaningOptions = {}
): string {
  const { cleanedPages } = cleanArtifacts(pages, options);
  return cleanedPages.map((page) => page.rawText).join("\n\n").trim();
}

/**
 * Artifact type for tagging
 */
export type ArtifactType = 'header' | 'footer' | 'page_number';

/**
 * Information about which blocks are artifacts on each page
 */
export interface PageArtifactInfo {
  pageNumber: number;
  artifactBlocks: Map<number, ArtifactType>; // blockIndex -> artifact type
}

/**
 * Detect artifacts across pages WITHOUT removing them
 * Returns information about which blocks are artifacts so they can be tagged as highlights
 */
export function detectArtifacts(
  pages: StructuredPage[],
  options: ArtifactCleaningOptions = {}
): {
  pageArtifacts: Map<number, Map<number, ArtifactType>>; // pageNumber -> (blockIndex -> type)
  repeatingHeaderPatterns: Set<string>;
  repeatingFooterPatterns: Set<string>;
} {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Find repeating blocks across pages (appears on 45%+ of pages)
  const minOccurrences = Math.max(2, Math.floor(pages.length * 0.45));

  const headerBlockMap = findRepeatingBlocks(pages, "header", opts.headerZonePercent);
  const footerBlockMap = findRepeatingBlocks(pages, "footer", opts.footerZonePercent);

  // Collect normalized patterns that repeat AND appear at consistent Y positions
  const repeatingHeaderPatterns = new Set<string>();
  const repeatingFooterPatterns = new Set<string>();

  for (const [normalizedPattern, data] of headerBlockMap) {
    if (data.pageNumbers.length >= minOccurrences && areYPositionsConsistent(data.yPositions)) {
      repeatingHeaderPatterns.add(normalizedPattern);
    }
  }

  for (const [normalizedPattern, data] of footerBlockMap) {
    if (data.pageNumbers.length >= minOccurrences && areYPositionsConsistent(data.yPositions)) {
      repeatingFooterPatterns.add(normalizedPattern);
    }
  }

  // Build per-page artifact info
  const pageArtifacts = new Map<number, Map<number, ArtifactType>>();

  for (const page of pages) {
    const blockArtifacts = detectBlockArtifacts(
      page,
      opts,
      repeatingHeaderPatterns,
      repeatingFooterPatterns
    );

    if (blockArtifacts.length > 0) {
      const artifactMap = new Map<number, ArtifactType>();
      for (const artifact of blockArtifacts) {
        artifactMap.set(artifact.blockIndex, artifact.type);
      }
      pageArtifacts.set(page.pageNumber, artifactMap);
    }
  }

  return {
    pageArtifacts,
    repeatingHeaderPatterns,
    repeatingFooterPatterns,
  };
}
