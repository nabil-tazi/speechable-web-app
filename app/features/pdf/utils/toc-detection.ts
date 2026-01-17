/**
 * Table of Contents (TOC) Detection Module
 *
 * Detects in-document table of contents by accumulating TOC entry candidates
 * and clustering them to identify the TOC section.
 */

import type { StructuredPage } from "../types";

// ===== TYPES =====

export interface TOCCandidate {
  text: string;
  pageNumber: number | null;  // The page number referenced in the TOC entry
  confidence: number;
  offset: { start: number; end: number };
  lineText: string;  // Original line text for debugging
}

export interface TOCDetectionResult {
  hasTOC: boolean;
  tocStartOffset: number;
  tocEndOffset: number;
  candidates: TOCCandidate[];
  headerOffset: { start: number; end: number } | null;
}

// ===== PATTERNS =====

// TOC header patterns
const TOC_HEADER_PATTERNS = [
  /^contents?\s*$/i,
  /^table\s+of\s+contents?\s*$/i,
  /^toc\s*$/i,
  /^sommaire\s*$/i,  // French
  /^index\s*$/i,
  /^inhalt(?:sverzeichnis)?\s*$/i,  // German
];

// TOC entry patterns - title followed by page number
// Pattern 1: Title with leader dots and page number
const LEADER_DOT_PATTERN = /^(.+?)[.\s\u2026\u00B7\t]{3,}(\d{1,4})\s*$/;

// Pattern 2: Title with spaces/tabs and page number at end
const SPACED_PATTERN = /^(.+?)\s{2,}(\d{1,4})\s*$/;

// Pattern 3: Numbered chapter/section with page number
const NUMBERED_ENTRY_PATTERN = /^(\d+\.?\s+|[IVXLCDM]+\.?\s+|[A-Z]\.\s+|Chapter\s+\d+\.?\s*|Section\s+\d+\.?\s*|Part\s+[IVXLCDM\d]+\.?\s*)(.+?)\s+(\d{1,4})\s*$/i;

// Pattern 4: Simple line ending with page number (looser match)
const ENDS_WITH_NUMBER_PATTERN = /^(.{5,}?)\s+(\d{1,4})\s*$/;

// ===== CANDIDATE DETECTION =====

/**
 * Calculate confidence score for a potential TOC entry
 */
function calculateTOCEntryConfidence(
  line: string,
  pageNum: number | null,
  hasLeaderDots: boolean,
  hasNumbering: boolean,
  documentPosition: number  // 0-1, position in document
): number {
  let confidence = 0;

  // Base confidence for having a page number
  if (pageNum !== null) {
    confidence += 0.4;

    // Page numbers should be reasonable (1-999)
    if (pageNum >= 1 && pageNum <= 999) {
      confidence += 0.1;
    }
  }

  // Leader dots are a strong signal
  if (hasLeaderDots) {
    confidence += 0.3;
  }

  // Numbering at start (1., Chapter 1, etc.)
  if (hasNumbering) {
    confidence += 0.2;
  }

  // Short text is more likely TOC entry
  if (line.length < 80) {
    confidence += 0.1;
  }
  if (line.length < 50) {
    confidence += 0.1;
  }

  // TOC typically in first 10% of document
  if (documentPosition < 0.1) {
    confidence += 0.2;
  } else if (documentPosition < 0.2) {
    confidence += 0.1;
  }

  // Penalty for very long lines (probably not TOC)
  if (line.length > 120) {
    confidence -= 0.2;
  }

  // Penalty for lines that look like sentences
  if (/[.!?]\s*$/.test(line) && !/\.\s*\d+\s*$/.test(line)) {
    confidence -= 0.15;
  }

  return Math.max(0, Math.min(1, confidence));
}

/**
 * Try to extract TOC entry information from a line
 */
function extractTOCEntry(line: string): { title: string; pageNum: number; hasLeaderDots: boolean; hasNumbering: boolean } | null {
  const trimmed = line.trim();

  // Skip empty or very short lines
  if (trimmed.length < 3) return null;

  // Try leader dot pattern first (strongest signal)
  let match = trimmed.match(LEADER_DOT_PATTERN);
  if (match) {
    return {
      title: match[1].trim(),
      pageNum: parseInt(match[2], 10),
      hasLeaderDots: true,
      hasNumbering: /^(\d+\.?\s+|[IVXLCDM]+\.?\s+|[A-Z]\.\s+)/i.test(match[1])
    };
  }

  // Try numbered entry pattern
  match = trimmed.match(NUMBERED_ENTRY_PATTERN);
  if (match) {
    return {
      title: (match[1] + match[2]).trim(),
      pageNum: parseInt(match[3], 10),
      hasLeaderDots: false,
      hasNumbering: true
    };
  }

  // Try spaced pattern
  match = trimmed.match(SPACED_PATTERN);
  if (match) {
    return {
      title: match[1].trim(),
      pageNum: parseInt(match[2], 10),
      hasLeaderDots: false,
      hasNumbering: /^(\d+\.?\s+|[IVXLCDM]+\.?\s+|[A-Z]\.\s+)/i.test(match[1])
    };
  }

  // Try simple ends-with-number pattern (lowest confidence)
  match = trimmed.match(ENDS_WITH_NUMBER_PATTERN);
  if (match) {
    // Additional validation: title should look reasonable
    const title = match[1].trim();
    // Skip if title looks like a sentence or has too many words
    const wordCount = title.split(/\s+/).length;
    if (wordCount <= 8 && !/[.!?]$/.test(title)) {
      return {
        title,
        pageNum: parseInt(match[2], 10),
        hasLeaderDots: false,
        hasNumbering: /^(\d+\.?\s+|[IVXLCDM]+\.?\s+|[A-Z]\.\s+)/i.test(title)
      };
    }
  }

  return null;
}

/**
 * Check if a line is a TOC header
 */
function isTOCHeader(line: string): boolean {
  const trimmed = line.trim();
  return TOC_HEADER_PATTERNS.some(pattern => pattern.test(trimmed));
}

// ===== CLUSTERING =====

/**
 * Find clusters of TOC candidates
 */
function clusterCandidates(
  candidates: TOCCandidate[],
  fullTextLength: number
): { start: number; end: number; candidates: TOCCandidate[]; avgConfidence: number }[] {
  if (candidates.length === 0) return [];

  // Sort by offset
  const sorted = [...candidates].sort((a, b) => a.offset.start - b.offset.start);

  const clusters: { start: number; end: number; candidates: TOCCandidate[]; avgConfidence: number }[] = [];
  let currentCluster: TOCCandidate[] = [sorted[0]];

  // Maximum gap between candidates to be in same cluster (as fraction of document)
  const maxGapFraction = 0.02;  // 2% of document
  const maxGap = Math.max(500, fullTextLength * maxGapFraction);

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].offset.start - sorted[i - 1].offset.end;

    if (gap <= maxGap) {
      currentCluster.push(sorted[i]);
    } else {
      // Save current cluster if it has enough candidates
      if (currentCluster.length >= 3) {
        const avgConf = currentCluster.reduce((sum, c) => sum + c.confidence, 0) / currentCluster.length;
        clusters.push({
          start: currentCluster[0].offset.start,
          end: currentCluster[currentCluster.length - 1].offset.end,
          candidates: currentCluster,
          avgConfidence: avgConf
        });
      }
      currentCluster = [sorted[i]];
    }
  }

  // Don't forget the last cluster
  if (currentCluster.length >= 3) {
    const avgConf = currentCluster.reduce((sum, c) => sum + c.confidence, 0) / currentCluster.length;
    clusters.push({
      start: currentCluster[0].offset.start,
      end: currentCluster[currentCluster.length - 1].offset.end,
      candidates: currentCluster,
      avgConfidence: avgConf
    });
  }

  return clusters;
}

/**
 * Validate page number sequence in a cluster
 * TOC page numbers should generally be increasing
 */
function validatePageSequence(candidates: TOCCandidate[]): boolean {
  const pageNums = candidates
    .filter(c => c.pageNumber !== null)
    .map(c => c.pageNumber as number);

  if (pageNums.length < 3) return false;

  // Count how many times the sequence increases
  let increases = 0;
  let decreases = 0;

  for (let i = 1; i < pageNums.length; i++) {
    if (pageNums[i] > pageNums[i - 1]) increases++;
    if (pageNums[i] < pageNums[i - 1]) decreases++;
  }

  // Sequence should be mostly increasing (allow some decreases for sub-sections)
  return increases >= decreases && increases >= pageNums.length * 0.5;
}

// ===== MAIN DETECTION FUNCTION =====

/**
 * Detect Table of Contents in the document
 */
export function detectTOC(
  fullText: string,
  pages: StructuredPage[]
): TOCDetectionResult {
  const result: TOCDetectionResult = {
    hasTOC: false,
    tocStartOffset: 0,
    tocEndOffset: 0,
    candidates: [],
    headerOffset: null
  };

  if (!fullText || fullText.length === 0) return result;

  const textLength = fullText.length;
  const lines = fullText.split('\n');

  let currentOffset = 0;
  let headerOffset: { start: number; end: number } | null = null;
  const candidates: TOCCandidate[] = [];

  // Process lines to find TOC header and candidates
  for (const line of lines) {
    const lineStart = currentOffset;
    const lineEnd = currentOffset + line.length;
    const documentPosition = lineStart / textLength;

    // Only look in first 25% of document for TOC
    if (documentPosition > 0.25) {
      currentOffset = lineEnd + 1;  // +1 for newline
      continue;
    }

    // Check for TOC header
    if (!headerOffset && isTOCHeader(line)) {
      headerOffset = { start: lineStart, end: lineEnd };
    }

    // Check for TOC entry
    const entry = extractTOCEntry(line);
    if (entry) {
      const confidence = calculateTOCEntryConfidence(
        line,
        entry.pageNum,
        entry.hasLeaderDots,
        entry.hasNumbering,
        documentPosition
      );

      if (confidence >= 0.3) {  // Minimum threshold for candidate
        candidates.push({
          text: entry.title,
          pageNumber: entry.pageNum,
          confidence,
          offset: { start: lineStart, end: lineEnd },
          lineText: line
        });
      }
    }

    currentOffset = lineEnd + 1;  // +1 for newline
  }

  // Cluster candidates
  const clusters = clusterCandidates(candidates, textLength);

  // Find the best cluster (highest average confidence + most candidates)
  let bestCluster: typeof clusters[0] | null = null;
  let bestScore = 0;

  for (const cluster of clusters) {
    // Score based on: candidate count, average confidence, page sequence validity
    const countScore = Math.min(cluster.candidates.length / 10, 1);  // Cap at 10 entries
    const confScore = cluster.avgConfidence;
    const seqValid = validatePageSequence(cluster.candidates) ? 0.2 : 0;

    // Bonus if header is present and precedes cluster
    const headerBonus = headerOffset && headerOffset.end <= cluster.start + 200 ? 0.3 : 0;

    const totalScore = countScore * 0.4 + confScore * 0.4 + seqValid + headerBonus;

    if (totalScore > bestScore && cluster.candidates.length >= 4) {
      bestScore = totalScore;
      bestCluster = cluster;
    }
  }

  // If we found a valid TOC cluster
  if (bestCluster && bestScore >= 0.5) {
    result.hasTOC = true;
    result.candidates = bestCluster.candidates;

    // Determine start offset (include header if present and nearby)
    if (headerOffset && headerOffset.end <= bestCluster.start + 200) {
      result.tocStartOffset = headerOffset.start;
      result.headerOffset = headerOffset;
    } else {
      result.tocStartOffset = bestCluster.start;
    }

    result.tocEndOffset = bestCluster.end;
  }

  return result;
}
