"use server";

import type {
  ParsedPDFExtended,
  StructuredPage,
  StructuredBlock,
  StructuredLine,
  FontInfo,
  BoundingBox,
  TextHighlight,
  DetectedArtifact,
} from "../types";
import { type ArtifactCleaningOptions } from "../utils/artifact-cleaning";
import {
  detectSections,
  extractSectionContent,
  buildSectionTree,
  type DetectedSection,
  type DetectedSectionWithContent,
  type SectionTree,
  type CuratedSection,
} from "../utils/section-detection";
import { curateSectionsWithOutline } from "../utils/section-curation";
import { detectAndMergeLettrines, type DetectedLettrine } from "../utils/lettrine-detection";
import { joinLinesIntoParagraphs, joinPagesWithHyphenHandling } from "../utils/paragraph-joining";
import {
  matchOutlineToDocument,
  extractOutlineSectionContent,
} from "../utils/outline-matching";
import type { OutlineSectionWithContent } from "../types";

// MuPDF.js JSON structure types (from toStructuredText().asJSON())
interface MuPDFBbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface MuPDFFont {
  name: string;
  family: string;
  weight: string;
  style: string;
  size: number;
}

interface MuPDFChar {
  c: string;
  quad?: number[];
  origin?: number[];
}

interface MuPDFSpan {
  font: string;
  size: number;
  flags: number;
  color: number;
  chars?: MuPDFChar[];
}

interface MuPDFLine {
  wmode: number;
  bbox: MuPDFBbox | number[];
  font?: MuPDFFont;
  dir?: number[];
  x?: number;
  y?: number;
  text?: string;
  spans?: MuPDFSpan[];
}

interface MuPDFBlock {
  type: string;
  bbox: MuPDFBbox | number[];
  lines?: MuPDFLine[];
}

interface MuPDFStructuredText {
  blocks: MuPDFBlock[];
}

/**
 * Extract font family from font name
 */
function extractFontFamily(fontName: string): string {
  if (/arial|helvetica|sans/i.test(fontName)) return "sans-serif";
  if (/times|georgia|serif/i.test(fontName)) return "serif";
  if (/courier|mono|consolas/i.test(fontName)) return "monospace";
  return "sans-serif";
}

/**
 * Parse font flags from MuPDF to determine weight/style
 * MuPDF font flags: bit 0 = superscript, bit 1 = italic, bit 2 = serif, bit 3 = monospace, bit 4 = bold
 */
function parseFontFlags(flags: number, fontName?: string): { weight: string; style: string } {
  const isBoldFlag = (flags & 16) !== 0;
  const isItalicFlag = (flags & 2) !== 0;

  // Also check font name for bold/italic indicators (flags aren't always reliable)
  const isBoldName = fontName ? /[.\-_]B$|Bold|\.B\+|Bd$/i.test(fontName) : false;
  const isItalicName = fontName ? /[.\-_]I$|Italic|Oblique/i.test(fontName) : false;

  return {
    weight: (isBoldFlag || isBoldName) ? "bold" : "normal",
    style: (isItalicFlag || isItalicName) ? "italic" : "normal",
  };
}

/**
 * Convert MuPDF bbox (either array or object) to our BoundingBox format
 */
function convertBbox(bbox: MuPDFBbox | number[]): BoundingBox {
  if (Array.isArray(bbox)) {
    // Array format: [x, y, x2, y2] or [x, y, w, h] - assume it's [x, y, x2, y2]
    return {
      x: bbox[0] ?? 0,
      y: bbox[1] ?? 0,
      w: (bbox[2] ?? 0) - (bbox[0] ?? 0),
      h: (bbox[3] ?? 0) - (bbox[1] ?? 0),
    };
  }
  // Object format with x, y, w, h
  return {
    x: bbox.x,
    y: bbox.y,
    w: bbox.w,
    h: bbox.h,
  };
}

/**
 * Convert MuPDF line to our StructuredLine format
 * Extracts text from spans/chars and captures character positions for word-break detection
 */
function convertLine(line: MuPDFLine): StructuredLine {
  // Track first and last character positions for word-break detection
  let firstCharX: number | undefined;
  let lastCharX: number | undefined;
  let text = "";
  let fontSize = 12;
  let fontName = "unknown";
  let fontWeight = "normal";
  let fontStyle = "normal";

  // If spans are available, extract text and char positions from them
  if (line.spans && line.spans.length > 0) {
    for (const span of line.spans) {
      if (span.chars && span.chars.length > 0) {
        text += span.chars.map((char) => char.c).join("");

        // Track first character position (from first span with chars)
        if (firstCharX === undefined) {
          const firstChar = span.chars[0];
          if (firstChar.quad && firstChar.quad.length >= 2) {
            // quad[0] is x0 (left edge of first corner)
            firstCharX = firstChar.quad[0];
          } else if (firstChar.origin && firstChar.origin.length >= 1) {
            firstCharX = firstChar.origin[0];
          }
        }

        // Track last character position (update with each span)
        const lastChar = span.chars[span.chars.length - 1];
        if (lastChar.quad && lastChar.quad.length >= 4) {
          // quad[2] is x1 (right edge - top-right corner x)
          lastCharX = lastChar.quad[2];
        } else if (lastChar.origin && lastChar.origin.length >= 1) {
          // Estimate right edge from origin + approximate char width
          lastCharX = lastChar.origin[0] + (span.size * 0.5);
        }
      }
    }

    // Use first span's font info
    const firstSpan = line.spans[0];
    fontSize = firstSpan.size || fontSize;
    fontName = firstSpan.font || fontName;
    const flagInfo = parseFontFlags(firstSpan.flags || 0, fontName);
    fontWeight = flagInfo.weight;
    fontStyle = flagInfo.style;
  } else {
    // Fallback to line.text if no spans available
    text = line.text || "";
    if (line.font) {
      fontName = line.font.name || fontName;
      fontSize = line.font.size || fontSize;
      fontWeight = line.font.weight || fontWeight;
      fontStyle = line.font.style || fontStyle;
    }
  }

  const fontInfo: FontInfo = {
    name: fontName,
    family: extractFontFamily(fontName),
    size: fontSize,
    weight: fontWeight,
    style: fontStyle,
  };

  return {
    text,
    bbox: convertBbox(line.bbox),
    font: fontInfo,
    wmode: line.wmode,
    firstCharX,
    lastCharX,
  };
}

/**
 * Convert MuPDF block to our StructuredBlock format
 */
function convertBlock(block: MuPDFBlock): StructuredBlock {
  const lines: StructuredLine[] = (block.lines || []).map(convertLine);
  return {
    type: block.type,
    bbox: convertBbox(block.bbox),
    lines,
  };
}

/**
 * Calculate the dominant (most frequent) font size from structured pages
 * This represents the body text font size, which is a better reference
 * for superscript detection than the average (which can be skewed by headings)
 */
function calculateDominantFontSize(pages: StructuredPage[]): number {
  // Count occurrences of each font size (rounded to 1pt for grouping)
  const fontSizeCounts = new Map<number, number>();

  for (const page of pages) {
    for (const block of page.blocks) {
      for (const line of block.lines) {
        if (line.font.size > 0) {
          // Round to nearest 1pt to group similar sizes
          const rounded = Math.round(line.font.size);
          fontSizeCounts.set(rounded, (fontSizeCounts.get(rounded) || 0) + 1);
        }
      }
    }
  }

  if (fontSizeCounts.size === 0) return 12;

  // Find the most frequent font size that's >= 8pt (body text minimum)
  // This prevents superscripts and footnotes from being picked as dominant
  // Body text is typically 9-12pt in most documents
  let dominantSize = 12;
  let maxCount = 0;

  for (const [size, count] of fontSizeCounts) {
    if (size >= 8 && count > maxCount) {
      maxCount = count;
      dominantSize = size;
    }
  }

  // Fallback: if no font >= 8pt found, use the overall most frequent
  if (maxCount === 0) {
    for (const [size, count] of fontSizeCounts) {
      if (count > maxCount) {
        maxCount = count;
        dominantSize = size;
      }
    }
  }

  return dominantSize;
}

// Keep old function name as alias for compatibility
function calculateAverageFontSize(pages: StructuredPage[]): number {
  return calculateDominantFontSize(pages);
}

/**
 * Extract plain text from structured page
 */
function extractPlainText(page: StructuredPage): string {
  const lines: string[] = [];
  for (const block of page.blocks) {
    for (const line of block.lines) {
      if (line.text.trim()) {
        lines.push(line.text);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

/**
 * Server action to process PDF with MuPDF
 * Accepts base64-encoded PDF data and returns parsed result
 */
export async function processPDFWithMuPDFAction(
  base64Data: string,
  filename: string,
  cleaningOptions: ArtifactCleaningOptions = {}
): Promise<{
  data: (ParsedPDFExtended & {
    detectedSections?: CuratedSection[];
    sectionTree?: SectionTree;
    detectedLettrines?: DetectedLettrine[];
    documentHighlights?: TextHighlight[];
    pdfOutline?: Array<{ title: string; page: number; level: number }>;
    outlineSections?: OutlineSectionWithContent[];
  }) | null;
  error: string | null;
  processingTime: number;
}> {
  const startTime = performance.now();

  try {
    const mupdf = await import("mupdf");

    // Decode base64 to ArrayBuffer
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const arrayBuffer = bytes.buffer;

    // Open the document
    const doc = mupdf.Document.openDocument(arrayBuffer, "application/pdf");

    const numPages = doc.countPages();
    const structuredPages: StructuredPage[] = [];
    const pages: Array<{ pageNumber: number; text: string }> = [];
    let fullText = "";

    // Process each page
    for (let pageNum = 0; pageNum < numPages; pageNum++) {
      const page = doc.loadPage(pageNum);
      const bounds = page.getBounds();
      const width = bounds[2] - bounds[0];
      const height = bounds[3] - bounds[1];

      // Use preserve-spans to get per-span font information (needed for inline superscript detection)
      const sText = page.toStructuredText("preserve-whitespace,preserve-spans");
      const jsonStr = sText.asJSON();
      const structuredText: MuPDFStructuredText = JSON.parse(jsonStr);

      const blocks: StructuredBlock[] = structuredText.blocks.map(convertBlock);

      const structuredPage: StructuredPage = {
        pageNumber: pageNum + 1,
        width,
        height,
        blocks,
        rawText: "",
      };

      structuredPage.rawText = extractPlainText(structuredPage);

      structuredPages.push(structuredPage);
      pages.push({
        pageNumber: pageNum + 1,
        text: structuredPage.rawText,
      });

      fullText += structuredPage.rawText + "\n\n";
    }

    // Check if MuPDF failed to decode fonts (garbage text detection)
    // Count replacement characters (U+FFFD) and other common garbage indicators
    const textWithoutWhitespace = fullText.replace(/\s/g, '');
    const replacementCount = (fullText.match(/\uFFFD/g) || []).length;
    const totalChars = textWithoutWhitespace.length;
    const garbageRatio = totalChars > 0 ? replacementCount / totalChars : 0;

    if (garbageRatio > 0.2) { // More than 20% replacement characters
      const processingTime = performance.now() - startTime;
      return {
        data: null,
        error: "FONT_ENCODING_UNSUPPORTED",
        processingTime,
      };
    }

    const averageFontSize = calculateAverageFontSize(structuredPages);

    // Get metadata
    let metadata: Record<string, unknown> = {};
    try {
      metadata = {
        title: doc.getMetaData(mupdf.Document.META_INFO_TITLE) || "",
        author: doc.getMetaData(mupdf.Document.META_INFO_AUTHOR) || "",
        subject: doc.getMetaData(mupdf.Document.META_INFO_SUBJECT) || "",
        keywords: doc.getMetaData(mupdf.Document.META_INFO_KEYWORDS) || "",
        creator: doc.getMetaData(mupdf.Document.META_INFO_CREATOR) || "",
        producer: doc.getMetaData(mupdf.Document.META_INFO_PRODUCER) || "",
        creationDate: doc.getMetaData(mupdf.Document.META_INFO_CREATIONDATE) || "",
        modDate: doc.getMetaData(mupdf.Document.META_INFO_MODIFICATIONDATE) || "",
      };
    } catch {
      // Metadata extraction failed
    }

    // Skip artifact cleaning - anomaly/footnote/figure label detection in paragraph joining is sufficient
    const removedArtifacts: DetectedArtifact[] = [];

    // Extract PDF outline (table of contents) if available
    let pdfOutline: Array<{ title: string; page: number; level: number }> = [];
    try {
      const outline = doc.loadOutline();
      if (outline && outline.length > 0) {
        // Flatten the hierarchical outline for comparison
        const flattenOutline = (items: any[], level: number = 1): Array<{ title: string; page: number; level: number }> => {
          const result: Array<{ title: string; page: number; level: number }> = [];
          for (const item of items) {
            result.push({
              title: item.title || '',
              page: (item.page ?? 0) + 1, // MuPDF uses 0-indexed pages
              level,
            });
            if (item.down && item.down.length > 0) {
              result.push(...flattenOutline(item.down, level + 1));
            }
          }
          return result;
        };
        pdfOutline = flattenOutline(outline);
      }
    } catch {
      // Outline extraction failed
    }

    // Detect and merge lettrines (drop caps)
    const { processedPages, detectedLettrines } = detectAndMergeLettrines(
      structuredPages,
      averageFontSize
    );

    // Join lines into paragraphs (remove mid-sentence line breaks)
    // Pass metadata author to help detect author blocks
    const metadataAuthor = typeof metadata.author === 'string' ? metadata.author : '';
    const paragraphPages = joinLinesIntoParagraphs(processedPages, averageFontSize, { metadataAuthor });

    // Join pages ONCE to get consistent text and highlights for both document and sections
    const joinedResult = joinPagesWithHyphenHandling(paragraphPages);
    const cleanedText = joinedResult.text;
    const documentHighlights = joinedResult.highlights;

    // console.log(`[MuPDF] Joined document: ${cleanedText.length} chars, ${documentHighlights.length} highlights`);

    // Section detection: Font-based detection, then curate with outline if available
    let detectedSections: DetectedSectionWithContent[] = [];
    let curatedSections: CuratedSection[] = [];
    let sectionTree: SectionTree = { sections: [], fullText: '' };
    let outlineSections: OutlineSectionWithContent[] | undefined;

    // Always run font-based section detection first
    const rawSections = detectSections(paragraphPages, averageFontSize);
    // Pass pre-computed text and highlights to ensure consistency
    detectedSections = extractSectionContent(paragraphPages, rawSections, cleanedText, documentHighlights);
    sectionTree = buildSectionTree(detectedSections);

    if (pdfOutline.length > 0) {
      // Curate detected sections using the PDF outline
      curatedSections = curateSectionsWithOutline(detectedSections, pdfOutline);

      // Also process outline for legacy support
      const outlineMatches = matchOutlineToDocument(
        pdfOutline,
        paragraphPages,
        averageFontSize
      );
      outlineSections = extractOutlineSectionContent(outlineMatches, paragraphPages);

      const skippedMatches = outlineMatches.filter(m => m.skipped);
      const activeMatches = outlineMatches.filter(m => !m.skipped);

      // console.log('\n========== SECTION CURATION ==========');
      // console.log(`PDF Outline entries: ${pdfOutline.length}`);
      // console.log(`Font-based sections: ${detectedSections.length}`);
      // console.log(`Curated sections: ${curatedSections.length} (${curatedSections.filter(s => s.verified).length} verified, ${curatedSections.filter(s => !s.verified).length} unverified)`);

      // if (skippedMatches.length > 0) {
      //   console.log('\n--- SKIPPED OUTLINE ENTRIES (legends/captions) ---');
      //   for (const match of skippedMatches) {
      //     console.log(`  [${match.skipReason}] "${match.outlineEntry.title}"`);
      //   }
      // }

      // console.log('\n--- CURATED SECTIONS ---');
      // for (const section of curatedSections) {
      //   const indent = '  '.repeat(section.level - 1);
      //   const status = section.verified ? '✓' : '?';
      //   const originalNote = section.originalTitle && section.originalTitle !== section.title
      //     ? ` (was: "${section.originalTitle.slice(0, 30)}...")`
      //     : '';
      //   console.log(`${indent}[${status}] L${section.level} p.${section.pageNumber}: "${section.title.slice(0, 50)}${section.title.length > 50 ? '...' : ''}"${originalNote}`);
      // }
      // console.log('=======================================\n');
    } else {
      // No outline available - mark all sections as unverified
      curatedSections = detectedSections.map(s => ({ ...s, verified: false }));

      // console.log('\n--- PDF OUTLINE: None (all sections unverified) ---');
      // console.log(`Detected ${detectedSections.length} sections via font-based heuristics`);
      // for (const section of curatedSections) {
      //   const indent = '  '.repeat(section.level - 1);
      //   console.log(`${indent}[?] L${section.level} p.${section.pageNumber} (${Math.round(section.confidence * 100)}%): "${section.title.slice(0, 60)}${section.title.length > 60 ? '...' : ''}"`);
      // }
      // console.log('=========================================\n');
    }

    // Insert section_start highlights for verified sections only
    // These are permanent markers that won't be removed when hiding tagged sections
    const sectionMarkers: TextHighlight[] = [];
    for (const section of curatedSections) {
      if (!section.verified) continue;

      // Always use trimmed title for searching
      const titleToFind = section.title.trim();

      // Find the title position in the full text
      // Try multiple search strategies
      let titlePos = -1;
      let actualLength = titleToFind.length;

      // Strategy 1: Exact match near expected position
      const searchStart = Math.max(0, section.startOffset - titleToFind.length - 100);
      titlePos = cleanedText.indexOf(titleToFind, searchStart);

      // Strategy 2: If not found or found after content start, try from beginning
      if (titlePos === -1 || titlePos >= section.startOffset) {
        titlePos = cleanedText.indexOf(titleToFind);
      }

      // Strategy 3: Try case-insensitive search
      if (titlePos === -1) {
        const lowerText = cleanedText.toLowerCase();
        const lowerTitle = titleToFind.toLowerCase();
        titlePos = lowerText.indexOf(lowerTitle);
      }

      // Strategy 4: Whitespace-normalized search (handles "1Introduction" vs "1 Introduction")
      if (titlePos === -1) {
        // Remove all spaces from both title and create a pattern to find it
        const titleNoSpaces = titleToFind.replace(/\s+/g, '');
        const textNoSpaces = cleanedText.replace(/\s+/g, '');
        const posInNoSpaces = textNoSpaces.toLowerCase().indexOf(titleNoSpaces.toLowerCase());

        if (posInNoSpaces !== -1) {
          // Found in space-collapsed text, now find the actual position in original text
          // Count characters in original text until we reach posInNoSpaces non-space chars
          let nonSpaceCount = 0;
          let actualPos = 0;
          for (let i = 0; i < cleanedText.length && nonSpaceCount < posInNoSpaces; i++) {
            if (!/\s/.test(cleanedText[i])) {
              nonSpaceCount++;
            }
            actualPos = i + 1;
          }
          // Now find where the title ends (titleNoSpaces.length non-space chars from actualPos)
          let endNonSpaceCount = 0;
          let actualEnd = actualPos;
          for (let i = actualPos; i < cleanedText.length && endNonSpaceCount < titleNoSpaces.length; i++) {
            if (!/\s/.test(cleanedText[i])) {
              endNonSpaceCount++;
            }
            actualEnd = i + 1;
          }
          titlePos = actualPos;
          actualLength = actualEnd - actualPos;
          // console.log(`[MuPDF] Whitespace-normalized match: "${titleToFind}" found at ${titlePos}-${titlePos + actualLength}`);
        }
      }

      if (titlePos !== -1) {
        // Format the title for display:
        // 1. Remove line breaks
        // 2. Add space between number and text (e.g., "2.3Difference" → "2.3 Difference")
        const formattedTitle = titleToFind
          .replace(/[\r\n]+/g, ' ')  // Remove line breaks
          .replace(/(\d+\.?\d*\.?\d*)\s*([A-Za-z])/g, '$1 $2')  // Add space after number prefix
          .replace(/\s+/g, ' ')  // Normalize multiple spaces
          .trim();

        sectionMarkers.push({
          type: 'section_start',
          start: titlePos,
          end: titlePos + actualLength,
          sectionTitle: formattedTitle,
          sectionLevel: section.level,
        });
        // console.log(`[MuPDF] Section marker: "${formattedTitle}" at pos ${titlePos}-${titlePos + actualLength}`);
      } else {
        // console.log(`[MuPDF] Section title NOT FOUND: "${titleToFind}" (startOffset: ${section.startOffset})`);
        // Debug: show nearby text
        // const nearby = cleanedText.slice(Math.max(0, section.startOffset - 50), section.startOffset + 50);
        // console.log(`[MuPDF] Nearby text: "${nearby}"`);
      }
    }

    // Merge section markers into document highlights
    const allHighlights = [...documentHighlights, ...sectionMarkers];
    // console.log(`[MuPDF] Added ${sectionMarkers.length} section_start markers for verified sections`);

    // cleanedText and documentHighlights already computed above (before section detection)
    // This ensures the same highlights are used for both document display and section cleanup
    const cleanedPagesList = paragraphPages.map((page) => ({
      pageNumber: page.pageNumber,
      text: page.rawText,
    }));

    const processingTime = performance.now() - startTime;

    // Target debug: check text being returned
    if (cleanedText.includes('Outside')) {
      const idx = cleanedText.indexOf('Outside');
      console.log(`[MUPDF_RETURN] text around "Outside": "${cleanedText.slice(Math.max(0, idx-10), idx+60).replace(/\n/g, '\\n')}"`);
    }

    return {
      data: {
        text: cleanedText,
        numPages,
        metadata,
        pages: cleanedPagesList,
        structuredPages: paragraphPages,
        averageFontSize,
        detectedHeadings: [],
        removedArtifacts,
        detectedSections: curatedSections,
        sectionTree,
        detectedLettrines,
        documentHighlights: allHighlights.length > 0 ? allHighlights : undefined,
        pdfOutline: pdfOutline.length > 0 ? pdfOutline : undefined,
        outlineSections: outlineSections && outlineSections.length > 0 ? outlineSections : undefined,
      },
      error: null,
      processingTime,
    };
  } catch (err) {
    const processingTime = performance.now() - startTime;
    console.error("MuPDF processing error:", err);
    return {
      data: null,
      error: err instanceof Error ? err.message : "Failed to process PDF with MuPDF",
      processingTime,
    };
  }
}
