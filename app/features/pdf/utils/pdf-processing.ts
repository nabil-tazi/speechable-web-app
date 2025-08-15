import type { ParsedPDF } from "@/app/features/pdf/types";

// Matches can be preceded by start of line, whitespace, or common punctuation
// Group 1 captures the preceding character (if any) so we can keep it in the output
function replaceLatinAbbr(text: string): string {
  const replacements: [RegExp, string, string][] = [
    [/(^|[\s\(\[\{"'“”‘’,;:])e\.g\./gi, "for example:", "For example:"],
    [/(^|[\s\(\[\{"'“”‘’,;:])i\.e\./gi, "in other words:", "In other words:"],
    [/(^|[\s\(\[\{"'“”‘’,;:])et al\./gi, "and others", "And others"],
    [/(^|[\s\(\[\{"'“”‘’,;:])ca\./gi, "approximately", "Approximately"],
  ];

  return replacements.reduce((acc, [regex, midSentence, sentenceStart]) => {
    return acc.replace(regex, (match, before) => {
      // Capitalize if at start of sentence (before is empty string or whitespace after a period)
      if (before === "" || /^[\.\?!]\s*$/.test(before)) {
        return `${before}${sentenceStart}`;
      }
      return `${before}${midSentence}`;
    });
  }, text);
}

// Text cleaning function to improve PDF text extraction
export function cleanTextContent(text: string): string {
  let cleaned = text
    // Remove excessive whitespace
    .replace(/\s+/g, " ")
    // Fix common PDF extraction issues
    .replace(/([a-z])([A-Z])/g, "$1 $2") // Add space between camelCase
    .replace(/(\w)([.!?])(\w)/g, "$1$2 $3") // Add space after punctuation
    .replace(/([a-zA-Z])(\d)/g, "$1 $2") // Add space between letters and numbers
    .replace(/(\d)([a-zA-Z])/g, "$1 $2") // Add space between numbers and letters
    // Fix hyphenated words that got split across lines
    .replace(/(\w)-\s*\n\s*(\w)/g, "$1$2")
    .replace(/\n\s*\n\s*\n/g, "\n\n");

  // Replace Latin abbreviations
  cleaned = replaceLatinAbbr(cleaned);

  cleaned = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();

  return cleaned;
}

export async function processPDFFile(file: File): Promise<ParsedPDF> {
  // Dynamic import PDF.js only when needed
  const pdfjsLib = await import("pdfjs-dist");

  // Configure worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  // Suppress PDF.js metadata warnings
  const originalWarn = console.warn;
  console.warn = (...args) => {
    const message = args[0];
    if (
      typeof message === "string" &&
      (message.includes("Warning: Bad value") ||
        message.includes("AAPL:") ||
        message.includes("Warning: Unknown"))
    ) {
      return;
    }
    originalWarn.apply(console, args);
  };

  try {
    // Convert file to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // Load PDF document
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Get metadata
    const metadata = await pdf.getMetadata();

    // Extract text from all pages with better formatting
    const pages: Array<{ pageNumber: number; text: string }> = [];
    let fullText = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Process text items with position awareness
      const textItems = textContent.items as any[];
      let pageText = "";
      let lastY = 0;
      let lastX = 0;

      for (let i = 0; i < textItems.length; i++) {
        const item = textItems[i];
        const currentY = item.transform[5]; // Y position
        const currentX = item.transform[4]; // X position

        // Check if we're on a new line (significant Y change)
        if (lastY !== 0 && Math.abs(currentY - lastY) > 5) {
          pageText += "\n";
        }
        // Check if there's a significant horizontal gap (new word/sentence)
        else if (lastX !== 0 && currentX - lastX > item.width) {
          pageText += " ";
        }

        // Clean up the text
        let cleanText = item.str;

        // Remove excessive spaces
        cleanText = cleanText.replace(/\s+/g, " ");

        // Add the text
        pageText += cleanText;

        lastY = currentY;
        lastX = currentX + item.width;
      }

      // Final cleanup for the page
      pageText = cleanTextContent(pageText);

      pages.push({
        pageNumber: pageNum,
        text: pageText,
      });

      fullText += pageText + "\n\n";
    }

    // Clean up the full text
    fullText = cleanTextContent(fullText.trim());

    return {
      text: fullText.trim(),
      numPages: pdf.numPages,
      metadata: metadata.info,
      pages,
    };
  } catch (error) {
    throw error;
  } finally {
    // Restore console.warn
    console.warn = originalWarn;
  }
}
