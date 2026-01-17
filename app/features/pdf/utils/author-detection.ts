/**
 * Author and Reference block detection for PDF text processing
 * Detects blocks that contain author names or bibliographic references using pattern-based heuristics
 */

export interface AuthorDetectionResult {
  isAuthorBlock: boolean;
  confidence: number;
  reasons: string[];
}

export interface AuthorDetectionOptions {
  minConfidence?: number;
  maxBlockLength?: number;
  debug?: boolean;
  metadataAuthor?: string;  // Author name from PDF metadata
}

const DEFAULT_OPTIONS: Required<AuthorDetectionOptions> = {
  minConfidence: 0.45,  // Lowered from 0.5 to catch more metadata blocks
  maxBlockLength: 2000,  // Increased for reference blocks which can be much longer
  debug: false,
  metadataAuthor: '',
};

// Pattern for initials: "S.", "R. M.", "J. C. X."
const INITIALS_PATTERN = /\b[A-Z]\.\s?/g;

// Common abbreviations that look like initials but aren't author names
// These will be subtracted from initials count
const COMMON_ABBREVIATIONS = /\b(U\.S\.|U\.K\.|E\.U\.|U\.N\.|D\.C\.|B\.C\.|A\.D\.|Ph\.D\.|M\.D\.|J\.D\.|M\.A\.|B\.A\.|B\.S\.|M\.S\.|Inc\.|Corp\.|Ltd\.|Co\.|Jr\.|Sr\.|Dr\.|Mr\.|Mrs\.|Ms\.|Prof\.|vs\.|etc\.|i\.e\.|e\.g\.|a\.m\.|p\.m\.)/gi;

// Pattern for affiliation markers: superscript numbers, asterisks, daggers
const AFFILIATION_MARKERS = /[¹²³⁴⁵⁶⁷⁸⁹⁰\*†‡§]+/g;

// Pattern for inline affiliation numbers attached to CAPITALIZED names (e.g., "Name1,2,3")
// Must start with capital letter to distinguish from footnotes in body text like "conservation5"
// Must have at least one digit/superscript - comma alone doesn't count (avoids "North," false positive)
const INLINE_AFFILIATION = /[A-Z][a-z]+[¹²³⁴⁵⁶⁷⁸⁹⁰\d][¹²³⁴⁵⁶⁷⁸⁹⁰\d,\*†‡§]*(?=[,\s&]|$)/g;

// Keywords that strongly indicate author blocks
// "by" must be followed by a capitalized word (name) to avoid "by low-productivity..." false positives
const AUTHOR_KEYWORDS = /^(correspondence|corresponding\s+author|author|authors|written\s+by|prepared\s+by)[\s:]/i;
const BY_AUTHOR_PATTERN = /^by\s+[A-Z][a-z]/;

// Pattern for name separators between author names
const NAME_SEPARATORS = /\s*[,&;]\s*|\s+and\s+/gi;


// ===== REFERENCE DETECTION PATTERNS =====

// DOI pattern
const DOI_PATTERN = /https?:\/\/doi\.org\/[^\s]+|doi:\s*10\.\d+\/[^\s]+/gi;

// ISSN/ISBN pattern - strong bibliographic identifier
const ISSN_ISBN_PATTERN = /\b(ISSN|ISBN|E-ISSN)\s*[:\s]?\s*[\d-X]+/gi;

// Email pattern - strong signal for author/contact blocks
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// General URL pattern (includes www. without protocol)
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s]+/gi;

// Formatted date patterns: "March 10, 2018", "10 March 2018", "March 2018", "March, 2018"
const FORMATTED_DATE_PATTERN = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s+\d{1,2})?,?\s+\d{4}\b|\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\b/gi;

// Year patterns: (1992), 1992, 1923–1928, 1923-1928
const YEAR_PATTERN = /\(?\b(19|20)\d{2}\b\)?(?:\s*[-–]\s*\(?\b(19|20)\d{2}\b\)?)?/g;

// Page number patterns: pp. 1-21, p. 45, 49-61, 14(1), 40(1)
const PAGE_PATTERN = /\b(?:pp?\.?\s*)?\d+(?:\s*[-–]\s*\d+)?(?:\(\d+\))?/g;

// Reference keywords (case insensitive)
// Split into strong (bibliographic-specific) and weak (appear in body text too)
const STRONG_REFERENCE_KEYWORDS = /\b(journal|thesis|dissertation|proceedings|conference|volume|vol\.|issue|edition|ed\.|eds\.|editor|publisher|publishing|quarterly|working\s+paper)\b/gi;
const WEAK_REFERENCE_KEYWORDS = /\b(paper|article|university|press|review|annual|monthly|economics|studies|research|international)\b/gi;

// Pattern for reference entry format: Author, A. B. (Year).
const REFERENCE_ENTRY_PATTERN = /[A-Z][a-z]+,\s*[A-Z]\.\s*(?:[A-Z]\.\s*)?(?:\((?:19|20)\d{2}\)|(?:19|20)\d{2})/g;

// Pattern for numbered citations: [17] or 82. at start of entries
const NUMBERED_CITATION_PATTERN = /(?:^|\n)\s*(?:\[\d+\]|\d+\.)\s*[A-Z][a-z]+,?\s*[A-Z]\./gm;

// Pattern for "et al." which is common in academic references
const ET_AL_PATTERN = /\bet\s*al\./gi;

// Pattern for volume/page numbers: 109, 4938–4943 or 23, 982–996
const VOLUME_PAGE_PATTERN = /\b\d+,\s*\d+[-–]\d+/g;

// ===== BODY TEXT / PROSE DETECTION (to avoid false positives) =====

// Inline citation pattern in prose: "Author (Year)" or "Author et al. (Year)"
// This is different from reference entry format: "Author, A. (Year)."
// Inline: no comma, no initials before the year parenthesis
const INLINE_CITATION_PATTERN = /[A-Z][a-z]+(?:\s+(?:and|&)\s+[A-Z][a-z-]+)*(?:\s+et\s+al\.?)?\s*\(\s*(?:19|20)\d{2}[a-z]?\s*\)/g;

// Prose verbs that indicate body text, not reference entries
const PROSE_VERBS = /\b(found\s+that|showed\s+that|demonstrated\s+that|argued\s+that|suggested\s+that|concluded\s+that|reported\s+that|observed\s+that|noted\s+that|proposed\s+that|claimed\s+that|indicated\s+that|revealed\s+that|confirmed\s+that|established\s+that|according\s+to|based\s+on|using\s+\w+|is\s+analysed|are\s+analysed|was\s+analysed|were\s+analysed|is\s+analyzed|are\s+analyzed|was\s+analyzed|were\s+analyzed|is\s+calculated|are\s+calculated|was\s+calculated|were\s+calculated|is\s+higher|are\s+higher|is\s+lower|are\s+lower|leads?\s+to|led\s+to|results?\s+in|resulted\s+in)\b/gi;

// Pattern for flowing prose sentences (subject + verb structures)
const PROSE_SENTENCE_PATTERN = /\b(the\s+\w+\s+(is|are|was|were|has|have|had)|this\s+\w+\s+(is|are|was|were)|these\s+\w+\s+(are|were|have)|we\s+(find|found|show|showed|use|used|analyse|analyze)|it\s+(is|was|has|shows|suggests))\b/gi;

// Common non-name words to exclude from capitalized word ratio
const COMMON_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
  'university', 'institute', 'department', 'school', 'college', 'center',
  'laboratory', 'research', 'sciences', 'science', 'engineering',
  'journal', 'press', 'review', 'quarterly', 'international',
  // Formal/legal terms that are often capitalized but aren't names
  'article', 'protocol', 'treaty', 'section', 'chapter', 'amendment',
  'convention', 'agreement', 'regulation', 'directive', 'resolution',
  'committee', 'commission', 'council', 'assembly', 'parliament',
  'government', 'ministry', 'agency', 'authority', 'administration',
  'republic', 'kingdom', 'federation', 'union', 'states', 'nations',
  // Geographic/environmental terms
  'arctic', 'antarctic', 'atlantic', 'pacific', 'ocean', 'sea',
  'north', 'south', 'east', 'west', 'northern', 'southern', 'eastern', 'western',
  'environmental', 'protection', 'conservation', 'development', 'exploration',
  'mineral', 'resource', 'resources', 'technological', 'technologies',
]);

/**
 * Detect if a text block is likely an author block
 */
export function detectAuthorBlock(
  text: string,
  options: AuthorDetectionOptions = {}
): AuthorDetectionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const reasons: string[] = [];
  let confidence = 0;

  const trimmedText = text.trim();

  // Skip very long blocks (unlikely to be just author names)
  if (trimmedText.length > opts.maxBlockLength) {
    return { isAuthorBlock: false, confidence: 0, reasons: ['Block too long'] };
  }

  // Skip very short blocks
  if (trimmedText.length < 5) {
    return { isAuthorBlock: false, confidence: 0, reasons: ['Block too short'] };
  }

  // 1. Check for author keywords (strong signal)
  if (AUTHOR_KEYWORDS.test(trimmedText)) {
    confidence += 0.35;
    reasons.push('Author keyword detected');
  } else if (BY_AUTHOR_PATTERN.test(trimmedText)) {
    // "by Name" pattern - slightly weaker signal
    confidence += 0.25;
    reasons.push('"by Name" pattern detected');
  }

  // 1b. Check if block contains the author name from PDF metadata
  if (opts.metadataAuthor && opts.metadataAuthor.trim().length >= 3) {
    const metadataAuthorLower = opts.metadataAuthor.trim().toLowerCase();
    const textLower = trimmedText.toLowerCase();

    // Check if the text STARTS with the metadata author name (very strong signal)
    const startsWithAuthor = textLower.startsWith(metadataAuthorLower);

    // Check if the metadata author name appears in the text
    // Handle both full name and individual name parts
    const authorParts = metadataAuthorLower.split(/\s+/).filter(p => p.length >= 2);
    const fullNameMatch = textLower.includes(metadataAuthorLower);

    // Check if at least 2 significant parts of the name appear (for multi-word names)
    const partsMatched = authorParts.filter(part => textLower.includes(part));
    const significantPartsMatch = authorParts.length >= 2 && partsMatched.length >= 2;

    if (startsWithAuthor) {
      // Block starts with author name - very strong signal
      confidence += 0.45;
      reasons.push(`Starts with metadata author: "${opts.metadataAuthor}"`);
    } else if (fullNameMatch) {
      confidence += 0.25;
      reasons.push(`Contains metadata author: "${opts.metadataAuthor}"`);
    } else if (significantPartsMatch) {
      confidence += 0.2;
      reasons.push(`Contains author name parts: ${partsMatched.join(', ')}`);
    }
  }

  // 2. Count initials pattern (S., R. M., etc.)
  // Subtract common abbreviations like U.S., U.K., Ph.D. that look like initials
  const rawInitialsMatches = trimmedText.match(INITIALS_PATTERN) || [];
  const abbreviationMatches = trimmedText.match(COMMON_ABBREVIATIONS) || [];
  // Each abbreviation contains multiple initials (e.g., "U.S." = 2 initials)
  const abbreviationInitialsCount = abbreviationMatches.reduce((sum, abbr) => {
    return sum + (abbr.match(/\./g) || []).length;
  }, 0);
  const initialsCount = Math.max(0, rawInitialsMatches.length - abbreviationInitialsCount);

  if (initialsCount >= 1) {
    const initialsScore = Math.min(initialsCount * 0.1, 0.3);
    confidence += initialsScore;
    reasons.push(`${initialsCount} initials found`);
  }

  // 3. Check for affiliation markers (superscripts, asterisks)
  const affiliationMatches = trimmedText.match(AFFILIATION_MARKERS) || [];
  const inlineAffiliationMatches = trimmedText.match(INLINE_AFFILIATION) || [];
  if (affiliationMatches.length >= 1 || inlineAffiliationMatches.length >= 1) {
    confidence += 0.2;
    reasons.push('Affiliation markers found');
  }

  // 4. Calculate ratio of capitalized words
  const words = trimmedText.split(/\s+/).filter(w => w.length > 1);
  const significantWords = words.filter(w => !COMMON_WORDS.has(w.toLowerCase()));

  let capitalizedRatio = 0;
  if (significantWords.length > 0) {
    const capitalizedWords = significantWords.filter(w => /^[A-Z]/.test(w));
    capitalizedRatio = capitalizedWords.length / significantWords.length;

    if (capitalizedRatio >= 0.8) {
      confidence += 0.3;
      reasons.push(`Very high capitalized ratio: ${Math.round(capitalizedRatio * 100)}%`);
    } else if (capitalizedRatio >= 0.7) {
      confidence += 0.25;
      reasons.push(`High capitalized ratio: ${Math.round(capitalizedRatio * 100)}%`);
    } else if (capitalizedRatio >= 0.5) {
      confidence += 0.15;
      reasons.push(`Moderate capitalized ratio: ${Math.round(capitalizedRatio * 100)}%`);
    } else if (capitalizedRatio < 0.3) {
      // Low capitalization penalty - modulated by text length
      // Short texts (<100 chars): no penalty (might be a link/DOI line)
      // Long texts (>400 chars): full penalty -0.35 (likely body text)
      const textLength = trimmedText.length;
      const minLength = 100;
      const maxLength = 400;
      const maxPenalty = 0.35;

      if (textLength > minLength) {
        const lengthFactor = Math.min((textLength - minLength) / (maxLength - minLength), 1);
        const penalty = lengthFactor * maxPenalty;
        confidence -= penalty;
        reasons.push(`Low capitalized ratio: ${Math.round(capitalizedRatio * 100)}% (penalty: -${Math.round(penalty * 100)}%)`);
      }
    }
  }

  // 5. ALL CAPS detection removed - too many false positives from acronyms

  // 6. Check for name separators (commas, &, "and" between names)
  const separatorMatches = trimmedText.match(NAME_SEPARATORS) || [];
  if (separatorMatches.length >= 1 && initialsCount >= 1) {
    confidence += 0.1;
    reasons.push('Name separators with initials');
  }

  // 6b. Bonus for very short, highly capitalized blocks with affiliation markers
  // Author name lists are typically concise (< 150 chars)
  const hasAffiliations = affiliationMatches.length >= 1 || inlineAffiliationMatches.length >= 1;
  const isVeryShort = trimmedText.length < 150;
  const isExtremelyShort = trimmedText.length < 50;

  if (isVeryShort && capitalizedRatio >= 0.8 && hasAffiliations) {
    confidence += 0.1;
    reasons.push('Short highly-capitalized block with affiliations');
  }

  // 6c. Bonus for extremely short blocks with initials (likely single author name)
  if (isExtremelyShort && capitalizedRatio >= 0.8 && initialsCount >= 1) {
    confidence += 0.2;
    reasons.push('Very short block with initials');
  }

  // ===== REFERENCE DETECTION =====

  // 7. Check for DOIs (very strong signal for references)
  const doiMatches = trimmedText.match(DOI_PATTERN) || [];
  if (doiMatches.length >= 1) {
    confidence += 0.5;
    reasons.push(`${doiMatches.length} DOI(s) found`);
  }

  // 7b. Check for ISSN/ISBN (strong bibliographic identifier)
  const issnMatches = trimmedText.match(ISSN_ISBN_PATTERN) || [];
  if (issnMatches.length >= 1) {
    confidence += 0.25;
    reasons.push(`ISSN/ISBN found`);
  }

  // 7c. Check for formatted dates + high capitalization (metadata blocks)
  const formattedDateMatches = trimmedText.match(FORMATTED_DATE_PATTERN) || [];
  if (formattedDateMatches.length >= 2 && capitalizedRatio >= 0.5) {
    // Multiple formatted dates + high capitalization = likely metadata block
    confidence += 0.35;
    reasons.push(`${formattedDateMatches.length} formatted dates with high capitalization`);
  } else if (formattedDateMatches.length >= 3) {
    // 3+ dates alone is a signal
    confidence += 0.2;
    reasons.push(`${formattedDateMatches.length} formatted dates`);
  }

  // 7d. Check for email addresses (strong signal for author/contact blocks)
  const emailMatches = trimmedText.match(EMAIL_PATTERN) || [];
  if (emailMatches.length >= 1) {
    // Email + high capitalization is very strong signal for author block
    if (capitalizedRatio >= 0.5) {
      confidence += 0.3;
      reasons.push(`Email with high capitalization`);
    } else {
      confidence += 0.15;
      reasons.push(`Email found`);
    }
  }

  // 8. Check for other URLs
  const urlMatches = trimmedText.match(URL_PATTERN) || [];
  const nonDoiUrls = urlMatches.filter(u => !u.includes('doi.org'));
  if (nonDoiUrls.length >= 1) {
    // URL + high caps ratio is a strong metadata signal
    if (capitalizedRatio >= 0.5) {
      confidence += 0.25;
      reasons.push(`${nonDoiUrls.length} URL(s) with high capitalization`);
    } else {
      confidence += 0.15;
      reasons.push(`${nonDoiUrls.length} URL(s) found`);
    }
  }

  // 9. Check for reference keywords (Journal, Press, University, etc.)
  // Strong keywords are bibliographic-specific, weak ones appear in body text too
  const strongRefKeywords = trimmedText.match(STRONG_REFERENCE_KEYWORDS) || [];
  const weakRefKeywords = trimmedText.match(WEAK_REFERENCE_KEYWORDS) || [];

  if (strongRefKeywords.length >= 2) {
    confidence += 0.25;
    reasons.push(`${strongRefKeywords.length} strong reference keywords`);
  } else if (strongRefKeywords.length >= 1) {
    confidence += 0.15;
    reasons.push('Strong reference keyword found');
  }

  // Weak keywords only count if there are also strong signals
  const hasStrongRefSignals = doiMatches.length > 0 || strongRefKeywords.length >= 1 ||
    (trimmedText.match(REFERENCE_ENTRY_PATTERN) || []).length >= 1;
  if (weakRefKeywords.length >= 3 && hasStrongRefSignals) {
    confidence += 0.1;
    reasons.push(`${weakRefKeywords.length} weak reference keywords (with strong signals)`);
  }

  // 10. Check for reference entry format: "Author, A. B. (Year)" - this is a strong signal
  const refEntryMatches = trimmedText.match(REFERENCE_ENTRY_PATTERN) || [];
  if (refEntryMatches.length >= 1) {
    confidence += 0.3;
    reasons.push(`${refEntryMatches.length} reference entry format(s)`);
  }

  // 11. Check for numbered citations: [17] Author, A. or 82. Chown, S.
  const numberedCitationMatches = trimmedText.match(NUMBERED_CITATION_PATTERN) || [];
  if (numberedCitationMatches.length >= 2) {
    confidence += 0.4;  // Very strong signal - multiple numbered refs
    reasons.push(`${numberedCitationMatches.length} numbered citations`);
  } else if (numberedCitationMatches.length >= 1) {
    confidence += 0.25;
    reasons.push('Numbered citation found');
  }

  // 12. Check for "et al." pattern (common in academic references)
  const etAlMatches = trimmedText.match(ET_AL_PATTERN) || [];
  if (etAlMatches.length >= 2) {
    confidence += 0.25;
    reasons.push(`${etAlMatches.length} "et al." occurrences`);
  } else if (etAlMatches.length >= 1) {
    confidence += 0.15;
    reasons.push('"et al." found');
  }

  // 13. Check for volume/page patterns: 109, 4938–4943
  const volumePageMatches = trimmedText.match(VOLUME_PAGE_PATTERN) || [];
  if (volumePageMatches.length >= 2) {
    confidence += 0.2;
    reasons.push(`${volumePageMatches.length} volume/page patterns`);
  } else if (volumePageMatches.length >= 1) {
    confidence += 0.1;
    reasons.push('Volume/page pattern found');
  }

  // 14. Check for year patterns (1992), 1923–1928
  // ONLY count years if there are other reference signals (to avoid body text with dates)
  const yearMatches = trimmedText.match(YEAR_PATTERN) || [];
  const hasOtherRefSignals = doiMatches.length > 0 || strongRefKeywords.length >= 1 ||
    refEntryMatches.length >= 1 || numberedCitationMatches.length >= 1 ||
    etAlMatches.length >= 1 || initialsCount >= 3;

  if (yearMatches.length >= 2 && hasOtherRefSignals) {
    confidence += 0.15;
    reasons.push(`${yearMatches.length} year references`);
  }

  // Determine if this looks like a reference/author block (for penalty adjustment)
  // Requires strong signals, not just years
  const looksLikeReference = doiMatches.length > 0 || issnMatches.length > 0 ||
    strongRefKeywords.length >= 2 || refEntryMatches.length >= 1 ||
    numberedCitationMatches.length >= 1 || etAlMatches.length >= 1 ||
    emailMatches.length > 0 || (formattedDateMatches.length >= 2 && capitalizedRatio >= 0.5);

  // 12. Penalize if block looks like a sentence (has sentence-ending punctuation mid-text)
  // BUT don't penalize if it looks like a reference block (references have periods between entries)
  // Also don't penalize for initials like "M. Hobson" - use negative lookbehind for single capital letter
  const sentencePattern = /(?<![A-Z])[.!?]\s+[A-Z][a-z]/;
  if (sentencePattern.test(trimmedText) && !looksLikeReference) {
    confidence -= 0.2;
    reasons.push('Sentence structure detected (penalty)');
  }

  // 13. Penalize if block is very long relative to number of names
  // BUT don't penalize reference blocks as heavily
  const estimatedNames = Math.max(initialsCount, separatorMatches.length + 1);
  const charsPerName = trimmedText.length / Math.max(estimatedNames, 1);
  if (charsPerName > 100 && !looksLikeReference) {
    confidence -= 0.15;
    reasons.push('Too much text per name (penalty)');
  }

  // ===== PROSE / BODY TEXT DETECTION (strong penalties) =====

  // 14. Check for inline citations in prose: "Author (Year)" format
  // This is different from reference entries which have "Author, A. (Year)."
  const inlineCitationMatches = trimmedText.match(INLINE_CITATION_PATTERN) || [];

  // 15. Check for prose verbs that indicate body text
  const proseVerbMatches = trimmedText.match(PROSE_VERBS) || [];

  // 16. Check for prose sentence structures
  const proseSentenceMatches = trimmedText.match(PROSE_SENTENCE_PATTERN) || [];

  // If we have inline citations AND prose verbs, this is almost certainly body text
  if (inlineCitationMatches.length >= 1 && proseVerbMatches.length >= 1) {
    confidence -= 0.5;  // Strong penalty
    reasons.push(`Body text with inline citations (${inlineCitationMatches.length} citations, ${proseVerbMatches.length} prose verbs) - strong penalty`);
  } else if (inlineCitationMatches.length >= 2 && proseSentenceMatches.length >= 1) {
    // Multiple inline citations with prose sentence structure
    confidence -= 0.4;
    reasons.push(`Prose with multiple inline citations - penalty`);
  } else if (proseVerbMatches.length >= 2) {
    // Multiple prose verbs without reference formatting
    confidence -= 0.3;
    reasons.push(`Multiple prose verbs detected - penalty`);
  } else if (proseSentenceMatches.length >= 2 && !looksLikeReference) {
    // Multiple prose sentence patterns
    confidence -= 0.25;
    reasons.push(`Prose sentence structure detected - penalty`);
  }

  // Clamp confidence between 0 and 1, and round to avoid floating-point precision issues
  confidence = Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100;

  const isAuthorBlock = confidence >= opts.minConfidence;

  if (opts.debug) {
    console.log(`[AuthorDetect] "${trimmedText.slice(0, 50)}..." conf: ${Math.round(confidence * 100)}% | ${reasons.join(', ')}`);
  }

  return { isAuthorBlock, confidence, reasons };
}

/**
 * Check if a block should be considered for author/reference detection
 * Quick pre-filter before full detection
 */
export function isAuthorBlockCandidate(text: string): boolean {
  const trimmed = text.trim();

  // Must have at least one capital letter
  if (!/[A-Z]/.test(trimmed)) return false;

  // Must be reasonably short (increased for reference blocks)
  if (trimmed.length > 2500) return false;

  // Author signals
  const hasInitials = /\b[A-Z]\.\s?/.test(trimmed);
  const hasAuthorKeyword = AUTHOR_KEYWORDS.test(trimmed) || BY_AUTHOR_PATTERN.test(trimmed);
  const hasAffiliation = /[¹²³⁴⁵⁶⁷⁸⁹⁰\*†‡§]/.test(trimmed);

  // Reference signals
  const hasDoi = /doi\.org|doi:/i.test(trimmed);
  const hasUrl = URL_PATTERN.test(trimmed);  // URLs are metadata signals
  const hasRefEntryFormat = /[A-Z][a-z]+,\s*[A-Z]\.\s*(?:[A-Z]\.\s*)?\(?(19|20)\d{2}\)?/.test(trimmed);
  // Numbered citations: [17] Author or 82. Author
  const hasNumberedCitation = /(?:^|\n)\s*(?:\[\d+\]|\d+\.)\s*[A-Z][a-z]+/.test(trimmed);
  // "et al." is a strong academic reference signal
  const hasEtAl = /\bet\s*al\./i.test(trimmed);
  // Formatted dates (like "March 10, 2018" or "November 2003")
  const formattedDates = trimmed.match(FORMATTED_DATE_PATTERN) || [];
  const hasFormattedDate = formattedDates.length >= 1;  // Reduced from 2 to 1

  // High caps ratio in short blocks (likely author/metadata)
  let hasHighCapsRatio = false;
  if (trimmed.length < 300) {
    const words = trimmed.split(/\s+/).filter(w => w.length > 1);
    const significantWords = words.filter(w => !COMMON_WORDS.has(w.toLowerCase()));
    if (significantWords.length > 0) {
      const capitalizedWords = significantWords.filter(w => /^[A-Z]/.test(w));
      const capsRatio = capitalizedWords.length / significantWords.length;
      hasHighCapsRatio = capsRatio >= 0.7;
    }
  }

  return hasInitials || hasAuthorKeyword || hasAffiliation ||
         hasDoi || hasUrl || hasRefEntryFormat || hasNumberedCitation ||
         hasEtAl || hasFormattedDate || hasHighCapsRatio;
}
