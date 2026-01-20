import type { TextHighlight, HighlightType } from "@/app/features/pdf/types";
import { REMOVABLE_HIGHLIGHT_TYPES } from "@/app/features/pdf/types";
import { detectReferences } from "@/app/features/pdf/utils/reference-detection";
import { isSentenceEnding } from "@/app/features/pdf/utils/pdf-utils-common";

/**
 * Calculate merged ranges from highlights for removal.
 * Merges overlapping highlights to avoid double-removal bugs.
 */
function getMergedRangesForRemoval(
  text: string,
  highlights: TextHighlight[] | undefined,
  typesToRemove: HighlightType[]
): Array<{ start: number; end: number }> {
  if (!highlights || highlights.length === 0) {
    return [];
  }

  const highlightsToRemove = highlights
    .filter(h => typesToRemove.includes(h.type))
    .filter(h => h.start >= 0 && h.end <= text.length && h.start < h.end)
    .sort((a, b) => a.start - b.start);

  if (highlightsToRemove.length === 0) {
    return [];
  }

  const mergedRanges: Array<{ start: number; end: number }> = [];

  for (const h of highlightsToRemove) {
    const lastRange = mergedRanges[mergedRanges.length - 1];

    if (lastRange && h.start <= lastRange.end) {
      lastRange.end = Math.max(lastRange.end, h.end);
    } else {
      mergedRanges.push({ start: h.start, end: h.end });
    }
  }

  return mergedRanges;
}

/**
 * Remove ranges from text, working from end to start to preserve positions.
 * Intelligently determines how to join the remaining text based on context:
 * - Both sentence ending + capital start → new paragraph (\n\n)
 * - Either sentence ending XOR capital start → soft break (\n)
 * - Neither → continuation (space)
 */
function removeRangesFromText(
  text: string,
  ranges: Array<{ start: number; end: number }>
): string {
  if (ranges.length === 0) return text;

  let result = text;

  // Sort by start position descending to remove from end first
  const sortedRanges = [...ranges].sort((a, b) => b.start - a.start);

  for (const range of sortedRanges) {
    const before = result.slice(0, range.start);
    const after = result.slice(range.end);

    const trimmedBefore = before.trimEnd();
    const trimmedAfter = after.trimStart();

    // Check if first part ends with sentence-ending punctuation
    // Uses isSentenceEnding which handles abbreviations like "Mr.", "et al.", etc.
    const endsWithSentence = isSentenceEnding(trimmedBefore);

    // Check if second part starts with a capital letter
    // Exclude parenthetical starts like "(ITO)" - these are not paragraph starts
    const startsWithCapital = /^[A-Z]/.test(trimmedAfter) && !trimmedAfter.startsWith('(');

    // Determine join strategy
    if (endsWithSentence && startsWithCapital) {
      // Both signals → new paragraph
      result = trimmedBefore + '\n\n' + trimmedAfter;
    } else if (endsWithSentence || startsWithCapital) {
      // One signal (ambiguous) → soft break
      result = trimmedBefore + '\n' + trimmedAfter;
    } else {
      // Neither signal → continuation
      result = trimmedBefore + ' ' + trimmedAfter;
    }
  }

  return result;
}

/**
 * Remove highlighted sections (footnotes, legends, anomalies, artifacts) from text.
 * This cleans up the text before sending to LLM APIs.
 *
 * IMPORTANT: When 'reference' is in typesToRemove, we use a two-pass approach:
 * 1. First remove all OTHER artifacts (headers, footers, etc.)
 * 2. Then detect references on the cleaned text (catches refs split by artifacts)
 * 3. Then remove the detected references
 *
 * This handles cases like "(Smith [Page 12] 2020)" where the reference pattern
 * is only visible after removing the page number artifact.
 */
export function removeHighlightedSections(
  text: string,
  highlights: TextHighlight[] | undefined,
  typesToRemove: HighlightType[] = ['footnote', 'legend', 'figure_label', 'reference', 'header', 'footer', 'page_number', 'author', 'url', 'email', 'toc', 'bibliography']
): string {
  if (!highlights || highlights.length === 0) {
    // Even with no highlights, if we're removing references, detect them on raw text
    if (typesToRemove.includes('reference')) {
      const detectedRefs = detectReferences(text);
      if (detectedRefs.length > 0) {
        let result = removeRangesFromText(text, detectedRefs);
        return result.replace(/  +/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
      }
    }
    return text;
  }

  const shouldRemoveReferences = typesToRemove.includes('reference');
  const hasExistingRefHighlights = highlights.some(h => h.type === 'reference');

  if (shouldRemoveReferences && !hasExistingRefHighlights) {
    // Two-pass approach: only when we need to DETECT references via regex
    // (no font-based reference highlights provided)

    // Pass 1: Remove all non-reference highlights
    const nonRefTypes = typesToRemove.filter(t => t !== 'reference');
    const nonRefRanges = getMergedRangesForRemoval(text, highlights, nonRefTypes);

    let cleanedText = text;
    if (nonRefRanges.length > 0) {
      cleanedText = removeRangesFromText(text, nonRefRanges);
    }

    // Pass 2: Detect references on cleaned text (catches refs that were split by artifacts)
    const detectedRefs = detectReferences(cleanedText);
    if (detectedRefs.length > 0) {
      cleanedText = removeRangesFromText(cleanedText, detectedRefs);
    }

    // Clean up whitespace
    return cleanedText.replace(/  +/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
  } else {
    // Single-pass: just remove the specified types
    const mergedRanges = getMergedRangesForRemoval(text, highlights, typesToRemove);

    if (mergedRanges.length === 0) {
      return text;
    }

    let result = removeRangesFromText(text, mergedRanges);

    // Clean up whitespace
    return result.replace(/  +/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
  }
}

/**
 * Get statistics about what was removed
 */
export function getRemovalStats(
  originalText: string,
  highlights: TextHighlight[] | undefined,
  typesToRemove: HighlightType[] = ['footnote', 'legend', 'figure_label', 'reference', 'header', 'footer', 'page_number', 'author', 'url', 'email', 'toc', 'bibliography']
): { removedCount: number; removedChars: number; removedByType: Record<string, number> } {
  if (!highlights || highlights.length === 0) {
    return { removedCount: 0, removedChars: 0, removedByType: {} };
  }

  const highlightsToRemove = highlights.filter(h => typesToRemove.includes(h.type));

  const removedByType: Record<string, number> = {};
  let removedChars = 0;

  for (const highlight of highlightsToRemove) {
    const type = highlight.type;
    const chars = highlight.end - highlight.start;
    removedByType[type] = (removedByType[type] || 0) + 1;
    removedChars += chars;
  }

  return {
    removedCount: highlightsToRemove.length,
    removedChars,
    removedByType,
  };
}

/**
 * Result of cleaning text and detecting additional references
 */
export interface CleanedTextWithReferences {
  text: string;
  referenceHighlights: Array<{ start: number; end: number; type: 'reference' }>;
}

/**
 * Remove highlighted sections and then detect references in the cleaned text.
 *
 * This is important because some references may be split across artifacts
 * (headers, footers, page numbers). After removing those artifacts, the
 * reference patterns become visible and detectable.
 *
 * Example:
 * Original: "as shown by (Smith et al.,    [Page 12]    2020)"
 * After removal: "as shown by (Smith et al., 2020)" → detected as reference
 */
export function removeHighlightsAndDetectReferences(
  text: string,
  highlights: TextHighlight[] | undefined,
  typesToRemove: HighlightType[] = ['footnote', 'legend', 'figure_label', 'header', 'footer', 'page_number', 'author', 'url', 'email', 'toc', 'bibliography']
): CleanedTextWithReferences {
  // Note: 'reference' is NOT in typesToRemove by default - we keep existing references
  // and detect NEW ones that become visible after removing artifacts

  // First, remove the highlighted sections (artifacts)
  const cleanedText = removeHighlightedSections(text, highlights, typesToRemove);

  // Then detect references in the cleaned text
  const detectedRefs = detectReferences(cleanedText);

  // Convert to TextHighlight format
  const referenceHighlights: Array<{ start: number; end: number; type: 'reference' }> =
    detectedRefs.map(ref => ({
      start: ref.start,
      end: ref.end,
      type: 'reference' as const,
    }));

  return {
    text: cleanedText,
    referenceHighlights,
  };
}

/**
 * TTS Section output - ready for text-to-speech processing
 */
export interface TTSSection {
  title: string;
  level: number;
  content: string;  // Cleaned content with all removable highlights stripped
}

/**
 * Extract verified sections with cleaned content for TTS processing.
 *
 * Simple approach that matches exactly what the UI shows:
 * 1. Clean the full text first (remove all removable highlights)
 * 2. Find section titles in the cleaned text (from section_start OR heading markers)
 * 3. Extract content between section titles
 *
 * @param fullText - The full document text (original, with highlights)
 * @param highlights - All highlights including section_start and heading markers
 * @returns Array of sections with title and cleaned content
 */
export function getTTSSections(
  fullText: string,
  highlights: TextHighlight[] | undefined
): TTSSection[] {
  if (!highlights || highlights.length === 0) {
    return [];
  }

  // Get section markers sorted by position
  // Use only 'heading' type - these are now enriched with outline metadata
  // (sectionTitle, sectionLevel, verified) when a PDF outline is available
  const sectionMarkers = highlights
    .filter(h => h.type === 'heading')
    .sort((a, b) => a.start - b.start);

  if (sectionMarkers.length === 0) {
    return [];
  }

  const sections: TTSSection[] = [];

  // Handle content BEFORE the first heading (if any)
  const firstMarker = sectionMarkers[0];
  if (firstMarker.start > 0) {
    const preHeadingContent = fullText.slice(0, firstMarker.start);

    // Get highlights that OVERLAP with pre-heading content and adjust positions
    const preHeadingHighlights = highlights
      .filter(h => h.start < firstMarker.start && h.end > 0) // Overlaps with pre-heading
      .filter(h => h.type !== 'section_start' && h.type !== 'heading')
      .map(h => ({
        ...h,
        start: Math.max(0, h.start),
        end: Math.min(preHeadingContent.length, h.end),
      }))
      .filter(h => h.start < h.end);

    // Clean the pre-heading content
    const typesToRemove = REMOVABLE_HIGHLIGHT_TYPES.filter(t => t !== 'heading');
    const cleanedPreContent = removeHighlightedSections(
      preHeadingContent,
      preHeadingHighlights,
      typesToRemove
    );

    // Only add if there's meaningful content (not just whitespace)
    if (cleanedPreContent.trim().length > 0) {
      sections.push({
        title: '', // No title for pre-heading content
        level: 1,
        content: cleanedPreContent.trim(),
      });
    }
  }

  for (let i = 0; i < sectionMarkers.length; i++) {
    const marker = sectionMarkers[i];
    const title = marker.sectionTitle || fullText.slice(marker.start, marker.end);

    // Content starts after the title, ends at next section (or end of text)
    const contentStart = marker.end;
    const contentEnd = i + 1 < sectionMarkers.length
      ? sectionMarkers[i + 1].start
      : fullText.length;

    // Extract raw content for this section
    const rawContent = fullText.slice(contentStart, contentEnd);

    // Get highlights that OVERLAP with this section's range and adjust their positions
    // Exclude the section markers themselves (heading, section_start) from removal
    // Use overlap check (not full containment) to catch bibliography/toc that span from header
    const sectionHighlights = highlights
      .filter(h => h.start < contentEnd && h.end > contentStart) // Overlaps with section
      .filter(h => h.type !== 'section_start' && h.type !== 'heading')
      .map(h => ({
        ...h,
        // Clip highlight positions to section boundaries
        start: Math.max(0, h.start - contentStart),
        end: Math.min(rawContent.length, h.end - contentStart),
      }))
      .filter(h => h.start < h.end); // Ensure valid range after clipping

    // Clean this section's content (remove anomalies, legends, etc. but not headings)
    const typesToRemove = REMOVABLE_HIGHLIGHT_TYPES.filter(t => t !== 'heading');
    const cleanedContent = removeHighlightedSections(
      rawContent,
      sectionHighlights,
      typesToRemove
    );

    sections.push({
      title,
      level: marker.sectionLevel || 1,
      content: cleanedContent.trim(),
    });
  }

  return sections;
}
