/**
 * Anomaly expansion, highlight merging, and font range adjustment utilities.
 * Functions for processing text highlights after joining.
 */

import type { HighlightType, FontRange } from "../types";
import {
  CLUSTER_BOUNDARY_TYPES,
  CLUSTER_MEMBER_TYPES,
  CLUSTER_SHORT_THRESHOLD,
} from "./pdf-utils-common";

// ============================================================================
// TYPES
// ============================================================================

/** Map positions between original and cleaned text */
export interface PositionMap {
  /**
   * Convert a position in cleaned text to the corresponding position in original text.
   */
  toOriginal(cleanedPos: number): number;
  /**
   * Convert a position in original text to the corresponding position in cleaned text.
   */
  toClean(originalPos: number): number;
}

// ============================================================================
// ANOMALY EXPANSION
// ============================================================================

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
export function expandAnomalyHighlights(
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

// ============================================================================
// HIGHLIGHT MERGING
// ============================================================================

/**
 * Merge overlapping highlights of the same type.
 */
export function mergeOverlappingHighlights(
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
// TEXT RANGE REMOVAL
// ============================================================================

/**
 * Remove highlighted ranges from text and track position mappings.
 *
 * @param text - Original text
 * @param highlights - Highlights to remove (e.g., header, footer, page_number)
 * @returns Cleaned text and a position map
 */
export function removeHighlightedRanges(
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

// ============================================================================
// FONT RANGE ADJUSTMENT
// ============================================================================

/**
 * Adjust font ranges after removing highlighted sections from text.
 *
 * @param fontRanges - Original font ranges
 * @param removedHighlights - Highlights that were removed from text
 * @returns Adjusted font ranges with updated positions
 */
export function adjustFontRangesForRemovals(
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
      adjusted.push({
        ...fr,
        start: newStart,
        end: newEnd,
      });
    }
  }

  return adjusted;
}
