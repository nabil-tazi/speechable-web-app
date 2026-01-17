/**
 * Section Curation Utility
 *
 * Uses PDF outline (embedded TOC) to curate font-based detected sections.
 * Matches detected sections to outline entries and marks them as verified/unverified.
 */

import type { OutlineEntry } from "../types";
import type { DetectedSectionWithContent, CuratedSection } from "./section-detection";

/**
 * Normalize title for comparison
 * Removes invisible characters, punctuation, and normalizes whitespace
 */
function normalizeTitle(text: string): string {
  return text
    .toLowerCase()
    .trim()
    // Remove invisible/zero-width characters
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u2060\u180E]/g, '')
    // Remove punctuation
    .replace(/[.,;:!?'"()[\]{}]/g, '')
    // Remove leading numbers/bullets (e.g., "1.", "1.1", "I.", "A.")
    .replace(/^(\d+\.?\d*\.?\d*|[IVXLCDM]+\.|[A-Z]\.)\s*/i, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate match score between a detected section and an outline entry
 * Returns a score from 0 to 1
 */
function calculateMatchScore(
  section: DetectedSectionWithContent,
  outline: OutlineEntry
): number {
  let score = 0;

  const normalizedSectionTitle = normalizeTitle(section.title);
  const normalizedOutlineTitle = normalizeTitle(outline.title);

  // Title matching
  if (normalizedSectionTitle === normalizedOutlineTitle) {
    // Exact match after normalization
    score += 0.5;
  } else if (
    normalizedSectionTitle.includes(normalizedOutlineTitle) ||
    normalizedOutlineTitle.includes(normalizedSectionTitle)
  ) {
    // One contains the other
    score += 0.3;
  } else {
    // Check for significant word overlap
    const sectionWords = new Set(normalizedSectionTitle.split(' ').filter(w => w.length > 2));
    const outlineWords = new Set(normalizedOutlineTitle.split(' ').filter(w => w.length > 2));
    const overlap = [...sectionWords].filter(w => outlineWords.has(w)).length;
    const maxWords = Math.max(sectionWords.size, outlineWords.size);
    if (maxWords > 0 && overlap / maxWords >= 0.5) {
      score += 0.2;
    }
  }

  // Page proximity
  const pageDiff = Math.abs(section.pageNumber - outline.page);
  if (pageDiff === 0) {
    score += 0.3;
  } else if (pageDiff === 1) {
    score += 0.15;
  } else if (pageDiff <= 2) {
    score += 0.05;
  }

  // Level similarity (slight boost if levels match)
  if (section.level === outline.level) {
    score += 0.1;
  }

  return Math.min(score, 1);
}

/**
 * Find the best matching outline entry for a detected section
 * Returns the outline entry and match score, or null if no good match
 */
function findBestOutlineMatch(
  section: DetectedSectionWithContent,
  outlineEntries: OutlineEntry[],
  usedOutlineIndices: Set<number>,
  threshold: number = 0.5
): { entry: OutlineEntry; index: number; score: number } | null {
  let bestMatch: { entry: OutlineEntry; index: number; score: number } | null = null;

  for (let i = 0; i < outlineEntries.length; i++) {
    // Skip already-matched outline entries
    if (usedOutlineIndices.has(i)) continue;

    const entry = outlineEntries[i];
    const score = calculateMatchScore(section, entry);

    if (score >= threshold && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { entry, index: i, score };
    }
  }

  return bestMatch;
}

/**
 * Curate detected sections using PDF outline
 *
 * For each detected section:
 * - If matched to outline entry: mark as verified, use outline's title/level
 * - If not matched: mark as unverified, keep original attributes
 *
 * @param detectedSections - Sections detected via font-based heuristics
 * @param pdfOutline - Outline entries from PDF's embedded TOC
 * @returns Curated sections with verification status
 */
export function curateSectionsWithOutline(
  detectedSections: DetectedSectionWithContent[],
  pdfOutline: OutlineEntry[]
): CuratedSection[] {
  // If no outline, return all sections as unverified
  if (!pdfOutline || pdfOutline.length === 0) {
    return detectedSections.map(section => ({
      ...section,
      verified: false,
    }));
  }

  // Track which outline entries have been matched
  const usedOutlineIndices = new Set<number>();
  const curatedSections: CuratedSection[] = [];

  // Stats for logging
  let verifiedCount = 0;
  let unverifiedCount = 0;

  for (const section of detectedSections) {
    const match = findBestOutlineMatch(section, pdfOutline, usedOutlineIndices);

    if (match) {
      // Mark outline entry as used
      usedOutlineIndices.add(match.index);
      verifiedCount++;

      // Create curated section with outline data
      curatedSections.push({
        ...section,
        verified: true,
        confidence: 1.0, // Full confidence for verified sections
        // Use outline's title and level (but keep original as backup)
        title: match.entry.title,
        level: match.entry.level,
        originalTitle: section.title,
        originalLevel: section.level,
        outlineMatch: {
          outlineTitle: match.entry.title,
          outlineLevel: match.entry.level,
          outlinePage: match.entry.page,
        },
      });
    } else {
      // No match - keep as unverified
      unverifiedCount++;
      curatedSections.push({
        ...section,
        verified: false,
      });
    }
  }

  // console.log(`[SectionCuration] Curated ${detectedSections.length} sections: ${verifiedCount} verified, ${unverifiedCount} unverified`);

  return curatedSections;
}

/**
 * Filter curated sections to only include verified ones
 */
export function filterVerifiedSections(sections: CuratedSection[]): CuratedSection[] {
  return sections.filter(s => s.verified);
}

/**
 * Get curation summary for logging/debugging
 */
export function getCurationSummary(sections: CuratedSection[]): string {
  const verified = sections.filter(s => s.verified);
  const unverified = sections.filter(s => !s.verified);

  const lines: string[] = [
    `Section Curation Summary:`,
    `  Total: ${sections.length}`,
    `  Verified: ${verified.length}`,
    `  Unverified: ${unverified.length}`,
    '',
  ];

  if (verified.length > 0) {
    lines.push('Verified sections:');
    for (const s of verified) {
      lines.push(`  [L${s.level}] "${s.title}" (p.${s.pageNumber})`);
      if (s.originalTitle && s.originalTitle !== s.title) {
        lines.push(`         (was: "${s.originalTitle}")`);
      }
    }
  }

  if (unverified.length > 0) {
    lines.push('');
    lines.push('Unverified sections:');
    for (const s of unverified) {
      lines.push(`  [L${s.level}] "${s.title}" (p.${s.pageNumber}, ${Math.round(s.confidence * 100)}% conf)`);
    }
  }

  return lines.join('\n');
}
