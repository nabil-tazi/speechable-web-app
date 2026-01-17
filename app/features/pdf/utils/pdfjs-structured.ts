import type {
  StructuredPage,
  StructuredBlock,
  StructuredLine,
  FontInfo,
  BoundingBox,
  TextHighlight,
} from "@/app/features/pdf/types";

// Track superscript-like text items detected via font size
export interface SuperscriptSpan {
  text: string;
  fontSize: number;
  x: number;
  y: number;
}

interface PDFJSTextItem {
  str: string;
  transform: number[]; // [scaleX, skewX, skewY, scaleY, translateX, translateY]
  width: number;
  height: number;
  fontName: string;
}

interface PDFJSStyle {
  fontFamily: string;
  ascent: number;
  descent: number;
  vertical?: boolean;
}

// Threshold for detecting superscripts (font size ratio compared to dominant size)
// Real superscripts are typically 60-75% of body text.
const SUPERSCRIPT_RATIO = 0.75;

/**
 * Convert detected superscript spans to text highlights by finding their positions in the final text
 * This handles cases like "104,105" that pattern-based detection might miss
 */
/**
 * Extract just the superscript information from a PDF using PDF.js
 * This can be used alongside MuPDF to get font-based superscript detection
 */
export async function extractSuperscriptsFromPDFJS(
  file: File
): Promise<Map<number, SuperscriptSpan[]>> {
  const pdfjsLib = await import("pdfjs-dist");

  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const fontBasedSuperscripts = new Map<number, SuperscriptSpan[]>();

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    const textItems = textContent.items as PDFJSTextItem[];
    const dominantFontSize = getDominantFontSize(textItems);

    const pageSuperscripts = detectSuperscriptItems(textItems, dominantFontSize);
    if (pageSuperscripts.length > 0) {
      fontBasedSuperscripts.set(pageNum, pageSuperscripts);
    }
  }

  return fontBasedSuperscripts;
}

export function convertSuperscriptsToHighlights(
  text: string,
  fontBasedSuperscripts: Map<number, SuperscriptSpan[]>,
  existingHighlights: Array<{ start: number; end: number; type: string }>
): Array<{ start: number; end: number; type: 'reference' }> {
  const newHighlights: Array<{ start: number; end: number; type: 'reference' }> = [];

  // Collect all superscript texts to search for
  const allSuperscripts: string[] = [];
  for (const [_pageNum, spans] of fontBasedSuperscripts) {
    for (const span of spans) {
      const trimmed = span.text.trim();
      if (trimmed.length > 0) {
        allSuperscripts.push(trimmed);
      }
    }
  }

  // Search for each superscript text in the final text
  for (const superscriptText of allSuperscripts) {
    let searchFrom = 0;

    while (true) {
      const pos = text.indexOf(superscriptText, searchFrom);
      if (pos === -1) break;

      const endPos = pos + superscriptText.length;

      // Check if this is in the MIDDLE of a larger number (e.g., "7" inside "2070")
      // Only skip if BOTH preceded AND followed by digits - this allows superscripts after numbers like "100¹"
      const prevChar = pos > 0 ? text[pos - 1] : '';
      const nextChar = endPos < text.length ? text[endPos] : '';
      const isPartOfLargerNumber = /\d/.test(prevChar) && /\d/.test(nextChar);

      if (isPartOfLargerNumber) {
        searchFrom = endPos;
        continue; // Skip - this is part of a larger number, not a reference
      }

      // Check if this position is already covered by an existing highlight
      const alreadyHighlighted = existingHighlights.some(
        h => (pos >= h.start && pos < h.end) || (endPos > h.start && endPos <= h.end)
      );

      if (!alreadyHighlighted) {
        // Also check against new highlights we're adding
        const alreadyAdded = newHighlights.some(
          h => (pos >= h.start && pos < h.end) || (endPos > h.start && endPos <= h.end)
        );

        if (!alreadyAdded) {
          newHighlights.push({
            start: pos,
            end: endPos,
            type: 'reference',
          });
        }
      }

      searchFrom = endPos;
    }
  }

  return newHighlights;
}

/**
 * Detect superscript text items based on font size AND vertical position
 * Superscripts are positioned ABOVE the baseline of adjacent text
 * This distinguishes them from subscripts (CO2) and other small text
 */
function detectSuperscriptItems(
  items: PDFJSTextItem[],
  dominantFontSize: number
): SuperscriptSpan[] {
  const superscripts: SuperscriptSpan[] = [];

  // First, identify normal-sized items to use as baseline references
  const normalItems = items.filter(item => {
    const fontSize = Math.abs(item.transform[3]) || 12;
    return fontSize >= dominantFontSize * 0.9; // Within 10% of dominant
  });

  if (normalItems.length === 0) {
    return superscripts; // No reference items to compare against
  }

  // Check each item for superscript characteristics
  for (const item of items) {
    const itemFontSize = Math.abs(item.transform[3]) || 12;
    const itemY = item.transform[5]; // PDF Y coordinate (bottom-up)
    const itemX = item.transform[4];

    // Must be significantly smaller than dominant font
    if (itemFontSize >= dominantFontSize * SUPERSCRIPT_RATIO) {
      continue;
    }

    // Must contain reference-like content (digits, commas, dashes)
    if (!/^[\d,\-–\s]+$/.test(item.str.trim())) {
      continue;
    }

    // Find nearby normal-sized items (within ~100pt horizontally, similar Y region)
    const nearbyNormal = normalItems.filter(normal => {
      const normalX = normal.transform[4];
      const normalY = normal.transform[5];
      const xDistance = Math.abs(normalX - itemX);
      const yDistance = Math.abs(normalY - itemY);
      // Must be on roughly the same line (Y within ~20pt) and reasonably close horizontally
      return xDistance < 150 && yDistance < 25;
    });

    if (nearbyNormal.length === 0) {
      continue; // No nearby reference text to compare
    }

    // Calculate average baseline of nearby normal text
    const avgNormalY = nearbyNormal.reduce((sum, n) => sum + n.transform[5], 0) / nearbyNormal.length;
    const avgNormalFontSize = nearbyNormal.reduce((sum, n) => sum + (Math.abs(n.transform[3]) || 12), 0) / nearbyNormal.length;

    // Superscript check: small text should be positioned HIGHER than normal baseline
    // In PDF coords (Y goes up), superscript Y should be > normal baseline
    // The superscript's bottom should be above the normal text's middle
    const normalBaseline = avgNormalY;
    const normalMiddle = avgNormalY + (avgNormalFontSize * 0.4); // Approximate middle of normal text

    // Superscript: item's baseline is above normal text's middle point
    // Subscript: item's baseline is below normal text's baseline
    const isSuperscript = itemY > normalMiddle;

    if (isSuperscript) {
      superscripts.push({
        text: item.str,
        fontSize: itemFontSize,
        x: itemX,
        y: itemY,
      });
    }
  }

  return superscripts;
}

/**
 * Calculate the dominant (most common) font size from text items
 */
function getDominantFontSize(items: PDFJSTextItem[]): number {
  const fontSizes = items.map(i => Math.abs(i.transform[3]) || 12);

  // Count occurrences of each font size (rounded to 1 decimal)
  const counts: Record<number, number> = {};
  for (const size of fontSizes) {
    const rounded = Math.round(size * 10) / 10;
    counts[rounded] = (counts[rounded] || 0) + 1;
  }

  // Find the most common font size
  let maxCount = 0;
  let dominant = 12;
  for (const [size, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      dominant = parseFloat(size);
    }
  }

  return dominant;
}

/**
 * Convert PDF.js text content to structured pages format
 * This allows us to use the same processing pipeline as MuPDF
 */
export async function extractStructuredPagesFromPDFJS(
  file: File
): Promise<{ pages: StructuredPage[]; averageFontSize: number; fontBasedSuperscripts: Map<number, SuperscriptSpan[]> }> {
  const pdfjsLib = await import("pdfjs-dist");

  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const structuredPages: StructuredPage[] = [];
  const fontBasedSuperscripts = new Map<number, SuperscriptSpan[]>();
  let totalFontSize = 0;
  let fontSizeCount = 0;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();

    const textItems = textContent.items as PDFJSTextItem[];
    const styles = textContent.styles as Record<string, PDFJSStyle>;

    // Calculate dominant font size for this page
    const dominantFontSize = getDominantFontSize(textItems);

    // Detect superscript items BEFORE grouping into lines
    const pageSuperscripts = detectSuperscriptItems(textItems, dominantFontSize);
    if (pageSuperscripts.length > 0) {
      fontBasedSuperscripts.set(pageNum, pageSuperscripts);
    }

    // Group text items into lines based on Y position
    const lines = groupIntoLines(textItems, styles, viewport.height);

    // Group lines into blocks based on Y gaps
    const blocks = groupIntoBlocks(lines, viewport.height);

    // Track font sizes for average calculation
    for (const block of blocks) {
      for (const line of block.lines) {
        if (line.font.size > 0) {
          totalFontSize += line.font.size;
          fontSizeCount++;
        }
      }
    }

    const structuredPage: StructuredPage = {
      pageNumber: pageNum,
      width: viewport.width,
      height: viewport.height,
      blocks,
      rawText: "",
    };

    // Build rawText from blocks
    structuredPage.rawText = blocks
      .map((block) => block.lines.map((line) => line.text).join("\n"))
      .join("\n\n");

    structuredPages.push(structuredPage);
  }

  const averageFontSize = fontSizeCount > 0 ? totalFontSize / fontSizeCount : 12;

  return { pages: structuredPages, averageFontSize, fontBasedSuperscripts };
}

/**
 * Group text items into lines based on Y position
 */
function groupIntoLines(
  items: PDFJSTextItem[],
  styles: Record<string, PDFJSStyle>,
  pageHeight: number
): StructuredLine[] {
  if (items.length === 0) return [];

  // Sort by Y position (descending, since PDF Y is bottom-up), then by X
  const sortedItems = [...items].sort((a, b) => {
    const yDiff = b.transform[5] - a.transform[5];
    if (Math.abs(yDiff) > 3) return yDiff;
    return a.transform[4] - b.transform[4];
  });

  const lines: StructuredLine[] = [];
  let currentLine: PDFJSTextItem[] = [];
  let currentY = sortedItems[0]?.transform[5] ?? 0;

  for (const item of sortedItems) {
    const itemY = item.transform[5];

    // If Y position changed significantly, start a new line
    if (Math.abs(itemY - currentY) > 3 && currentLine.length > 0) {
      lines.push(buildLine(currentLine, styles, pageHeight));
      currentLine = [];
    }

    currentLine.push(item);
    currentY = itemY;
  }

  // Don't forget the last line
  if (currentLine.length > 0) {
    lines.push(buildLine(currentLine, styles, pageHeight));
  }

  return lines;
}

/**
 * Build a StructuredLine from a group of text items
 */
function buildLine(
  items: PDFJSTextItem[],
  styles: Record<string, PDFJSStyle>,
  pageHeight: number
): StructuredLine {
  // Sort by X position
  items.sort((a, b) => a.transform[4] - b.transform[4]);

  // Combine text with appropriate spacing
  let text = "";
  let lastX = 0;
  let lastWidth = 0;

  for (const item of items) {
    const currentX = item.transform[4];

    // Add space if there's a gap
    if (text.length > 0 && currentX - (lastX + lastWidth) > 3) {
      text += " ";
    }

    text += item.str;
    lastX = currentX;
    lastWidth = item.width;
  }

  // Calculate bounding box
  const minX = Math.min(...items.map((i) => i.transform[4]));
  const maxX = Math.max(...items.map((i) => i.transform[4] + i.width));
  const pdfY = items[0].transform[5];
  // Convert PDF Y (bottom-up) to screen Y (top-down)
  const y = pageHeight - pdfY;
  const height = Math.abs(items[0].transform[3]) || items[0].height || 12;

  const bbox: BoundingBox = {
    x: minX,
    y: y,
    w: maxX - minX,
    h: height,
  };

  // Get font info from first item
  const firstItem = items[0];
  const style = styles[firstItem.fontName] || {};
  const fontSize = Math.abs(firstItem.transform[3]) || 12;

  const font: FontInfo = {
    name: firstItem.fontName || "unknown",
    family: style.fontFamily || "serif",
    size: fontSize,
    weight: firstItem.fontName?.toLowerCase().includes("bold") ? "bold" : "normal",
    style: firstItem.fontName?.toLowerCase().includes("italic") ? "italic" : "normal",
  };

  return {
    text: text.trim(),
    bbox,
    font,
    wmode: 0,
  };
}

/**
 * Group lines into blocks based on Y gaps
 */
function groupIntoBlocks(lines: StructuredLine[], pageHeight: number): StructuredBlock[] {
  if (lines.length === 0) return [];

  // Sort lines by Y position (top to bottom)
  const sortedLines = [...lines].sort((a, b) => a.bbox.y - b.bbox.y);

  const blocks: StructuredBlock[] = [];
  let currentBlockLines: StructuredLine[] = [];
  let lastY = sortedLines[0]?.bbox.y ?? 0;
  let lastHeight = sortedLines[0]?.bbox.h ?? 12;

  for (const line of sortedLines) {
    // Skip empty lines
    if (!line.text.trim()) continue;

    const lineY = line.bbox.y;
    const gap = lineY - (lastY + lastHeight);

    // If gap is significant (more than 1.5x line height), start new block
    if (currentBlockLines.length > 0 && gap > lastHeight * 1.5) {
      blocks.push(buildBlock(currentBlockLines));
      currentBlockLines = [];
    }

    currentBlockLines.push(line);
    lastY = lineY;
    lastHeight = line.bbox.h;
  }

  // Don't forget the last block
  if (currentBlockLines.length > 0) {
    blocks.push(buildBlock(currentBlockLines));
  }

  return blocks;
}

/**
 * Build a StructuredBlock from a group of lines
 */
function buildBlock(lines: StructuredLine[]): StructuredBlock {
  const minX = Math.min(...lines.map((l) => l.bbox.x));
  const maxX = Math.max(...lines.map((l) => l.bbox.x + l.bbox.w));
  const minY = Math.min(...lines.map((l) => l.bbox.y));
  const maxY = Math.max(...lines.map((l) => l.bbox.y + l.bbox.h));

  return {
    type: "text",
    bbox: {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
    },
    lines,
  };
}
