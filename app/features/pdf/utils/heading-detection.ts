/**
 * Document-level heading detection and validation.
 * Stage 2 of two-stage heading detection - validates and confirms headings
 * detected at block level, finds additional pattern-based headings.
 */

import type {
  StructuredPage,
  StructuredBlock,
  FontRange,
  BlockHeadingCandidate,
  OutlineEntry,
} from "../types";
import { DEBUG_HEADING, DEBUG_HEADING_PATTERNS, FontSignature, getFontSignatureKey, OUTLINE_MATCH_BONUS } from "./pdf-utils-common";
import {
  HeadingPatternType,
  extractHeadingPattern,
  isSpecialKeywordHeading,
} from "./heading-patterns";
import { calculateBodyTextSignature } from "./block-splitting";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Heading candidate from block-level (page-based) detection
 */
interface HeadingCandidate {
  pageNumber: number;
  blockIndex: number;
  lineIndex: number; // Line index within the block
  text: string;
  patternType: HeadingPatternType | "keyword";
  numbers: number[]; // e.g., [1] for "1.", [1, 2] for "1.2", [4] for "IV"
  fontSignature: FontSignature;
  level: number; // h2, h3, h4...
}

/**
 * Confirmed heading from page-based detection
 */
export interface ConfirmedHeading {
  pageNumber: number;
  blockIndex: number;
  lineIndex: number; // Line index within the block
  level: number; // 2 = h2, 3 = h3, etc.
  text: string;
  fontSignature: FontSignature; // For level hierarchy calculation
}

/**
 * Heading candidate from text-based detection
 */
interface TextHeadingCandidate {
  start: number;
  end: number;
  text: string;
  patternType: HeadingPatternType | "keyword";
  numbers: number[];
  fontSignature: FontSignature;
  level: number;
}

// ============================================================================
// SEQUENCE DETECTION HELPERS
// ============================================================================

/**
 * Check if two number sequences are consecutive.
 * Handles multi-level numbers like [1,2] → [1,3] or [1,2] → [2,1]
 */
function areNumbersConsecutive(prev: number[], curr: number[]): boolean {
  if (prev.length !== curr.length) return false;

  if (prev.length === 1) {
    // Single level: just check n → n+1
    return curr[0] === prev[0] + 1;
  }

  // Multi-level: check if same parent and child increments, OR parent increments and child resets
  const prevParent = prev.slice(0, -1);
  const currParent = curr.slice(0, -1);
  const prevChild = prev[prev.length - 1];
  const currChild = curr[curr.length - 1];

  // Same parent, child increments
  if (
    prevParent.every((v, i) => v === currParent[i]) &&
    currChild === prevChild + 1
  ) {
    return true;
  }

  // Parent increments (at some level), child resets to 1
  // e.g., [1,3] → [2,1] or [1,2,3] → [1,3,1]
  for (let i = prevParent.length - 1; i >= 0; i--) {
    if (currParent[i] === prevParent[i] + 1) {
      // All subsequent parent levels should be same or reset to 1
      const parentMatch = prevParent
        .slice(0, i)
        .every((v, j) => v === currParent[j]);
      if (parentMatch && currChild === 1) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Find consecutive sequences in a sorted array of candidates.
 * Returns groups of consecutive candidates (at least 2 in each group).
 */
function findConsecutiveGroups(
  candidates: HeadingCandidate[]
): HeadingCandidate[][] {
  if (candidates.length < 2) return [];

  // Sort by numbers
  const sorted = [...candidates].sort((a, b) => {
    for (let i = 0; i < Math.max(a.numbers.length, b.numbers.length); i++) {
      const aNum = a.numbers[i] ?? 0;
      const bNum = b.numbers[i] ?? 0;
      if (aNum !== bNum) return aNum - bNum;
    }
    return 0;
  });

  const groups: HeadingCandidate[][] = [];
  let currentGroup: HeadingCandidate[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    if (areNumbersConsecutive(prev.numbers, curr.numbers)) {
      currentGroup.push(curr);
    } else {
      // End current group if it has at least 2
      if (currentGroup.length >= 2) {
        groups.push(currentGroup);
      }
      currentGroup = [curr];
    }
  }

  // Don't forget the last group
  if (currentGroup.length >= 2) {
    groups.push(currentGroup);
  }

  return groups;
}

// ============================================================================
// FONT HIERARCHY
// ============================================================================

/**
 * Assign heading levels based on font hierarchy.
 *
 * Groups headings by font signature, sorts by visual prominence (larger size = more important),
 * and assigns levels (h2, h3, h4...) based on the hierarchy.
 *
 * The final level is the MAX of:
 * - Pattern-implied level (e.g., "2.1" implies at least h3)
 * - Font-based level (based on visual hierarchy)
 *
 * This ensures proper nesting while respecting visual styling.
 */
function assignHeadingLevelsByFontHierarchy(
  confirmedHeadings: Map<string, ConfirmedHeading>
): void {
  if (confirmedHeadings.size === 0) return;

  // Step 1: Collect unique font signatures from all headings
  const fontSignatures = new Map<string, FontSignature>();

  for (const heading of confirmedHeadings.values()) {
    const key = getFontSignatureKey(heading.fontSignature);
    if (!fontSignatures.has(key)) {
      fontSignatures.set(key, heading.fontSignature);
    }
  }

  // Step 2: Sort font signatures by visual prominence
  // Larger size = more prominent; if same size, bold > normal
  const sortedSignatures = [...fontSignatures.values()].sort((a, b) => {
    // Primary sort: larger font size first
    if (b.size !== a.size) {
      return b.size - a.size;
    }
    // Secondary sort: bold before normal
    const aWeight = a.weight === "bold" ? 1 : 0;
    const bWeight = b.weight === "bold" ? 1 : 0;
    return bWeight - aWeight;
  });

  // Step 3: Create font signature to level mapping
  // Most prominent = h2, second = h3, etc.
  const fontToLevel = new Map<string, number>();
  for (let i = 0; i < sortedSignatures.length; i++) {
    const key = getFontSignatureKey(sortedSignatures[i]);
    fontToLevel.set(key, 2 + i); // h2, h3, h4...
  }

  // Step 4: Assign levels to each heading
  for (const [key, heading] of confirmedHeadings) {
    const fontKey = getFontSignatureKey(heading.fontSignature);
    const fontBasedLevel = fontToLevel.get(fontKey) || 2;

    // Pattern-implied level is already in heading.level
    // Use MAX to ensure proper nesting (e.g., "2.1" can't be h2 even if font says so)
    const patternImpliedLevel = heading.level;
    const finalLevel = Math.max(patternImpliedLevel, fontBasedLevel);

    // Update the heading's level
    heading.level = finalLevel;
  }
}

// ============================================================================
// FONT POSITION LOOKUP
// ============================================================================

/**
 * Look up font signature at a given position in the text.
 */
function getFontAtPosition(
  position: number,
  fontRanges: FontRange[],
  debug: boolean = false
): FontSignature | null {
  if (debug) {
    console.log(`[FontLookupDebug] Looking for font at position ${position}`);
    // Show nearby font ranges
    const nearbyRanges = fontRanges.filter(
      (fr) =>
        Math.abs(fr.start - position) < 200 ||
        (position >= fr.start && position < fr.end)
    );
    console.log(`  Nearby font ranges:`);
    nearbyRanges.slice(0, 10).forEach((fr) => {
      const marker =
        position >= fr.start && position < fr.end ? " <-- MATCH" : "";
      console.log(
        `    [${fr.start}-${fr.end}]: ${fr.size}/${fr.weight}${marker}`
      );
    });
  }
  for (const fr of fontRanges) {
    if (position >= fr.start && position < fr.end) {
      return { size: fr.size, weight: fr.weight };
    }
  }
  return null;
}

/**
 * Calculate body font signature from font ranges (most common by character count).
 */
function calculateBodyFontFromRanges(fontRanges: FontRange[]): FontSignature {
  const fontCharCounts = new Map<
    string,
    { sig: FontSignature; count: number }
  >();

  for (const fr of fontRanges) {
    const key = `${fr.size}|${fr.weight}`;
    const charCount = fr.end - fr.start;
    const existing = fontCharCounts.get(key);
    if (existing) {
      existing.count += charCount;
    } else {
      fontCharCounts.set(key, {
        sig: { size: fr.size, weight: fr.weight },
        count: charCount,
      });
    }
  }

  let maxCount = 0;
  let bodySig: FontSignature = { size: 12, weight: "normal" };

  for (const { sig, count } of fontCharCounts.values()) {
    if (count > maxCount) {
      maxCount = count;
      bodySig = sig;
    }
  }

  return bodySig;
}

// ============================================================================
// EXCLUSION RANGE CHECKS
// ============================================================================

/**
 * Check if a position falls within any of the exclude ranges.
 */
function isInExcludeRanges(
  position: number,
  excludeRanges: Array<{ start: number; end: number }>
): boolean {
  for (const range of excludeRanges) {
    if (position >= range.start && position < range.end) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// OUTLINE MATCHING
// ============================================================================

/**
 * Result of matching a heading to a PDF outline entry.
 */
export interface OutlineMatchResult {
  outlineEntry: OutlineEntry;
  matchConfidence: 'high' | 'medium';
}

/**
 * Normalize text for fuzzy comparison:
 * - Lowercase
 * - Remove leading numbers/punctuation (e.g., "2. Methods" → "methods")
 * - Trim whitespace
 */
function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[\d.\s\-–—:]+/, '') // Remove leading numbers, dots, spaces, dashes
    .replace(/[^\w\s]/g, '')       // Remove punctuation
    .trim();
}

/**
 * Check if an outline title matches a detected heading text.
 *
 * Matching strategies:
 * 1. Exact match (after normalization)
 * 2. Outline title is a suffix of detected text (e.g., "Methods" in "2. Methods")
 * 3. Detected text contains outline title as a word boundary match
 */
function titlesMatch(outlineTitle: string, detectedText: string): boolean {
  const normalizedOutline = normalizeForMatching(outlineTitle);
  const normalizedDetected = normalizeForMatching(detectedText);

  if (!normalizedOutline || !normalizedDetected) return false;

  // Exact match after normalization
  if (normalizedOutline === normalizedDetected) {
    return true;
  }

  // Outline title is contained in detected text (word boundary)
  // This handles "Methods" matching "2. Methods" or "Chapter 2: Methods"
  const outlineWords = normalizedOutline.split(/\s+/);
  const detectedWords = normalizedDetected.split(/\s+/);

  // Check if all outline words appear consecutively in detected text
  for (let i = 0; i <= detectedWords.length - outlineWords.length; i++) {
    let allMatch = true;
    for (let j = 0; j < outlineWords.length; j++) {
      if (detectedWords[i + j] !== outlineWords[j]) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return true;
  }

  return false;
}

/**
 * Get the page number for a text position given page break positions.
 * Page breaks array contains the character offset where each page starts.
 * Returns 0-indexed page number.
 */
function getPageForPosition(position: number, pageBreakPositions: number[]): number {
  if (pageBreakPositions.length === 0) return 0;

  for (let i = pageBreakPositions.length - 1; i >= 0; i--) {
    if (position >= pageBreakPositions[i]) {
      return i + 1; // Page numbers start at 1, but array is 0-indexed for breaks
    }
  }
  return 0;
}

/**
 * Match a heading candidate to a PDF outline entry.
 *
 * Uses fuzzy title matching with page number as tiebreaker when multiple
 * outline entries could match.
 *
 * @param headingText - The detected heading text
 * @param headingPosition - Character position in document
 * @param outlineEntries - PDF outline entries
 * @param pageBreakPositions - Character positions where pages break
 * @returns The matched outline entry or null
 */
export function matchHeadingToOutline(
  headingText: string,
  headingPosition: number,
  outlineEntries: OutlineEntry[],
  pageBreakPositions: number[] = []
): OutlineMatchResult | null {
  if (outlineEntries.length === 0) return null;

  // Find all outline entries that match the title
  const matches: Array<{ entry: OutlineEntry; confidence: 'high' | 'medium' }> = [];

  for (const entry of outlineEntries) {
    if (titlesMatch(entry.title, headingText)) {
      // Determine confidence based on how good the match is
      const normalizedOutline = normalizeForMatching(entry.title);
      const normalizedDetected = normalizeForMatching(headingText);

      const confidence = normalizedOutline === normalizedDetected ? 'high' : 'medium';
      matches.push({ entry, confidence });
    }
  }

  if (matches.length === 0) return null;

  if (matches.length === 1) {
    return {
      outlineEntry: matches[0].entry,
      matchConfidence: matches[0].confidence,
    };
  }

  // Multiple matches - use page number as tiebreaker
  const headingPage = getPageForPosition(headingPosition, pageBreakPositions);

  // Sort by page distance (closer = better), then by confidence
  matches.sort((a, b) => {
    const pageDistA = Math.abs(a.entry.page - headingPage);
    const pageDistB = Math.abs(b.entry.page - headingPage);

    if (pageDistA !== pageDistB) return pageDistA - pageDistB;

    // Same page distance - prefer high confidence
    if (a.confidence !== b.confidence) {
      return a.confidence === 'high' ? -1 : 1;
    }

    return 0;
  });

  return {
    outlineEntry: matches[0].entry,
    matchConfidence: matches[0].confidence,
  };
}

// ============================================================================
// TEXT-BASED HEADING DETECTION
// ============================================================================

/**
 * Heading highlight with optional outline enrichment.
 */
export interface HeadingHighlight {
  start: number;
  end: number;
  type: "heading";
  sectionLevel: number;
  sectionTitle?: string;   // The detected heading text (for TTS)
  verified?: boolean;      // True if matched to PDF outline entry
}

/**
 * Detect sequential headings from joined text and font ranges.
 * This is the text-based version that works after page joining.
 *
 * Two-stage detection:
 * - Stage 1 (block-level): Block candidates from `heading-scoring.ts` passed in
 * - Stage 2 (this function): Pattern-based validation and additional detection
 *
 * When a PDF outline is provided, headings that match outline entries receive
 * a score bonus and are enriched with outline metadata (level, verified flag).
 *
 * @param text - The joined document text
 * @param fontRanges - Font information for text ranges
 * @param excludeRanges - Ranges to exclude (TOC, bibliography)
 * @param blockHeadingCandidates - Stage 1 heading candidates from block-level detection
 * @param pdfOutline - Optional PDF outline entries for enrichment
 * @param pageBreakPositions - Character positions where pages start (for outline page matching)
 * @returns Array of heading highlights
 */
export function detectHeadingsFromText(
  text: string,
  fontRanges: FontRange[],
  excludeRanges: Array<{ start: number; end: number }> = [],
  blockHeadingCandidates: BlockHeadingCandidate[] = [],
  pdfOutline: OutlineEntry[] = [],
  pageBreakPositions: number[] = []
): HeadingHighlight[] {
  if (fontRanges.length === 0 && blockHeadingCandidates.length === 0) {
    return [];
  }

  // Step 0: Process Stage 1 heading candidates
  // These already passed the scoring threshold, so we accept them directly
  // (filtering out any in excluded ranges)
  // When outline is available, we match and enrich with outline metadata
  const candidateHeadings: HeadingHighlight[] = [];

  // Log all heading candidates with their scores
  if (blockHeadingCandidates.length > 0) {
    console.log(`[detectHeadingsFromText] Processing ${blockHeadingCandidates.length} heading candidates:`);
    for (const c of blockHeadingCandidates) {
      const excluded = isInExcludeRanges(c.textStart, excludeRanges);
      const excludedTag = excluded ? ' [EXCLUDED]' : '';
      console.log(`  [Candidate] score=${c.score} pos=${c.textStart}-${c.textEnd}${excludedTag} text="${c.text.slice(0, 50)}${c.text.length > 50 ? '...' : ''}"`);
      console.log(`    factors: [${c.factors.join(', ')}]`);
    }
  }

  for (const candidate of blockHeadingCandidates) {
    // Skip if in excluded range
    if (isInExcludeRanges(candidate.textStart, excludeRanges)) {
      continue;
    }

    // Check for outline match
    const outlineMatch = pdfOutline.length > 0
      ? matchHeadingToOutline(candidate.text, candidate.textStart, pdfOutline, pageBreakPositions)
      : null;

    // Debug logging for target pattern
    if (
      DEBUG_HEADING &&
      DEBUG_HEADING_PATTERNS.some(p => p && candidate.text.toLowerCase().includes(p.toLowerCase()))
    ) {
      console.log(
        `[HeadingFromCandidate] "${candidate.text.slice(0, 50)}..." score=${
          candidate.score
        } factors=[${candidate.factors.join(", ")}]`
      );
      if (outlineMatch) {
        console.log(
          `  -> Matched outline: "${outlineMatch.outlineEntry.title}" level=${outlineMatch.outlineEntry.level} confidence=${outlineMatch.matchConfidence}`
        );
      }
    }

    // Determine level: prefer outline level if matched, else use font-based heuristic
    const fontBasedLevel = candidate.fontSize >= 14 ? 2 : 3;
    const level = outlineMatch ? outlineMatch.outlineEntry.level : fontBasedLevel;

    candidateHeadings.push({
      start: candidate.textStart,
      end: candidate.textEnd,
      type: "heading",
      sectionLevel: level,
      sectionTitle: candidate.text,
      verified: outlineMatch !== null,
    });
  }

  if (fontRanges.length === 0) {
    return candidateHeadings;
  }

  // Step 1: Calculate body font signature
  const bodySignature = calculateBodyFontFromRanges(fontRanges);
  const bodySignatureKey = getFontSignatureKey(bodySignature);

  // Step 2: Scan text line by line for heading patterns
  const candidates: TextHeadingCandidate[] = [];
  const lines = text.split("\n");
  let currentOffset = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Debug: Check if this line matches our target pattern
    const shouldDebugHeading =
      DEBUG_HEADING &&
      DEBUG_HEADING_PATTERNS.some(p => p && trimmedLine.toLowerCase().includes(p.toLowerCase()));

    if (trimmedLine && trimmedLine.length <= 150) {
      // Check if line is in excluded range
      const isExcluded = isInExcludeRanges(currentOffset, excludeRanges);

      if (shouldDebugHeading) {
        console.log(`[HeadingDebug] Line: "${trimmedLine.slice(0, 60)}..."`);
        console.log(
          `  length: ${trimmedLine.length}, isExcluded: ${isExcluded}`
        );
      }

      if (!isExcluded) {
        // Check for heading pattern
        const pattern = extractHeadingPattern(trimmedLine);
        const isKeyword = !pattern && isSpecialKeywordHeading(trimmedLine);

        if (shouldDebugHeading) {
          console.log(
            `  pattern: ${
              pattern ? JSON.stringify(pattern) : "null"
            }, isKeyword: ${isKeyword}`
          );
        }

        if (pattern || isKeyword) {
          // Look up font at this position
          const font = getFontAtPosition(
            currentOffset,
            fontRanges,
            shouldDebugHeading
          );

          if (shouldDebugHeading) {
            console.log(`  font: ${font ? JSON.stringify(font) : "null"}`);
            console.log(`  bodySignature: ${bodySignatureKey}`);
            console.log(`  currentOffset: ${currentOffset}`);
            // Show the actual character at the offset and surrounding text
            const charAtOffset = text.charAt(currentOffset);
            const surroundingText = text.slice(
              Math.max(0, currentOffset - 5),
              currentOffset + 10
            );
            console.log(
              `  charAtOffset: "${charAtOffset}" (code: ${charAtOffset.charCodeAt(
                0
              )})`
            );
            console.log(
              `  surroundingText: "${surroundingText.replace(/\n/g, "\\n")}"`
            );
          }

          if (font) {
            const fontKey = getFontSignatureKey(font);

            if (shouldDebugHeading) {
              console.log(
                `  fontKey: ${fontKey}, matches body: ${
                  fontKey === bodySignatureKey
                }`
              );
            }

            // Only add if font differs from body text
            if (fontKey !== bodySignatureKey) {
              const lineStart =
                currentOffset + (line.length - line.trimStart().length);
              const lineEnd = currentOffset + line.trimEnd().length;

              candidates.push({
                start: lineStart,
                end: lineEnd,
                text: trimmedLine,
                patternType: pattern?.type || "keyword",
                numbers: pattern?.numbers || [],
                fontSignature: font,
                level: pattern?.level || 2,
              });

              if (shouldDebugHeading) {
                console.log(`  -> ADDED as candidate`);
              }
            } else if (shouldDebugHeading) {
              console.log(`  -> REJECTED: font matches body text`);
            }
          }
        } else if (shouldDebugHeading) {
          console.log(`  -> REJECTED: no pattern or keyword match`);
        }
      }
    } else if (shouldDebugHeading) {
      console.log(`[HeadingDebug] Line: "${trimmedLine.slice(0, 60)}..."`);
      console.log(
        `  -> REJECTED: empty or too long (${trimmedLine.length} chars)`
      );
    }

    currentOffset += line.length + 1; // +1 for the newline
  }

  if (candidates.length === 0) {
    return candidateHeadings;
  }

  // Step 3: Group candidates by (patternType, fontSignature)
  const groupedCandidates = new Map<string, TextHeadingCandidate[]>();

  for (const candidate of candidates) {
    const groupKey = `${candidate.patternType}|${getFontSignatureKey(
      candidate.fontSignature
    )}`;
    const group = groupedCandidates.get(groupKey) || [];
    group.push(candidate);
    groupedCandidates.set(groupKey, group);
  }

  // Step 4: Find consecutive sequences in each group
  const confirmedHeadings: TextHeadingCandidate[] = [];

  for (const [, group] of groupedCandidates) {
    // Sort by position
    group.sort((a, b) => a.start - b.start);

    // Find consecutive number sequences
    let sequenceStart = 0;
    for (let i = 1; i <= group.length; i++) {
      const isEnd = i === group.length;
      const isConsecutive =
        !isEnd &&
        group[i].numbers.length > 0 &&
        group[i - 1].numbers.length > 0 &&
        areNumbersConsecutive(group[i - 1].numbers, group[i].numbers);

      if (isEnd || !isConsecutive) {
        // Check sequence length (at least 2 for consecutive patterns)
        const sequenceLength = i - sequenceStart;
        if (
          sequenceLength >= 2 ||
          group[sequenceStart].patternType === "keyword"
        ) {
          // Add all candidates in this sequence
          for (let j = sequenceStart; j < i; j++) {
            confirmedHeadings.push(group[j]);
          }
        }
        sequenceStart = i;
      }
    }
  }

  // Step 5: Position-based fallback - detect dense heading clusters
  // If we have 10+ headings in first 15% of doc → likely TOC, exclude them
  // If we have 10+ headings in last 20% of doc → likely bibliography, exclude them
  const textLength = text.length;
  const tocThreshold = textLength * 0.15;
  const bibThreshold = textLength * 0.8;

  const headingsInTOCZone = confirmedHeadings.filter(
    (h) => h.start < tocThreshold
  );
  const headingsInBibZone = confirmedHeadings.filter(
    (h) => h.start > bibThreshold
  );

  let filteredHeadings = confirmedHeadings;

  if (headingsInTOCZone.length >= 10) {
    // Dense cluster at start - likely TOC, exclude them
    filteredHeadings = filteredHeadings.filter((h) => h.start >= tocThreshold);
  }

  if (headingsInBibZone.length >= 10) {
    // Dense cluster at end - likely bibliography, exclude them
    filteredHeadings = filteredHeadings.filter((h) => h.start <= bibThreshold);
  }

  // Step 6: Assign final levels based on font hierarchy
  const fontToLevel = new Map<string, number>();
  const uniqueFonts = [
    ...new Set(
      filteredHeadings.map((h) => getFontSignatureKey(h.fontSignature))
    ),
  ];

  // Sort by font size (larger = more prominent = lower level number)
  const sortedFonts = uniqueFonts
    .map((key) => {
      const parts = key.split("|");
      return { key, size: parseFloat(parts[0]), weight: parts[1] };
    })
    .sort((a, b) => {
      if (b.size !== a.size) return b.size - a.size;
      return (b.weight === "bold" ? 1 : 0) - (a.weight === "bold" ? 1 : 0);
    });

  sortedFonts.forEach((font, index) => {
    fontToLevel.set(font.key, 2 + index); // h2, h3, h4, ...
  });

  // Step 7: Convert to HeadingHighlight format with outline enrichment
  const patternHeadings: HeadingHighlight[] = filteredHeadings.map((h) => {
    const fontKey = getFontSignatureKey(h.fontSignature);
    const fontLevel = fontToLevel.get(fontKey) || 2;

    // Check for outline match
    const outlineMatch = pdfOutline.length > 0
      ? matchHeadingToOutline(h.text, h.start, pdfOutline, pageBreakPositions)
      : null;

    // Use outline level if matched, otherwise use max of pattern and font level
    const finalLevel = outlineMatch
      ? outlineMatch.outlineEntry.level
      : Math.max(h.level, fontLevel);

    return {
      start: h.start,
      end: h.end,
      type: "heading" as const,
      sectionLevel: finalLevel,
      sectionTitle: h.text,
      verified: outlineMatch !== null,
    };
  });

  // Step 8: Merge candidate headings (Stage 1) with pattern-based headings
  // Avoid duplicates by checking for position overlap
  const allHeadings: HeadingHighlight[] = [...patternHeadings];

  for (const candidate of candidateHeadings) {
    // Check if this candidate overlaps with any existing pattern-based heading
    const overlaps = patternHeadings.some(
      (h) =>
        (candidate.start >= h.start && candidate.start < h.end) ||
        (candidate.end > h.start && candidate.end <= h.end) ||
        (candidate.start <= h.start && candidate.end >= h.end)
    );

    if (!overlaps) {
      allHeadings.push(candidate);
    }
  }

  // Sort by position
  allHeadings.sort((a, b) => a.start - b.start);

  // Log detected headings
  if (allHeadings.length > 0) {
    console.log(`[detectHeadingsFromText] Found ${allHeadings.length} headings (outline: ${pdfOutline.length} entries):`);
    for (const h of allHeadings) {
      const verifiedTag = h.verified ? ' [VERIFIED]' : '';
      console.log(`  [Heading] pos=${h.start}-${h.end} level=${h.sectionLevel}${verifiedTag} text="${h.sectionTitle?.slice(0, 50) || ''}${(h.sectionTitle?.length || 0) > 50 ? '...' : ''}"`);
    }
  }

  return allHeadings;
}

// ============================================================================
// PAGE-BASED HEADING DETECTION (LEGACY)
// ============================================================================

/**
 * Detect sequential headings across the entire document.
 * Returns a map of (pageNumber, blockIndex, lineIndex) → heading level.
 * @deprecated Use detectHeadingsFromText for new code
 */
export function detectSequentialHeadings(
  pages: StructuredPage[]
): Map<string, ConfirmedHeading> {
  const confirmedHeadings = new Map<string, ConfirmedHeading>();

  if (pages.length === 0) return confirmedHeadings;

  // Step 1: Calculate body text signature
  const bodySignature = calculateBodyTextSignature(pages);
  const bodySignatureKey = getFontSignatureKey(bodySignature);

  // Step 2: Collect all heading candidates
  const candidates: HeadingCandidate[] = [];
  const keywordCandidates: HeadingCandidate[] = [];

  // Pattern for standalone numbers: "1", "2", "1.", "2.", "1.1", "1.1.", etc.
  const STANDALONE_NUMBER_PATTERN = /^(\d+(?:\.\d+)*)\.?$/;

  for (const page of pages) {
    for (let blockIndex = 0; blockIndex < page.blocks.length; blockIndex++) {
      const block = page.blocks[blockIndex];

      // Check EACH LINE individually for heading patterns (handles headings buried in large blocks)
      for (let li = 0; li < block.lines.length; li++) {
        const line = block.lines[li];
        const lineText = line.text.trim();

        if (!lineText || lineText.length > 150) continue; // Skip empty or too-long lines

        // Check for standalone number that might need merging with next line
        const standaloneMatch = lineText.match(STANDALONE_NUMBER_PATTERN);
        if (standaloneMatch && li + 1 < block.lines.length) {
          const nextLine = block.lines[li + 1];
          const nextLineText = nextLine.text.trim();

          // Check if they're on the same visual line (Y positions within 2pt tolerance)
          const sameY = Math.abs(line.bbox.y - nextLine.bbox.y) < 2;

          // Check if they have the same font
          const lineFontSig = {
            size: Math.round(line.font.size * 10) / 10,
            weight: line.font.weight,
          };
          const nextFontSig = {
            size: Math.round(nextLine.font.size * 10) / 10,
            weight: nextLine.font.weight,
          };
          const sameFont =
            getFontSignatureKey(lineFontSig) ===
            getFontSignatureKey(nextFontSig);

          if (sameY && sameFont && nextLineText && nextLineText.length < 100) {
            // Merge into a combined heading
            const combinedText = `${lineText} ${nextLineText}`;
            const combinedPattern = extractHeadingPattern(combinedText);

            if (combinedPattern) {
              const fontKey = getFontSignatureKey(lineFontSig);

              if (fontKey !== bodySignatureKey) {
                candidates.push({
                  pageNumber: page.pageNumber,
                  blockIndex,
                  lineIndex: li,
                  text: combinedText,
                  patternType: combinedPattern.type,
                  numbers: combinedPattern.numbers,
                  fontSignature: lineFontSig,
                  level: combinedPattern.level,
                });
                // Skip the next line since we merged it
                li++;
                continue;
              }
            }
          }
        }

        const linePattern = extractHeadingPattern(lineText);
        if (linePattern) {
          const lineFontSig = {
            size: Math.round(line.font.size * 10) / 10,
            weight: line.font.weight,
          };
          // Only add if font differs from body text (likely a heading)
          const lineFontKey = getFontSignatureKey(lineFontSig);

          if (lineFontKey !== bodySignatureKey) {
            candidates.push({
              pageNumber: page.pageNumber,
              blockIndex,
              lineIndex: li,
              text: lineText,
              patternType: linePattern.type,
              numbers: linePattern.numbers,
              fontSignature: lineFontSig,
              level: linePattern.level,
            });
          }
        }

        // Also check for keyword headings at line level
        if (isSpecialKeywordHeading(lineText)) {
          const lineFontSig = {
            size: Math.round(line.font.size * 10) / 10,
            weight: line.font.weight,
          };
          const lineFontKey = getFontSignatureKey(lineFontSig);
          if (lineFontKey !== bodySignatureKey) {
            keywordCandidates.push({
              pageNumber: page.pageNumber,
              blockIndex,
              lineIndex: li,
              text: lineText,
              patternType: "keyword",
              numbers: [],
              fontSignature: lineFontSig,
              level: 2,
            });
          }
        }
      }
    }
  }

  // Step 3: Group candidates by (patternType, fontSignature)
  const groupedCandidates = new Map<string, HeadingCandidate[]>();

  for (const candidate of candidates) {
    const groupKey = `${candidate.patternType}|${getFontSignatureKey(
      candidate.fontSignature
    )}`;
    const group = groupedCandidates.get(groupKey) || [];
    group.push(candidate);
    groupedCandidates.set(groupKey, group);
  }

  // Step 4: Validate each group
  for (const [groupKey, group] of groupedCandidates) {
    // Check if font differs from body text
    const fontKey = groupKey.split("|").slice(1).join("|");
    if (fontKey === bodySignatureKey) {
      continue; // Same font as body text, skip
    }

    // Find consecutive sequences
    const consecutiveGroups = findConsecutiveGroups(group);

    // Mark all candidates in consecutive groups as confirmed headings
    for (const consecutiveGroup of consecutiveGroups) {
      for (const candidate of consecutiveGroup) {
        const key = `${candidate.pageNumber}|${candidate.blockIndex}|${candidate.lineIndex}`;
        confirmedHeadings.set(key, {
          pageNumber: candidate.pageNumber,
          blockIndex: candidate.blockIndex,
          lineIndex: candidate.lineIndex,
          level: candidate.level,
          text: candidate.text,
          fontSignature: candidate.fontSignature,
        });
      }
    }
  }

  // Step 5: Handle special keywords (must have different font from body)
  for (const candidate of keywordCandidates) {
    const fontKey = getFontSignatureKey(candidate.fontSignature);
    if (fontKey !== bodySignatureKey) {
      const key = `${candidate.pageNumber}|${candidate.blockIndex}|${candidate.lineIndex}`;
      confirmedHeadings.set(key, {
        pageNumber: candidate.pageNumber,
        blockIndex: candidate.blockIndex,
        lineIndex: candidate.lineIndex,
        level: candidate.level,
        text: candidate.text,
        fontSignature: candidate.fontSignature,
      });
    }
  }

  // Step 6: Assign heading levels based on font hierarchy
  assignHeadingLevelsByFontHierarchy(confirmedHeadings);

  return confirmedHeadings;
}
