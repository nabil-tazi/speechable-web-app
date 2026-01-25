/**
 * Citation, URL, email, and figure detection utilities.
 * Functions for detecting various types of references in PDF text.
 *
 * Reference patterns include:
 * - Superscript numbers: ¹²³
 * - Bracketed numbers: [1], [1,2], [1-3]
 * - Inline superscript-style: word1, word12,13
 * - Author-year citations: (Author, 2020), (Castells 2001)
 * - Year-only citations: (2012)
 * - Figure/table cross-references: (Figure 3), [Table 2], (see Figures 12 and 13)
 */

import type { StructuredBlock } from "../types";
import {
  FIGURE_LABEL_MAX_CHARS,
  FIGURE_LABEL_MIN_BLOCKS,
} from "./pdf-utils-common";
import { isSectionHeadingPattern, isStyledAsHeading } from "./heading-patterns";

// ============================================================================
// PATTERNS
// ============================================================================

// Common figure/table legend patterns
// Matches: "Fig. 1 Description", "Figure 1: Text", "Table 2. Results", etc.
// Uses [\s\u00A0] to handle non-breaking spaces from PDFs
const LEGEND_PATTERN =
  /^(fig\.?|figure|table|chart|graph|diagram|box|panel|source|note|image|photo|illustration|exhibit|map|scheme|plate|appendix)[\s\u00A0]*\d+/i;

// List item pattern for detecting bulleted/numbered lists
const LIST_ITEM_PATTERN =
  /^[\s]*([•\-\*\u2022\u2023\u2043]|\d+[.)\]]|[a-zA-Z][.)\]]|\([a-zA-Z0-9]+\))\s/;

// Reference patterns for detecting citations/superscripts
const REFERENCE_PATTERNS = [
  /[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g, // Unicode superscript numbers
  /\[\d+(?:[,\-–]\s*\d+)*\]/g, // [1], [1,2], [1-3]

  // === FIGURE/TABLE CROSS-REFERENCES ===
  // Parenthetical: (Figure 3), (see Figure 5), (Figures 12 and 13), (Fig. 3), (Table 2)
  /\(\s*(?:see\s+|cf\.?\s+)?(?:fig(?:ure)?s?|tables?|charts?|graphs?|diagrams?|panels?)\.?\s+\d+(?:\s*(?:and|&|,|–|-)\s*\d+)*\s*\)/gi,
  // Bracketed: [Figure 3], [Table 2], [Fig. 3]
  /\[\s*(?:see\s+|cf\.?\s+)?(?:fig(?:ure)?s?|tables?|charts?|graphs?|diagrams?|panels?)\.?\s+\d+(?:\s*(?:and|&|,|–|-)\s*\d+)*\s*\]/gi,
  // Appendix references with numbers OR letters: (Appendix A), [Appendix 1], (Appendices A and B)
  /\(\s*(?:see\s+|cf\.?\s+)?(?:appendix|appendices)\s+[A-Z\d]+(?:\s*(?:and|&|,|–|-)\s*[A-Z\d]+)*\s*\)/gi,
  /\[\s*(?:see\s+|cf\.?\s+)?(?:appendix|appendices)\s+[A-Z\d]+(?:\s*(?:and|&|,|–|-)\s*[A-Z\d]+)*\s*\]/gi,
  // Inline superscript numbers after lowercase letters or sentence-ending punctuation
  // Matches: "word1", "word12,13", "word1-3" (reference lists)
  // Excludes: "CO2" (uppercase), "0.5" (decimal), "1,000" (thousands - 3 digits after comma)
  // Requires 3+ letters before the number to avoid matching units like "a²", "km²", "m³"
  /(?<=[a-z]{3,}|[;:!?'"])\d{1,3}(?:[,\-–]\d{1,2})*(?=[.,;:\s]|$)/g,
  // Multi-digit reference lists: "104,105" - both sides have 2-3 digits (can't be thousands)
  // Thousands format is always 1-3 digits + comma + exactly 3 digits, so 2-3 + 2-3 is safe
  /(?<=[a-z]{3,}|[;:!?'"])\d{2,3}(?:[,\-–]\d{2,3})+(?=[.,;:\s]|$)/g,

  // === INLINE CITATION PATTERNS (Author, Year) style ===

  // Year-only citations: (2012), ( 2002 ), (2010 )
  /\(\s*(?:19|20)\d{2}\s*\)/g,

  // Year with page number(s): (2001, 16), (2001, 16–22), (2001, 16, 22, 45)
  /\(\s*(?:19|20)\d{2}\s*,\s*\d+(?:\s*[-–,]\s*\d+)*\s*\)/g,

  // Author year: page (Chicago humanities style): (Sontag 1977: 3), (Sontag 2003: 110–13)
  /\(\s*[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ''\-.]+\s+(?:19|20)\d{2}\s*:\s*\d+(?:\s*[-–]\s*\d+)?\s*\)/g,

  // Author year, page (comma separator): (Binns 1968, 279), (Smith 2001, 45–50)
  // Also handles multiple authors: (Nimis and Nur Goni 2018, 284–85)
  /\(\s*[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ''\-.]+(?:\s+(?:and|&)\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ''\-.\s]+)?\s+(?:19|20)\d{2}\s*,\s*\d+(?:\s*[-–]\s*\d+)?\s*\)/g,

  // Page number(s) only: (6), (23), (127), (92–93), (87–88), (147–51)
  // Matches 1-3 digit numbers or ranges in parentheses (common for page references)
  /\(\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?\s*\)/g,

  // Single author with year (comma): (Author, Year) or (De Mello, 1999) or (van der Berg, 2019)
  // Allow lowercase prefixes (van der, von, de la), multi-word names, suffixes (Jr, Sr), accented chars, acronyms
  // Optional "see ", "e.g., ", "cf. " prefix
  /\(\s*(?:see\s+|e\.g\.?,?\s+|cf\.?\s+)?(?:(?:van|von|de|du|la|le|di|da)(?:\s+(?:der|den|het|la|las|los))?\s+)?(?:[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ''\-.]+(?:\s+(?:of|and|the|for|[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ''\-.]+))?)+(?:\s+(?:Jr|Sr|III?|IV)\.?)?(?:\s+et\.?\s*al\.?)?\s*,\s*(?:19|20)\d{2}[a-z]?\s*\)/g,

  // Single author with year (space): (Castells 2001) or (van der Berg 2019)
  /\(\s*(?:see\s+|e\.g\.?,?\s+|cf\.?\s+)?(?:(?:van|von|de|du|la|le|di|da)(?:\s+(?:der|den|het|la|las|los))?\s+)?[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ''\-.]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ''\-.]+)*(?:\s+(?:Jr|Sr|III?|IV)\.?)?(?:\s+et\.?\s*al\.?)?\s+(?:19|20)\d{2}[a-z]?\s*\)/g,

  // Multiple authors or years separated by semicolons:
  // (Castells, 2001; Said, 1978) | (see Baldwin et al., 2005; Blomström & Kokko, 1999; OECD, 2002)
  // Supports: "see/e.g./cf." prefix, lowercase prefixes (van der), accented chars (ö), acronyms (OECD), suffixes (Jr)
  /\(\s*(?:see\s+|e\.g\.?,?\s+|cf\.?\s+)?(?:(?:(?:van|von|de|du|la|le|di|da)(?:\s+(?:der|den|het|la|las|los))?\s+)?[A-ZÀ-ÖØ-Ý][a-zA-ZÀ-ÖØ-öø-ÿ''\-.]*(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ''\-.]+)*(?:\s+(?:Jr|Sr|III?|IV)\.?)?(?:\s+(?:and|&)\s+(?:(?:van|von|de|du|la|le|di|da)(?:\s+(?:der|den|het|la|las|los))?\s+)?[A-ZÀ-ÖØ-Ý][a-zA-ZÀ-ÖØ-öø-ÿ''\-.]*(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ''\-.]+)*(?:\s+(?:Jr|Sr|III?|IV)\.?)?)?(?:\s+et\.?\s*al\.?)?\s*[,\s]+(?:19|20)\d{2}[a-z]?(?:\s*;\s*)?)+\s*\)/g,
];

// Common TLDs for URL detection without protocol
const COMMON_TLDS = [
  // Generic
  'com', 'org', 'net', 'edu', 'gov', 'io', 'co', 'info', 'biz', 'me', 'tv', 'cc', 'app', 'dev',
  // Country codes (common ones)
  'fr', 'uk', 'de', 'es', 'it', 'nl', 'be', 'ch', 'at', 'pl', 'pt', 'se', 'no', 'dk', 'fi',
  'eu', 'ru', 'cn', 'jp', 'kr', 'au', 'nz', 'ca', 'mx', 'br', 'ar', 'in', 'za',
  // UK variations
  'co\\.uk', 'org\\.uk', 'ac\\.uk',
];

// Build TLD pattern for regex
const TLD_PATTERN = COMMON_TLDS.join('|');

// URL pattern - matches:
// 1. http(s):// URLs
// 2. www. URLs
// 3. domain.tld/path URLs (where tld is a known extension)
// Build URL pattern with TLDs
// Characters not allowed in URLs: whitespace, <, >, ", {, }, |, \, ^, `, [, ]
const URL_INVALID_CHARS = '[^\\s<>"{}|\\\\^`\\[\\]]*';
const URL_PATTERN = new RegExp(
  '(?:https?:\\/\\/|www\\.|[a-zA-Z0-9][-a-zA-Z0-9]*\\.(?:' + TLD_PATTERN + ')(?:\\/|(?=[^a-zA-Z0-9])|$))' + URL_INVALID_CHARS,
  'gi'
);

// URL continuation characters - when a URL ends with these, it likely continues on next line
const URL_CONTINUATION_CHARS = /[\/=?&-]$/;

// URL path pattern - matches text that looks like a URL path continuation
// e.g., "path/to/file", "notice/1234", "/resource"
const URL_PATH_PATTERN = /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9._~:?#\[\]@!$&'()*+,;=-]*)+/;

/**
 * Check if text ends with a URL and whether it ends with a continuation character.
 * Used for determining if lines should be joined without space.
 */
export function endsWithURL(text: string): { isURL: boolean; endsWithContinuationChar: boolean; urlEndIndex: number } {
  const urls = detectURLs(text);
  if (urls.length === 0) {
    return { isURL: false, endsWithContinuationChar: false, urlEndIndex: -1 };
  }

  // Check if the last URL ends at or near the end of the text
  const lastURL = urls[urls.length - 1];
  const textAfterURL = text.slice(lastURL.end).trim();

  // URL should be at the end (allowing for trailing whitespace or minimal punctuation)
  if (textAfterURL.length > 2) {
    return { isURL: false, endsWithContinuationChar: false, urlEndIndex: -1 };
  }

  // Get the actual URL text
  const urlText = text.slice(lastURL.start, lastURL.end);
  const endsWithContinuation = URL_CONTINUATION_CHARS.test(urlText);

  return {
    isURL: true,
    endsWithContinuationChar: endsWithContinuation,
    urlEndIndex: lastURL.end
  };
}

/**
 * Check if text looks like a URL path continuation.
 * e.g., "path/to/file", "notice/1234-something", "/resource"
 */
export function looksLikeURLPath(text: string): boolean {
  const trimmed = text.trimStart();

  // Check if it starts with a path-like pattern
  // Either "/something" or "word/word"
  if (trimmed.startsWith('/')) {
    return true;
  }

  // Check for "word/word" pattern (no spaces before first /)
  return URL_PATH_PATTERN.test(trimmed);
}

// Email pattern - matches standard email addresses
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// ============================================================================
// LEGEND & CAPTION DETECTION
// ============================================================================

/**
 * Check if text appears to be a figure/table legend or caption.
 * Exported for use in outline-matching.
 */
export function isLegendOrCaption(text: string): boolean {
  return LEGEND_PATTERN.test(text.trim());
}

/**
 * Check if a line appears to be a list item
 */
export function isListItem(text: string): boolean {
  return LIST_ITEM_PATTERN.test(text);
}

// ============================================================================
// FIGURE LABEL DETECTION
// ============================================================================

/**
 * Check if text is a potential figure label (short, no sentence-ending punctuation)
 */
export function isPotentialFigureLabel(text: string): boolean {
  const trimmed = text.trim();
  // Short text without sentence-ending punctuation
  return (
    trimmed.length > 0 &&
    trimmed.length < FIGURE_LABEL_MAX_CHARS &&
    !/[.!?]$/.test(trimmed)
  );
}

/**
 * Detect figure labels on a page by identifying clusters of short non-sentence text blocks.
 * Returns a Set of block indices that should be marked as figure labels.
 */
export function detectFigureLabels(
  blocks: StructuredBlock[],
  avgFontSize: number
): Set<number> {
  const labelBlockIndices = new Set<number>();

  // Find blocks that look like figure labels
  const potentialLabels: Array<{ index: number; text: string }> = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const text = block.lines
      .map((l) => l.text)
      .join(" ")
      .trim();

    if (isPotentialFigureLabel(text)) {
      // Exclude section headings (by pattern or styling)
      if (isSectionHeadingPattern(text)) continue;
      if (isStyledAsHeading(block, avgFontSize)) continue;

      potentialLabels.push({ index: i, text });
    }
  }

  // If page has enough short non-sentence blocks, mark them as figure labels
  if (potentialLabels.length >= FIGURE_LABEL_MIN_BLOCKS) {
    for (const { index } of potentialLabels) {
      labelBlockIndices.add(index);
    }
  }

  return labelBlockIndices;
}

// ============================================================================
// REFERENCE CITATION DETECTION
// ============================================================================

/**
 * Detect reference citations in text (superscripts, bracketed numbers, etc.).
 * Returns array of {start, end} positions for each detected reference.
 */
export function detectReferences(
  text: string
): Array<{ start: number; end: number }> {
  const references: Array<{ start: number; end: number }> = [];

  // Apply each pattern
  for (const pattern of REFERENCE_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      references.push({
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  // Sort by start position
  references.sort((a, b) => a.start - b.start);

  // Merge overlapping ranges
  const merged: Array<{ start: number; end: number }> = [];
  for (const ref of references) {
    const last = merged[merged.length - 1];
    if (last && ref.start <= last.end) {
      // Overlapping, extend the previous range
      last.end = Math.max(last.end, ref.end);
    } else {
      merged.push({ ...ref });
    }
  }

  return merged;
}

// ============================================================================
// URL & EMAIL DETECTION
// ============================================================================

/**
 * Detect URLs in text.
 * Matches:
 * - http(s):// URLs
 * - www. URLs
 * - domain.tld/path URLs (where tld is a known extension like .com, .org, .fr, etc.)
 *
 * Returns array of {start, end} positions for each detected URL.
 */
export function detectURLs(
  text: string
): Array<{ start: number; end: number }> {
  const urls: Array<{ start: number; end: number }> = [];

  URL_PATTERN.lastIndex = 0;
  let match;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    // Clean trailing punctuation that's likely not part of the URL
    let url = match[0];
    let end = match.index + url.length;

    // Remove trailing punctuation that's commonly not part of URLs
    while (url.length > 0 && /[.,;:!?)}\]>]$/.test(url)) {
      url = url.slice(0, -1);
      end--;
    }

    if (url.length > 0) {
      urls.push({ start: match.index, end });
    }
  }

  return urls;
}

/**
 * Detect email addresses in text.
 * Returns array of {start, end} positions for each detected email.
 */
export function detectEmails(
  text: string
): Array<{ start: number; end: number }> {
  const emails: Array<{ start: number; end: number }> = [];

  EMAIL_PATTERN.lastIndex = 0;
  let match;
  while ((match = EMAIL_PATTERN.exec(text)) !== null) {
    emails.push({ start: match.index, end: match.index + match[0].length });
  }

  return emails;
}
