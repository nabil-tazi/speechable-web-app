/**
 * Outline Matching Utility
 *
 * Simple utility to process PDF outline entries.
 * Filters out legend entries (Fig., Table, etc.) from the outline.
 *
 * Content extraction is handled separately by font-based section detection.
 */

import type {
  OutlineEntry,
  OutlineMatch,
} from "../types";
import { isLegendOrCaption } from "./reference-detection";

/**
 * Strip invisible/zero-width Unicode characters
 */
function stripInvisibleChars(text: string): string {
  return text.replace(/[\u200B-\u200D\uFEFF\u00AD\u2060\u180E]/g, '');
}

/**
 * Check if an outline title looks like a figure/table legend
 */
function isLegendOutlineTitle(title: string): boolean {
  const cleanTitle = stripInvisibleChars(title.trim());
  return isLegendOrCaption(cleanTitle);
}

/**
 * Process PDF outline entries - filter out legends
 * Returns outline matches with legend entries marked as skipped
 */
export function matchOutlineToDocument(
  pdfOutline: OutlineEntry[],
  _structuredPages: unknown,
  _averageFontSize: number
): OutlineMatch[] {
  return pdfOutline.map(entry => {
    const isLegend = isLegendOutlineTitle(entry.title);

    return {
      outlineEntry: entry,
      matchedLine: null,
      matchedPageNumber: entry.page,
      matchedBlockIndex: -1,
      matchedLineIndex: -1,
      matchConfidence: 'high' as const,
      skipped: isLegend,
      skipReason: isLegend ? 'legend' as const : undefined,
    };
  });
}

/**
 * No content extraction - this is now handled by font-based section detection
 * Kept for API compatibility but returns empty array
 */
export function extractOutlineSectionContent(
  _matches?: unknown,
  _structuredPages?: unknown
): [] {
  return [];
}
