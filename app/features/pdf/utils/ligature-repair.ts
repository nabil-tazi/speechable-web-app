/**
 * Ligature Repair Utility
 *
 * PDF fonts often use ligatures (combined glyphs for ff, fi, fl, ffi, ffl).
 * When the font's Unicode mapping is broken or missing, these ligatures
 * get decoded as incorrect characters (like ¢, £, ¡, etc.) often with
 * spurious spaces.
 *
 * This module detects and repairs common ligature failures.
 */

/**
 * Simple string replacements for ligature artifacts.
 * Format: [searchString, replacement]
 *
 * These are applied with simple string replacement, not regex,
 * to avoid pattern matching bugs.
 */
const LIGATURE_REPLACEMENTS: Array<[string, string]> = [
  // Unicode ligature characters → expanded form
  ["\uFB00", "ff"],  // ﬀ
  ["\uFB01", "fi"],  // ﬁ
  ["\uFB02", "fl"],  // ﬂ
  ["\uFB03", "ffi"], // ﬃ
  ["\uFB04", "ffl"], // ﬄ

  // Common ffi ligature failures (¢ is U+00A2)
  // "a¢ liates" → "affiliates"
  ["\u00A2 ", "ffi"],  // ¢ + space → ffi
  ["\u00A2", "ffi"],   // ¢ alone → ffi

  // Common ffl ligature failures (£ is U+00A3)
  // "ba£ e" → "baffle"
  ["\u00A3 ", "ffl"],  // £ + space → ffl
  ["\u00A3", "ffl"],   // £ alone → ffl

  // Common ff ligature failures (¡ is U+00A1, ¤ is U+00A4)
  // "e¡ect" → "effect", "e¤ect" → "effect"
  ["\u00A1 ", "ff"],   // ¡ + space → ff
  ["\u00A1", "ff"],    // ¡ alone → ff
  ["\u00A4 ", "ff"],   // ¤ + space → ff
  ["\u00A4", "ff"],    // ¤ alone → ff

  // Common fi ligature failures (˜ is U+02DC, … is U+2026)
  // "de˜ne" → "define", "de…ne" → "define"
  ["\u02DC ", "fi"],   // ˜ + space → fi
  ["\u02DC", "fi"],    // ˜ alone → fi
  ["\u2026 ", "fi"],   // … + space → fi
  ["\u2026", "fi"],    // … alone → fi

  // Common fl ligature failures (˚ is U+02DA)
  // "˚ow" → "flow"
  ["\u02DA ", "fl"],   // ˚ + space → fl
  ["\u02DA", "fl"],    // ˚ alone → fl

  // Additional common artifacts
  // ˝ (U+02DD) sometimes used for ffi
  ["\u02DD ", "ffi"],
  ["\u02DD", "ffi"],

  // ˛ (U+02DB) sometimes used for ffl
  ["\u02DB ", "ffl"],
  ["\u02DB", "ffl"],

  // Æ (U+00C6) sometimes used for ff
  ["\u00C6 ", "ff"],
  ["\u00C6", "ff"],

  // Ç (U+00C7) sometimes used for fi
  ["\u00C7 ", "fi"],
  ["\u00C7", "fi"],

  // È (U+00C8) sometimes used for fl
  ["\u00C8 ", "fl"],
  ["\u00C8", "fl"],
];

/**
 * Regex patterns for spaced-out ligatures
 * These occur when MuPDF extracts each glyph of a ligature separately with spaces
 * e.g., "e ff ect" → "effect", "fl owing" → "flowing"
 */
const SPACED_LIGATURE_PATTERNS: Array<[RegExp, string]> = [
  // Spaced ffl: "ba ffl e" → "baffle", "a ffl uent" → "affluent"
  [/([a-zA-Z])\s+ffl\s+([a-zA-Z])/g, "$1ffl$2"],

  // Spaced ffi: "a ffi liate" → "affiliate", "e ffi cient" → "efficient"
  [/([a-zA-Z])\s+ffi\s+([a-zA-Z])/g, "$1ffi$2"],

  // Spaced ff: "e ff ect" → "effect", "a ff ord" → "afford"
  [/([a-zA-Z])\s+ff\s+([a-zA-Z])/g, "$1ff$2"],

  // Spaced fl: "fl owing" → "flowing", "in fl uence" → "influence"
  [/([a-zA-Z])\s+fl\s+([a-zA-Z])/g, "$1fl$2"],
  // fl at start of word: "fl owing" where fl is separate
  [/\bfl\s+([a-z])/g, "fl$1"],

  // Spaced fi: "signi fi cant" → "significant", "de fi ne" → "define"
  [/([a-zA-Z])\s+fi\s+([a-zA-Z])/g, "$1fi$2"],
  // fi at start of word: "fi nding" where fi is separate
  [/\bfi\s+([a-z])/g, "fi$1"],
];

/**
 * Main function to repair all ligature issues in text
 * Uses simple string replacement and regex patterns
 */
export function repairLigatures(text: string): string {
  if (!text) return text;

  let result = text;

  // First, apply simple replacements for ligature characters
  for (const [search, replacement] of LIGATURE_REPLACEMENTS) {
    result = result.split(search).join(replacement);
  }

  // Then, fix spaced-out ligatures (need multiple passes as patterns may overlap)
  // e.g., "a ffi liate" needs the ffi pattern, but "e ff ect" needs ff
  for (let pass = 0; pass < 2; pass++) {
    for (const [pattern, replacement] of SPACED_LIGATURE_PATTERNS) {
      result = result.replace(pattern, replacement);
    }
  }

  return result;
}

/**
 * Check if text likely contains ligature artifacts
 * Useful for logging/debugging
 */
export function hasLigatureArtifacts(text: string): boolean {
  const artifactChars = [
    "\uFB00", "\uFB01", "\uFB02", "\uFB03", "\uFB04", // Unicode ligatures
    "\u00A2", "\u00A3", "\u00A1", "\u00A4", // ¢, £, ¡, ¤
    "\u02DC", "\u02DA", "\u02DD", "\u02DB", // ˜, ˚, ˝, ˛
    "\u00C6", "\u00C7", "\u00C8", // Æ, Ç, È
    "\u2026", // … (ellipsis, sometimes used for fi)
  ];

  return artifactChars.some((char) => text.includes(char));
}
