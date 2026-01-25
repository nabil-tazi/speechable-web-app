import type { ParsedPDFExtended, TextHighlight, OutlineSectionWithContent } from "@/app/features/pdf/types";
import {
  detectSections,
  extractSectionContent,
  buildSectionTree,
  type DetectedSectionWithContent,
  type SectionTree,
  type CuratedSection,
} from "@/app/features/pdf/utils/section-detection";
import { curateSectionsWithOutline } from "./section-curation";
import { extractStructuredPagesFromPDFJS, convertSuperscriptsToHighlights } from "./pdfjs-structured";
import { cleanArtifacts } from "./artifact-cleaning";
import { joinLinesIntoParagraphs, joinPagesWithHyphenHandling } from "./paragraph-joining";
import { detectAndMergeLettrines, type DetectedLettrine } from "./lettrine-detection";
import { matchOutlineToDocument, extractOutlineSectionContent } from "./outline-matching";

export interface PDFJSProcessingResult {
  data: (ParsedPDFExtended & {
    detectedSections?: CuratedSection[];
    sectionTree?: SectionTree;
    detectedLettrines?: DetectedLettrine[];
    documentHighlights?: TextHighlight[];
    pdfOutline?: Array<{ title: string; page: number; level: number }>;
    outlineSections?: OutlineSectionWithContent[];
  }) | null;
  error?: string;
  processingTime: number;
}

/**
 * Process PDF with PDF.js and apply the same processing pipeline as MuPDF
 * This includes: artifact cleaning, paragraph joining, hyphen handling, section detection, etc.
 */
export async function processPDFWithPDFJSEnhanced(
  file: File
): Promise<PDFJSProcessingResult> {
  const startTime = performance.now();

  try {
    // Load PDF.js and get document
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Extract structured pages from PDF.js (also detects superscripts via font size)
    const { pages: structuredPages, averageFontSize, fontBasedSuperscripts } = await extractStructuredPagesFromPDFJS(file);

    if (structuredPages.length === 0) {
      return {
        data: null,
        error: "No pages extracted",
        processingTime: performance.now() - startTime,
      };
    }

    // Get metadata
    const pdfMetadata = await pdf.getMetadata();
    const metadata = pdfMetadata.info as Record<string, unknown>;

    // Extract PDF outline (table of contents) if available
    let pdfOutline: Array<{ title: string; page: number; level: number }> = [];
    try {
      const outline = await pdf.getOutline();
      if (outline && outline.length > 0) {
        // Flatten the hierarchical outline
        const flattenOutline = async (
          items: any[],
          level: number = 1
        ): Promise<Array<{ title: string; page: number; level: number }>> => {
          const result: Array<{ title: string; page: number; level: number }> = [];
          for (const item of items) {
            // Get page number from destination
            let pageNum = 1;
            if (item.dest) {
              try {
                const dest = typeof item.dest === 'string'
                  ? await pdf.getDestination(item.dest)
                  : item.dest;
                if (dest && dest[0]) {
                  const pageRef = dest[0];
                  const pageIndex = await pdf.getPageIndex(pageRef);
                  pageNum = pageIndex + 1;
                }
              } catch {
                // Fallback to page 1 if destination resolution fails
              }
            }
            result.push({
              title: item.title || '',
              page: pageNum,
              level,
            });
            if (item.items && item.items.length > 0) {
              result.push(...await flattenOutline(item.items, level + 1));
            }
          }
          return result;
        };
        pdfOutline = await flattenOutline(outline);
      }
    } catch {
      // Outline extraction failed
    }

    // Apply artifact cleaning (headers, footers, page numbers)
    const { cleanedPages, removedArtifacts } = cleanArtifacts(structuredPages);

    // Detect and merge lettrines (drop caps)
    const { processedPages, detectedLettrines } = detectAndMergeLettrines(
      cleanedPages,
      averageFontSize
    );

    // Apply paragraph joining (same processing as MuPDF)
    const metadataAuthor = typeof metadata.Author === 'string' ? metadata.Author : '';
    const paragraphPages = joinLinesIntoParagraphs(
      processedPages,
      averageFontSize,
      {
        removeHyphens: true,
        metadataAuthor,
      }
    );

    // Join pages with hyphen handling
    const { text: fullText, highlights: documentHighlights } = joinPagesWithHyphenHandling(paragraphPages);

    // Convert font-based superscripts (from PDF.js) to highlights
    const fontBasedHighlights = convertSuperscriptsToHighlights(
      fullText,
      fontBasedSuperscripts,
      documentHighlights
    );

    // Section detection: Font-based detection, then curate with outline if available
    let detectedSections: DetectedSectionWithContent[] = [];
    let curatedSections: CuratedSection[] = [];
    let sectionTree: SectionTree = { sections: [], fullText: '' };
    let outlineSections: OutlineSectionWithContent[] | undefined;

    // Always run font-based section detection first
    const rawSections = detectSections(paragraphPages, averageFontSize);
    detectedSections = extractSectionContent(paragraphPages, rawSections, fullText, documentHighlights);
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
    } else {
      // No outline available - mark all sections as unverified
      curatedSections = detectedSections.map(s => ({ ...s, verified: false }));
    }

    // Insert section markers for all detected sections
    // - section_start for verified sections (matched to PDF outline)
    // - heading for unverified sections (font-based detection only)
    const sectionMarkers: TextHighlight[] = [];
    for (const section of curatedSections) {
      const titleToFind = section.title.trim();
      let titlePos = -1;
      let actualLength = titleToFind.length;

      // Strategy 1: Exact match near expected position
      const searchStart = Math.max(0, section.startOffset - titleToFind.length - 100);
      titlePos = fullText.indexOf(titleToFind, searchStart);

      // Strategy 2: If not found or found after content start, try from beginning
      if (titlePos === -1 || titlePos >= section.startOffset) {
        titlePos = fullText.indexOf(titleToFind);
      }

      // Strategy 3: Try case-insensitive search
      if (titlePos === -1) {
        const lowerText = fullText.toLowerCase();
        const lowerTitle = titleToFind.toLowerCase();
        titlePos = lowerText.indexOf(lowerTitle);
      }

      // Strategy 4: Whitespace-normalized search
      if (titlePos === -1) {
        const titleNoSpaces = titleToFind.replace(/\s+/g, '');
        const textNoSpaces = fullText.replace(/\s+/g, '');
        const posInNoSpaces = textNoSpaces.toLowerCase().indexOf(titleNoSpaces.toLowerCase());

        if (posInNoSpaces !== -1) {
          let nonSpaceCount = 0;
          let actualPos = 0;
          for (let i = 0; i < fullText.length && nonSpaceCount < posInNoSpaces; i++) {
            if (!/\s/.test(fullText[i])) {
              nonSpaceCount++;
            }
            actualPos = i + 1;
          }
          let endNonSpaceCount = 0;
          let actualEnd = actualPos;
          for (let i = actualPos; i < fullText.length && endNonSpaceCount < titleNoSpaces.length; i++) {
            if (!/\s/.test(fullText[i])) {
              endNonSpaceCount++;
            }
            actualEnd = i + 1;
          }
          titlePos = actualPos;
          actualLength = actualEnd - actualPos;
        }
      }

      if (titlePos !== -1) {
        const formattedTitle = titleToFind
          .replace(/[\r\n]+/g, ' ')
          .replace(/(\d+\.?\d*\.?\d*)\s*([A-Za-z])/g, '$1 $2')
          .replace(/\s+/g, ' ')
          .trim();

        // Use section_start for verified sections, heading for unverified
        sectionMarkers.push({
          type: section.verified ? 'section_start' : 'heading',
          start: titlePos,
          end: titlePos + actualLength,
          sectionTitle: formattedTitle,
          sectionLevel: section.level,
        });
      }
    }

    // Merge all highlights
    const allHighlights: TextHighlight[] = [
      ...documentHighlights,
      ...fontBasedHighlights,
      ...sectionMarkers,
    ].sort((a, b) => a.start - b.start);

    // Build pages array for backward compatibility
    const pages = paragraphPages.map((page) => ({
      pageNumber: page.pageNumber,
      text: page.rawText,
    }));

    const processingTime = performance.now() - startTime;

    return {
      data: {
        text: fullText,
        numPages: paragraphPages.length,
        metadata,
        pages,
        structuredPages: paragraphPages,
        averageFontSize,
        removedArtifacts,
        detectedHeadings: [],
        detectedSections: curatedSections,
        sectionTree,
        detectedLettrines,
        documentHighlights: allHighlights.length > 0 ? allHighlights : undefined,
        pdfOutline: pdfOutline.length > 0 ? pdfOutline : undefined,
        outlineSections: outlineSections && outlineSections.length > 0 ? outlineSections : undefined,
      },
      processingTime,
    };
  } catch (error) {
    console.error("[PDF.js Enhanced] Processing error:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "PDF.js processing failed",
      processingTime: performance.now() - startTime,
    };
  }
}
