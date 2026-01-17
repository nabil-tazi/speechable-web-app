import type {
  StructuredPage,
  StructuredLine,
  DetectedHeading,
  BoundingBox,
  TextHighlight,
  HighlightType,
} from "../types";
import { joinPagesWithHyphenHandling } from "./paragraph-joining";
import { removeHighlightedSections } from "../helpers/remove-highlights";

export interface DetectedSection {
  title: string;
  level: number; // 1 = main heading, 2 = subheading, etc.
  pageNumber: number;
  startLineIndex: number;
  fontSize: number;
  fontWeight: string;
  bbox: BoundingBox;
  confidence: number; // 0-1, how confident we are this is a heading
}

// Extended section with extracted text content
export interface DetectedSectionWithContent extends DetectedSection {
  content: string;           // Text from this heading to next heading
  contentPreview: string;    // First 200 chars for UI display
  startOffset: number;       // Char offset in full document
  endOffset: number;         // Char offset where section ends
}

// Curated section with outline verification status
export interface CuratedSection extends DetectedSectionWithContent {
  verified: boolean;           // true = matched to outline entry
  outlineMatch?: {
    outlineTitle: string;      // Original title from outline
    outlineLevel: number;      // Level from outline
    outlinePage: number;       // Page from outline
  };
  originalTitle?: string;      // Keep original detected title if overwritten
  originalLevel?: number;      // Keep original detected level if overwritten
}

// Hierarchical tree node for nested sections
export interface SectionNode {
  title: string;
  level: number;
  content: string;           // Text directly under this heading (before any subsections)
  children: SectionNode[];   // Nested subsections
  // Metadata
  pageNumber: number;
  confidence: number;
  startOffset: number;
  endOffset: number;
}

// Complete section tree structure
export interface SectionTree {
  sections: SectionNode[];   // Top-level sections (level 1)
  fullText: string;          // Original full document text
}

export interface SectionDetectionOptions {
  // Minimum font size ratio above average to consider a heading
  minFontSizeRatio?: number; // Default 1.1 (10% larger)
  // Keywords that indicate section headings
  sectionKeywords?: string[];
  // Patterns for numbered sections (e.g., "1.", "1.1", "I.", "A.")
  detectNumberedSections?: boolean;
  // Include bold text as potential headings even if not larger
  includeBoldAsHeading?: boolean;
}

const DEFAULT_OPTIONS: Required<SectionDetectionOptions> = {
  minFontSizeRatio: 1.1,
  sectionKeywords: [
    "abstract",
    "introduction",
    "background",
    "methods",
    "methodology",
    "materials",
    "results",
    "discussion",
    "conclusion",
    "conclusions",
    "references",
    "bibliography",
    "acknowledgments",
    "acknowledgements",
    "appendix",
    "summary",
    "overview",
    "chapter",
    "section",
    "part",
  ],
  detectNumberedSections: true,
  includeBoldAsHeading: true,
};

// Patterns for numbered sections
const NUMBERED_PATTERNS = [
  /^\d+\.\s+\S/, // "1. Title"
  /^\d+\.\d+\s+\S/, // "1.1 Title"
  /^\d+\.\d+\.\d+\s+\S/, // "1.1.1 Title"
  /^[IVXLCDM]+\.\s+\S/i, // "I. Title", "IV. Title"
  /^[A-Z]\.\s+\S/, // "A. Title"
  /^\(\d+\)\s+\S/, // "(1) Title"
  /^Chapter\s+\d+/i, // "Chapter 1"
  /^Section\s+\d+/i, // "Section 1"
  /^Part\s+[IVXLCDM\d]+/i, // "Part I", "Part 1"
];

/**
 * Check if text matches a numbered section pattern
 */
function matchesNumberedPattern(text: string): boolean {
  return NUMBERED_PATTERNS.some((pattern) => pattern.test(text.trim()));
}

/**
 * Check if text starts with a known section keyword
 */
function matchesSectionKeyword(text: string, keywords: string[]): boolean {
  const lowerText = text.toLowerCase().trim();
  return keywords.some(
    (keyword) =>
      lowerText === keyword ||
      lowerText.startsWith(keyword + " ") ||
      lowerText.startsWith(keyword + ":")
  );
}

/**
 * Calculate heading level based on font size relative to other headings
 */
function calculateHeadingLevel(
  fontSize: number,
  allHeadingFontSizes: number[]
): number {
  const uniqueSizes = [...new Set(allHeadingFontSizes)].sort((a, b) => b - a);
  const index = uniqueSizes.indexOf(fontSize);
  return Math.min(index + 1, 6); // Cap at level 6
}

/**
 * Analyze font distribution to identify body text and heading tiers
 */
interface FontAnalysis {
  bodyFontSize: number;
  bodyFontWeight: string;
  headingTiers: number[]; // Distinct font sizes larger than body, sorted descending
}

function analyzeFontDistribution(pages: StructuredPage[]): FontAnalysis {
  const fontComboCounts = new Map<string, number>(); // "size|weight" -> count
  const fontSizeCounts = new Map<number, number>();

  for (const page of pages) {
    for (const block of page.blocks) {
      for (const line of block.lines) {
        const text = line.text.trim();
        if (!text || text.length < 3) continue;

        const size = Math.round(line.font.size);
        const weight = line.font.weight || 'normal';
        const key = `${size}|${weight}`;

        fontComboCounts.set(key, (fontComboCounts.get(key) || 0) + 1);
        fontSizeCounts.set(size, (fontSizeCounts.get(size) || 0) + 1);
      }
    }
  }

  // Find body text (most common font combo with size >= 8pt)
  let bodyFontSize = 12;
  let bodyFontWeight = 'normal';
  let maxCount = 0;

  for (const [key, count] of fontComboCounts) {
    const [sizeStr, weight] = key.split('|');
    const size = parseInt(sizeStr);
    if (size >= 8 && count > maxCount) {
      maxCount = count;
      bodyFontSize = size;
      bodyFontWeight = weight;
    }
  }

  // Find heading tiers (font sizes larger than body with fewer occurrences)
  const headingTiers: number[] = [];
  for (const [size, count] of fontSizeCounts) {
    // Heading tier: larger than body, but not the most common
    if (size > bodyFontSize && count < maxCount * 0.5) {
      headingTiers.push(size);
    }
  }
  headingTiers.sort((a, b) => b - a); // Largest first

  return { bodyFontSize, bodyFontWeight, headingTiers };
}

/**
 * Calculate confidence score for a heading
 */
function calculateConfidence(
  line: StructuredLine,
  averageFontSize: number,
  options: Required<SectionDetectionOptions>,
  fontAnalysis?: FontAnalysis
): number {
  let confidence = 0;
  const text = line.text.trim();
  const fontSize = line.font.size;
  const fontWeight = line.font.weight || 'normal';

  // Use font analysis if available, otherwise fall back to averageFontSize
  const bodySize = fontAnalysis?.bodyFontSize || averageFontSize;
  const bodyWeight = fontAnalysis?.bodyFontWeight || 'normal';

  // NEGATIVE SIGNAL: Exact match to body text font
  // If line has exact same font size AND weight as body text, penalize
  if (Math.round(fontSize) === Math.round(bodySize) && fontWeight === bodyWeight) {
    confidence -= 0.3;
  }

  // Larger font size increases confidence
  const fontSizeRatio = fontSize / bodySize;
  if (fontSizeRatio >= 1.5) confidence += 0.5;
  else if (fontSizeRatio >= 1.3) confidence += 0.4;
  else if (fontSizeRatio >= 1.15) confidence += 0.3;
  else if (fontSizeRatio >= options.minFontSizeRatio) confidence += 0.2;

  // Bold text increases confidence (more if body is not bold)
  if (fontWeight === "bold") {
    confidence += bodyWeight === "bold" ? 0.15 : 0.3;
  }

  // Matching section keyword increases confidence significantly
  if (matchesSectionKeyword(text, options.sectionKeywords)) confidence += 0.4;

  // Numbered pattern increases confidence
  if (options.detectNumberedSections && matchesNumberedPattern(text)) {
    confidence += 0.35;
  }

  // Short text (likely a title) increases confidence
  if (text.length < 80) confidence += 0.1;
  if (text.length < 40) confidence += 0.1;

  // Text that doesn't end with period (not a sentence) increases confidence
  if (!text.endsWith(".") && !text.endsWith(",") && !text.endsWith(";")) {
    confidence += 0.1;
  }

  // NEGATIVE: Ends with continuation punctuation
  if (text.endsWith(",") || text.endsWith(";") || text.endsWith(":")) {
    confidence -= 0.2;
  }

  // All caps increases confidence
  if (text === text.toUpperCase() && text.length > 3 && /[A-Z]/.test(text)) {
    confidence += 0.15;
  }

  // NEGATIVE: Very long text (probably not a heading)
  if (text.length > 150) {
    confidence -= 0.3;
  }

  // NEGATIVE: Starts with lowercase (continuation)
  if (/^[a-z]/.test(text)) {
    confidence -= 0.2;
  }

  return Math.min(Math.max(confidence, 0), 1);
}

/**
 * Detect sections/headings from structured pages using font-based heuristics
 */
export function detectSections(
  pages: StructuredPage[],
  averageFontSize: number,
  options: SectionDetectionOptions = {}
): DetectedSection[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sections: DetectedSection[] = [];
  const headingFontSizes: number[] = [];

  // Analyze font distribution to identify body text and heading tiers
  const fontAnalysis = analyzeFontDistribution(pages);
  const bodySize = fontAnalysis.bodyFontSize;
  const bodyWeight = fontAnalysis.bodyFontWeight;

  // console.log(`[SectionDetection] Body text: ${bodySize}pt ${bodyWeight}`);
  // console.log(`[SectionDetection] Heading tiers: ${fontAnalysis.headingTiers.join(', ')}pt`);

  // First pass: identify potential headings and collect their font sizes
  const potentialHeadings: Array<{
    line: StructuredLine;
    pageNumber: number;
    lineIndex: number;
    blockIndex: number;
    confidence: number;
  }> = [];

  for (const page of pages) {
    let lineIndex = 0;
    let blockIndex = 0;
    for (const block of page.blocks) {
      const isFirstLineOfBlock = true;
      let lineInBlock = 0;

      for (const line of block.lines) {
        const text = line.text.trim();
        if (!text || text.length < 2) {
          lineIndex++;
          lineInBlock++;
          continue;
        }

        const fontSize = line.font.size;
        const fontWeight = line.font.weight || 'normal';
        const fontSizeRatio = fontSize / bodySize;

        // Check various heading signals
        const isLarger = fontSizeRatio >= opts.minFontSizeRatio;
        const isBold = fontWeight === "bold";
        const isBoldDifferent = isBold && bodyWeight !== "bold";
        const isKeyword = matchesSectionKeyword(text, opts.sectionKeywords);
        const isNumbered = opts.detectNumberedSections && matchesNumberedPattern(text);
        const isAllCaps = text === text.toUpperCase() && text.length > 3 && /[A-Z]/.test(text);
        const isShort = text.length < 100;
        const isFirstLine = lineInBlock === 0;

        // Determine if this line is a potential heading
        // More permissive: consider any line that has at least one positive signal
        const isPotentialHeading =
          isLarger ||
          (isBoldDifferent && isShort) ||
          isKeyword ||
          isNumbered ||
          (isAllCaps && isShort) ||
          (isFirstLine && isBold && isShort && text.length < 80);

        if (isPotentialHeading) {
          const confidence = calculateConfidence(line, averageFontSize, opts, fontAnalysis);

          // Lower threshold to catch more headings (was 0.7, now 0.4)
          if (confidence >= 0.4) {
            potentialHeadings.push({
              line,
              pageNumber: page.pageNumber,
              lineIndex,
              blockIndex,
              confidence,
            });
            headingFontSizes.push(fontSize);

            // Debug: log detected heading
            // console.log(`[SectionDetection] Found: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}" (${fontSize}pt ${fontWeight}, conf=${confidence.toFixed(2)}, p.${page.pageNumber})`);
          }
        }

        lineIndex++;
        lineInBlock++;
      }
      blockIndex++;
    }
  }

  // console.log(`[SectionDetection] Total potential headings: ${potentialHeadings.length}`);

  // Second pass: create sections with proper heading levels
  for (const heading of potentialHeadings) {
    const level = calculateHeadingLevel(heading.line.font.size, headingFontSizes);

    sections.push({
      title: heading.line.text.trim(),
      level,
      pageNumber: heading.pageNumber,
      startLineIndex: heading.lineIndex,
      fontSize: heading.line.font.size,
      fontWeight: heading.line.font.weight,
      bbox: heading.line.bbox,
      confidence: heading.confidence,
    });
  }

  return sections;
}

/**
 * Get a summary of detected sections
 */
export function getSectionsSummary(sections: DetectedSection[]): string {
  if (sections.length === 0) {
    return "No sections detected";
  }

  const lines: string[] = [`Detected ${sections.length} sections:\n`];

  for (const section of sections) {
    const indent = "  ".repeat(section.level - 1);
    const confidence = Math.round(section.confidence * 100);
    lines.push(
      `${indent}• ${section.title} (p.${section.pageNumber}, ${section.fontSize}pt, ${confidence}% confidence)`
    );
  }

  return lines.join("\n");
}

/**
 * Extract text content for each detected section
 * Uses full text (with highlights) to find section positions,
 * then filters out highlights from the extracted content
 *
 * @param pages - Structured pages with highlights
 * @param sections - Detected sections
 * @param precomputedText - Optional pre-computed joined text (to ensure consistency)
 * @param precomputedHighlights - Optional pre-computed highlights (to ensure consistency)
 */
export function extractSectionContent(
  pages: StructuredPage[],
  sections: DetectedSection[],
  precomputedText?: string,
  precomputedHighlights?: TextHighlight[]
): DetectedSectionWithContent[] {
  if (sections.length === 0) {
    return [];
  }

  let fullText: string;
  let highlights: TextHighlight[];

  if (precomputedText && precomputedHighlights) {
    // Use pre-computed values for consistency with document-level highlights
    fullText = precomputedText;
    highlights = precomputedHighlights;
    // console.log(`[SectionContent] Using pre-computed text and ${highlights.length} highlights`);
  } else {
    // Debug: check per-page highlights before joining
    let totalPageHighlights = 0;
    for (const page of pages) {
      if (page.highlights && page.highlights.length > 0) {
        totalPageHighlights += page.highlights.length;
      }
    }
    // console.log(`[SectionContent] Pages with highlights: ${pages.filter(p => p.highlights?.length).length}/${pages.length}, total: ${totalPageHighlights}`);

    // Join all pages to get full document text with highlights
    const joinedResult = joinPagesWithHyphenHandling(pages);
    fullText = joinedResult.text;
    highlights = joinedResult.highlights;
  }

  // Debug: log overall highlight stats
  const highlightStats = highlights.reduce((acc, h) => {
    acc[h.type] = (acc[h.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  // console.log(`[SectionContent] Total highlights: ${highlights.length}`, highlightStats);

  const result: DetectedSectionWithContent[] = [];

  // Track search position - start after previous section to skip TOC entries
  let searchFrom = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const nextSection = sections[i + 1];

    // Find section title starting from searchFrom (skips TOC)
    const titlePos = fullText.indexOf(section.title, searchFrom);
    if (titlePos === -1) {
      // Title not found, skip this section
      // console.log(`[SectionContent] Title not found: "${section.title.slice(0, 50)}..."`);
      result.push({
        ...section,
        content: '',
        contentPreview: '',
        startOffset: 0,
        endOffset: 0,
      });
      continue;
    }

    // Content starts immediately after title, skip any whitespace
    // Don't search for newline - heading may be joined with body text
    const titleEnd = titlePos + section.title.length;
    let startOffset = titleEnd;
    // Skip any whitespace between title and content
    while (startOffset < fullText.length && /\s/.test(fullText[startOffset])) {
      startOffset++;
    }

    // Content ends at the start of the next section, or end of document
    let endOffset: number;
    if (nextSection) {
      const nextTitlePos = fullText.indexOf(nextSection.title, startOffset);
      endOffset = nextTitlePos !== -1 ? nextTitlePos : fullText.length;
    } else {
      endOffset = fullText.length;
    }

    // Extract raw content (don't trim yet - need accurate offsets for highlight removal)
    const rawContentUntrimmed = fullText.slice(startOffset, endOffset);

    // Calculate leading whitespace to adjust highlight offsets after trim
    const leadingWhitespace = rawContentUntrimmed.length - rawContentUntrimmed.trimStart().length;

    const rawContent = rawContentUntrimmed.trim();
    const trailingWhitespace = rawContentUntrimmed.length - rawContentUntrimmed.trimEnd().length;

    // Filter highlights that overlap with this section's range
    // IMPORTANT: Only include highlights that START within the section to avoid
    // removing body text that was incorrectly tagged by a highlight that started earlier
    const MAX_OVERLAP_FROM_BEFORE = 50; // Max chars to remove from highlights that started before section

    const sectionHighlights = highlights
      .filter(h => {
        // Must overlap with section
        const overlaps = h.start < endOffset && h.end > startOffset;
        if (!overlaps) return false;

        // If highlight started before section, limit how much we can remove
        if (h.start < startOffset) {
          const overlapInSection = Math.min(h.end, endOffset) - startOffset;
          if (overlapInSection > MAX_OVERLAP_FROM_BEFORE) {
            // This highlight extends too far into the section - probably body text
            return false;
          }
        }
        return true;
      })
      .map(h => ({
        ...h,
        // Clamp highlight to section boundaries, then adjust for offset and trim
        start: Math.max(0, Math.max(h.start, startOffset) - startOffset - leadingWhitespace),
        end: Math.min(rawContent.length, Math.max(0, Math.min(h.end, endOffset) - startOffset - leadingWhitespace)),
      }))
      .filter(h => h.end > h.start && h.start < rawContent.length); // Remove invalid highlights

    // Debug: log highlight details
    const highlightsByType = sectionHighlights.reduce((acc, h) => {
      acc[h.type] = (acc[h.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // if (Object.keys(highlightsByType).length > 0) {
    //   console.log(`[SectionContent] Highlights for "${section.title.slice(0, 20)}...": ${JSON.stringify(highlightsByType)}`);
    //   // Show sample of what will be removed
    //   for (const h of sectionHighlights.slice(0, 3)) {
    //     const sample = rawContent.slice(h.start, Math.min(h.end, h.start + 50));
    //     console.log(`  [${h.type}] pos ${h.start}-${h.end}: "${sample}${h.end - h.start > 50 ? '...' : ''}"`);
    //   }
    // }

    // Remove ALL highlighted/tagged content (same as "Hide Tagged sections" in UI)
    const cleanContent = removeHighlightedSections(
      rawContent,
      sectionHighlights,
      ['anomaly', 'legend', 'footnote', 'figure_label', 'reference', 'header', 'footer', 'page_number', 'author']
    );

    // Create preview (first 200 chars)
    const contentPreview = cleanContent.slice(0, 200) + (cleanContent.length > 200 ? '...' : '');

    result.push({
      ...section,
      content: cleanContent,
      contentPreview,
      startOffset,
      endOffset,
    });

    // Update searchFrom for next iteration (move past this section's title)
    searchFrom = titlePos + section.title.length;

    // Debug: show raw vs clean difference
    const charsDiff = rawContent.length - cleanContent.length;
    // console.log(`[SectionContent] "${section.title.slice(0, 30)}..." → raw: ${rawContent.length}, clean: ${cleanContent.length} (removed ${charsDiff} chars)`);
  }

  return result;
}

/**
 * Build a hierarchical section tree from flat sections list
 * Sections are nested based on their level (level 2 becomes child of level 1, etc.)
 */
export function buildSectionTree(
  sectionsWithContent: DetectedSectionWithContent[]
): SectionTree {
  const tree: SectionNode[] = [];
  const stack: SectionNode[] = [];  // Track parent hierarchy

  // Get full text from the first section's range (for reference)
  const fullText = '';

  for (const section of sectionsWithContent) {
    const node: SectionNode = {
      title: section.title,
      level: section.level,
      content: section.content,
      children: [],
      pageNumber: section.pageNumber,
      confidence: section.confidence,
      startOffset: section.startOffset,
      endOffset: section.endOffset,
    };

    // Find parent: pop stack until we find a section with lower level
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      // Top-level section (no parent with lower level)
      tree.push(node);
    } else {
      // Child of the last item in stack
      stack[stack.length - 1].children.push(node);
    }

    stack.push(node);
  }

  return { sections: tree, fullText };
}
