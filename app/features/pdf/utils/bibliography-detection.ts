/**
 * Bibliography/Reference Section Detection Module
 *
 * Detects reference sections using density-based blob analysis.
 * Analyzes aggregate characteristics (year density, DOIs, author patterns, etc.)
 * rather than trying to identify individual entries.
 */

import type { StructuredPage, TextHighlight } from "../types";

// ===== TYPES =====

export interface BibliographyCandidate {
  text: string;
  score: number;
  offset: { start: number; end: number };
  signals: string[];
}

export interface BibliographyDetectionResult {
  hasBibliography: boolean;
  startOffset: number;
  endOffset: number;
  headerText: string | null;
  headerOffset: { start: number; end: number } | null;
  candidates: BibliographyCandidate[];
}

interface BibliographyCluster {
  start: number;
  end: number;
  blobScore: number;
  blobSignals: string[];
  paragraphCount: number;
  blobText: string;
}

// ===== PATTERNS =====

// Bibliography header patterns
const BIBLIOGRAPHY_HEADER_PATTERNS = [
  /^references?\b/i,
  /^bibliography\b/i,
  /^works\s+cited\b/i,
  /^literature\s+cited\b/i,
  /^cited\s+references?\b/i,
  /^r[eé]f[eé]rences?\b/i, // French/Spanish
  /^bibliograf[iíy]a?\b/i, // Spanish/Portuguese
  /^literaturverzeichnis\b/i, // German
  /^quellenverzeichnis\b/i, // German
  /^literatur\b/i, // German
  /^\d+[\.\)]\s*references?\b/i, // "10. References"
];

// ===== BLOB-BASED SCORING =====

/**
 * Calculate a bibliography score for a text block based on density of bibliographic markers.
 * This is the ONLY scoring mechanism - works for both individual entries and merged blobs.
 *
 * Signals analyzed (all density-based per 1000 chars):
 * - Parenthetical years: (2004), (2017)
 * - DOIs: doi:10.xxx
 * - Author patterns: "Surname, X."
 * - Co-author markers: "& Surname", "et al."
 * - Journal indicators: vol., pp., issue
 * - URLs, ISBNs
 */
function calculateBibliographyScore(text: string): {
  score: number;
  signals: string[];
} {
  const len = text.length;
  if (len < 50) return { score: 0, signals: [] };

  const per1000 = 1000 / len;
  const signals: string[] = [];

  // Count signals
  const parentheticalYears = (text.match(/\((?:19|20)\d{2}[a-z]?\)/g) || [])
    .length;
  // Also match bare years in citation context: ", 2012," or ", 2012." or "2012, 5," (year, volume)
  const bareYears = (text.match(/[,\s](?:19|20)\d{2}[,\.]/g) || []).length;
  const dois = (text.match(/doi[:\s]?\s*10\.\d+/gi) || []).length;
  const urls = (text.match(/https?:\/\//g) || []).length;
  // Surname-first: "Surname, X." or "Surname, X. Y."
  const surnameFirstAuthors = (
    text.match(/[A-ZÀ-ÖØ-Þ][a-zà-ÿ]+,\s+[A-ZÀ-ÖØ-Þ]\./g) || []
  ).length;
  // Initials-first: "X. Surname" or "X. Y. Surname" (scientific journal style)
  const initialsFirstAuthors = (
    text.match(/[A-ZÀ-ÖØ-Þ]\.\s+(?:[A-ZÀ-ÖØ-Þ]\.\s+)?[A-ZÀ-ÖØ-Þ][a-zà-ÿ]+/g) || []
  ).length;
  // Full name authors: "Surname, Firstname" (humanities/book style - Chicago, etc.)
  // Matches: "Azoulay, Ariella", "Barthes, Roland", "Foucault, Michel"
  const fullNameAuthors = (
    text.match(/[A-ZÀ-ÖØ-Þ][a-zà-ÿ]+,\s+[A-ZÀ-ÖØ-Þ][a-zà-ÿ]{2,}/g) || []
  ).length;
  const authorInitials = surnameFirstAuthors + initialsFirstAuthors + fullNameAuthors;
  const ampersandAuthors = (text.match(/&\s+[A-ZÀ-ÖØ-Þ][a-zà-ÿ]+/g) || [])
    .length;
  // Also match "and X. Surname" pattern common in scientific refs
  const andAuthors = (text.match(/\band\s+[A-ZÀ-ÖØ-Þ]\.\s+[A-ZÀ-ÖØ-Þ][a-zà-ÿ]+/g) || [])
    .length;
  const etAls = (text.match(/et\s+al\./gi) || []).length;
  const journalIndicators = (
    text.match(/\b(journal\s+of|vol\.|volume\s|pp\.|pages?\s|issue\s)/gi) || []
  ).length;
  // Scientific journal abbreviations with periods (e.g., "Chem. Rev.", "Adv. Mater.")
  const journalAbbrevs = (
    text.match(/[A-Z][a-z]+\.\s+[A-Z][a-z]+\./g) || []
  ).length;
  const isbns = (text.match(/isbn/gi) || []).length;
  const numberedRefs = (text.match(/^\s*\[\d+\]/gm) || []).length;
  // Numbered entries at start of line: "1. Author" or "12. Author"
  const numberedEntries = (text.match(/^\s*\d+\.\s+[A-ZÀ-ÖØ-Þ]/gm) || []).length;

  // Calculate densities
  const totalYears = parentheticalYears + bareYears;
  const yearDensity = totalYears * per1000;
  const authorDensity = authorInitials * per1000;
  const doiDensity = dois * per1000;

  let score = 0;

  // Years (parenthetical or bare - both strong signals)
  if (yearDensity >= 10) {
    score += 0.35;
    signals.push(`high_year_density(${totalYears})`);
  } else if (yearDensity >= 5) {
    score += 0.25;
    signals.push(`med_year_density(${totalYears})`);
  } else if (yearDensity >= 2) {
    score += 0.15;
    signals.push(`low_year_density(${totalYears})`);
  } else if (totalYears >= 1) {
    score += 0.05;
    signals.push(`has_years(${totalYears})`);
  }

  // DOIs (very strong signal)
  if (doiDensity >= 5) {
    score += 0.4;
    signals.push(`high_doi_density(${dois})`);
  } else if (dois >= 3) {
    score += 0.35;
    signals.push(`many_dois(${dois})`);
  } else if (dois >= 2) {
    score += 0.25;
    signals.push(`some_dois(${dois})`);
  } else if (dois >= 1) {
    score += 0.15;
    signals.push(`has_doi(${dois})`);
  }

  // Author patterns (Surname, X.)
  if (authorDensity >= 8) {
    score += 0.3;
    signals.push(`high_author_density(${authorInitials})`);
  } else if (authorDensity >= 4) {
    score += 0.2;
    signals.push(`med_author_density(${authorInitials})`);
  } else if (authorInitials >= 2) {
    score += 0.1;
    signals.push(`some_authors(${authorInitials})`);
  }

  // Ampersand authors (& Surname)
  if (ampersandAuthors >= 5) {
    score += 0.15;
    signals.push(`many_ampersand(${ampersandAuthors})`);
  } else if (ampersandAuthors >= 2) {
    score += 0.08;
    signals.push(`some_ampersand(${ampersandAuthors})`);
  }

  // "and X. Surname" pattern (common in scientific refs)
  if (andAuthors >= 3) {
    score += 0.15;
    signals.push(`many_and_authors(${andAuthors})`);
  } else if (andAuthors >= 1) {
    score += 0.08;
    signals.push(`has_and_authors(${andAuthors})`);
  }

  // "et al." - academic citation marker
  if (etAls >= 3) {
    score += 0.15;
    signals.push(`many_etal(${etAls})`);
  } else if (etAls >= 1) {
    score += 0.08;
    signals.push(`has_etal(${etAls})`);
  }

  // Journal indicators
  if (journalIndicators >= 5) {
    score += 0.15;
    signals.push(`many_journal(${journalIndicators})`);
  } else if (journalIndicators >= 2) {
    score += 0.08;
    signals.push(`some_journal(${journalIndicators})`);
  }

  // Scientific journal abbreviations (e.g., "Chem. Rev.", "Adv. Mater.")
  if (journalAbbrevs >= 3) {
    score += 0.2;
    signals.push(`many_journal_abbrev(${journalAbbrevs})`);
  } else if (journalAbbrevs >= 1) {
    score += 0.1;
    signals.push(`has_journal_abbrev(${journalAbbrevs})`);
  }

  // Numbered references [1], [2], etc.
  if (numberedRefs >= 5) {
    score += 0.2;
    signals.push(`many_numbered_bracket(${numberedRefs})`);
  } else if (numberedRefs >= 2) {
    score += 0.1;
    signals.push(`some_numbered_bracket(${numberedRefs})`);
  }

  // Numbered entries (1. Author, 2. Author, etc.)
  if (numberedEntries >= 5) {
    score += 0.25;
    signals.push(`many_numbered_entries(${numberedEntries})`);
  } else if (numberedEntries >= 2) {
    score += 0.15;
    signals.push(`some_numbered_entries(${numberedEntries})`);
  } else if (numberedEntries >= 1) {
    score += 0.05;
    signals.push(`has_numbered_entry(${numberedEntries})`);
  }

  // URLs
  if (urls >= 3) {
    score += 0.1;
    signals.push(`many_urls(${urls})`);
  } else if (urls >= 1) {
    score += 0.05;
    signals.push(`has_urls(${urls})`);
  }

  // ISBN
  if (isbns >= 1) {
    score += 0.1;
    signals.push(`has_isbn(${isbns})`);
  }

  return { score: Math.min(1, score), signals };
}

// ===== HELPER FUNCTIONS =====

/**
 * Check if a line is a bibliography header
 */
function isBibliographyHeader(line: string): boolean {
  const trimmed = line.trim();
  return BIBLIOGRAPHY_HEADER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// ===== CLUSTERING =====

interface ScoredParagraph {
  text: string;
  score: number;
  signals: string[];
  start: number;
  end: number;
}

/**
 * Find the best cluster of consecutive paragraphs with bibliography signals.
 *
 * Two-pass approach:
 * 1. Build clusters of consecutive positive-score paragraphs
 *    - Allow 0-score paragraphs if they're shorter than the cluster's average paragraph length
 *    - This handles artifacts/noise in the middle of a bibliography
 * 2. Concatenate all paragraphs in each cluster and score the blob
 * 3. Return the cluster with the highest blob score
 */
function findBestCluster(
  paragraphs: ScoredParagraph[],
  minParagraphs: number = 3
): BibliographyCluster | null {
  const DEBUG = false;

  if (paragraphs.length === 0) return null;

  // Build clusters of consecutive paragraphs
  const clusters: Array<{
    paragraphs: ScoredParagraph[];
    start: number;
    end: number;
  }> = [];

  let currentCluster: ScoredParagraph[] = [];
  let clusterTotalLength = 0;

  const finalizeCluster = () => {
    if (currentCluster.length >= minParagraphs) {
      clusters.push({
        paragraphs: [...currentCluster],
        start: currentCluster[0].start,
        end: currentCluster[currentCluster.length - 1].end,
      });
    }
    currentCluster = [];
    clusterTotalLength = 0;
  };

  let consecutiveZeroScores = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const hasPositiveScore = para.score > 0;

    if (hasPositiveScore) {
      // Reset consecutive zero counter
      consecutiveZeroScores = 0;
      // Add to cluster
      currentCluster.push(para);
      clusterTotalLength += para.text.length;
      if (DEBUG) {
        console.log(`[BibDetect] Adding para ${i} to cluster (score=${para.score.toFixed(2)}), cluster now has ${currentCluster.length} paras`);
      }
    } else {
      // 0-score paragraph
      consecutiveZeroScores++;

      if (currentCluster.length > 0) {
        // End cluster if 2+ consecutive 0-score paragraphs
        if (consecutiveZeroScores >= 2) {
          if (DEBUG) {
            console.log(`[BibDetect] Ending cluster at para ${i}: ${consecutiveZeroScores} consecutive 0-score paras, cluster had ${currentCluster.length} paras`);
          }
          // Remove the previous 0-score para that was added
          if (currentCluster.length > 0 && currentCluster[currentCluster.length - 1].score === 0) {
            const removed = currentCluster.pop();
            if (removed) clusterTotalLength -= removed.text.length;
          }
          finalizeCluster();
          consecutiveZeroScores = 0;
        } else {
          // First 0-score para - include it tentatively (might be noise between entries)
          currentCluster.push(para);
          clusterTotalLength += para.text.length;
          if (DEBUG) {
            console.log(`[BibDetect] Including 0-score para tentatively: "${para.text.slice(0, 50)}..."`);
          }
        }
      } else if (DEBUG && para.text.length > 50) {
        // No current cluster, skipping this 0-score paragraph
        console.log(`[BibDetect] Skipping 0-score para ${i} (no cluster): "${para.text.slice(0, 60).replace(/\n/g, '\\n')}..."`);
      }
    }
  }

  // Don't forget the last cluster
  finalizeCluster();

  if (DEBUG) {
    console.log(`[BibDetect] Found ${clusters.length} potential clusters with >= ${minParagraphs} paragraphs`);
  }

  if (clusters.length === 0) return null;

  // Score each cluster as a blob and find the best one
  let bestCluster: BibliographyCluster | null = null;

  for (const cluster of clusters) {
    // Concatenate all paragraphs
    const blobText = cluster.paragraphs.map(p => p.text).join("\n\n");

    // Score the blob
    const { score: blobScore, signals: blobSignals } = calculateBibliographyScore(blobText);

    if (DEBUG) {
      console.log(`[BibDetect] Cluster: ${cluster.paragraphs.length} paras, blobLen=${blobText.length}, blobScore=${blobScore.toFixed(2)}, signals=[${blobSignals.join(", ")}]`);
    }

    if (bestCluster === null || blobScore > bestCluster.blobScore) {
      bestCluster = {
        start: cluster.start,
        end: cluster.end,
        blobScore,
        blobSignals,
        paragraphCount: cluster.paragraphs.length,
        blobText,
      };
    }
  }

  return bestCluster;
}

// ===== MAIN DETECTION FUNCTION =====

/**
 * Detect Bibliography/Reference section using blob-based density analysis.
 *
 * Algorithm:
 * 1. Find bibliography header (optional but helps)
 * 2. Score paragraphs in latter part of document using density-based metrics
 * 3. Find clusters of consecutive high-scoring paragraphs
 * 4. Accept clusters that meet threshold
 */
export function detectBibliography(
  fullText: string,
  _pages: StructuredPage[],
  existingHighlights?: TextHighlight[]
): BibliographyDetectionResult {
  const DEBUG = false;

  const result: BibliographyDetectionResult = {
    hasBibliography: false,
    startOffset: 0,
    endOffset: fullText.length,
    headerText: null,
    headerOffset: null,
    candidates: [],
  };

  if (!fullText || fullText.length === 0) return result;

  if (DEBUG)
    console.log(`[BibDetect] Document length: ${fullText.length} chars`);

  const textLength = fullText.length;

  // Step 1: Find bibliography header
  let headerOffset: { start: number; end: number } | null = null;
  let headerText: string | null = null;

  const allLines = fullText.split("\n");
  let lineOffset = 0;

  for (const line of allLines) {
    const lineStart = lineOffset;
    const documentPosition = lineStart / textLength;

    // Only look for header in latter 40% of document
    if (
      documentPosition >= 0.4 &&
      !headerOffset &&
      isBibliographyHeader(line.trim())
    ) {
      headerOffset = { start: lineStart, end: lineStart + line.length };
      headerText = line.trim();
      if (DEBUG) {
        console.log(
          `[BibDetect] Found header: "${headerText}" at ${(
            documentPosition * 100
          ).toFixed(1)}%`
        );
      }
    }

    lineOffset += line.length + 1;
  }

  // Step 2: Score paragraphs using density-based analysis
  // Start from header if found, otherwise from 50% of document
  const searchStart = headerOffset
    ? headerOffset.end
    : Math.floor(textLength * 0.5);

  const searchText = fullText.slice(searchStart);
  const paragraphs = searchText.split(/\n\n+/);

  if (DEBUG) {
    console.log(`[BibDetect] Search starts at ${((searchStart / textLength) * 100).toFixed(1)}%, searchText length=${searchText.length}, split into ${paragraphs.length} paragraphs`);
  }

  const scoredParagraphs: Array<{
    text: string;
    score: number;
    signals: string[];
    start: number;
    end: number;
  }> = [];

  let paraOffset = 0;
  for (const para of paragraphs) {
    if (!para.trim()) continue;

    const paraStart = searchText.indexOf(para, paraOffset);
    const globalStart = searchStart + paraStart;
    const globalEnd = globalStart + para.length;
    paraOffset = paraStart + para.length;

    // Score paragraphs of any reasonable length
    if (para.length >= 50) {
      const { score, signals } = calculateBibliographyScore(para);

      scoredParagraphs.push({
        text: para,
        score,
        signals,
        start: globalStart,
        end: globalEnd,
      });
    }
  }

  if (DEBUG) {
    console.log(`[BibDetect] Scored ${scoredParagraphs.length} paragraphs`);
    // Log all paragraphs in latter 70% with their scores
    for (const p of scoredParagraphs) {
      const pos = ((p.start / textLength) * 100).toFixed(1);
      if (p.start / textLength > 0.7) {
        console.log(
          `[BibDetect] Para at ${pos}%: score=${p.score.toFixed(2)}, signals=[${p.signals.join(", ")}], len=${p.text.length}, text="${p.text.slice(0, 80).replace(/\n/g, "\\n")}..."`
        );
      }
    }
  }

  // Step 3: Find clusters of consecutive positive-scoring paragraphs
  // and score them as blobs (concatenated text)
  const minParagraphs = 1;

  const bestCluster = findBestCluster(scoredParagraphs, minParagraphs);

  if (DEBUG) {
    console.log(`[BibDetect] Best cluster: ${bestCluster ? `blobScore=${bestCluster.blobScore.toFixed(2)}, ${bestCluster.paragraphCount} paragraphs` : "none"}`);
  }

  // Step 4: Determine if we found a valid bibliography
  // Lower threshold if header found, since we have additional evidence
  const acceptanceThreshold = headerOffset ? 0.35 : 0.45;

  if (bestCluster && bestCluster.blobScore >= acceptanceThreshold) {
    if (DEBUG) {
      console.log(
        `[BibDetect] SUCCESS (cluster): blobScore=${bestCluster.blobScore.toFixed(2)}, ${
          bestCluster.paragraphCount
        } paragraphs, signals=[${bestCluster.blobSignals.slice(0, 5).join(", ")}${
          bestCluster.blobSignals.length > 5 ? "..." : ""
        }]`
      );
    }

    result.hasBibliography = true;

    // Include header if present
    if (headerOffset) {
      result.startOffset = headerOffset.start;
      result.headerOffset = headerOffset;
      result.headerText = headerText;
    } else {
      result.startOffset = bestCluster.start;
    }

    result.endOffset = bestCluster.end;

    // Store candidates for debugging
    result.candidates = scoredParagraphs
      .filter((p) => p.start >= bestCluster!.start && p.end <= bestCluster!.end)
      .map((p) => ({
        text: p.text.slice(0, 100) + (p.text.length > 100 ? "..." : ""),
        score: p.score,
        offset: { start: p.start, end: p.end },
        signals: p.signals,
      }));
  } else {
    // Fallback: Check if any single paragraph has a very high score
    // This handles cases where all references are merged into one paragraph
    const singleParaThreshold = 0.5;
    const highScoringPara = scoredParagraphs.find(p => p.score >= singleParaThreshold);

    if (highScoringPara) {
      if (DEBUG) {
        console.log(
          `[BibDetect] SUCCESS (single para fallback): score=${highScoringPara.score.toFixed(2)}, len=${highScoringPara.text.length}, signals=[${highScoringPara.signals.join(", ")}]`
        );
      }

      result.hasBibliography = true;

      // Include header if present
      if (headerOffset) {
        result.startOffset = headerOffset.start;
        result.headerOffset = headerOffset;
        result.headerText = headerText;
      } else {
        result.startOffset = highScoringPara.start;
      }

      result.endOffset = highScoringPara.end;

      result.candidates = [{
        text: highScoringPara.text.slice(0, 100) + (highScoringPara.text.length > 100 ? "..." : ""),
        score: highScoringPara.score,
        offset: { start: highScoringPara.start, end: highScoringPara.end },
        signals: highScoringPara.signals,
      }];
    } else {
      if (DEBUG) {
        console.log(
          `[BibDetect] FAILED: bestCluster=${
            bestCluster
              ? `blobScore=${bestCluster.blobScore.toFixed(
                  2
                )} (need >= ${acceptanceThreshold})`
              : "none"
          }, no single para >= ${singleParaThreshold}, header=${headerText || "none"}`
        );
      }
    }
  }

  return result;
}

// ===== EXPORTED FOR PARAGRAPH-JOINING =====

/**
 * Quick check if text looks like bibliography content.
 * Used by paragraph-joining to avoid merging bibliography entries.
 */
export function analyzeBibEntry(text: string): {
  isCandidate: boolean;
  signals: string[];
  candidateScore: number;
} {
  const { score, signals } = calculateBibliographyScore(text);
  return {
    isCandidate: score >= 0.25,
    signals,
    candidateScore: score,
  };
}
