/**
 * Supported languages for audio generation.
 * Update this file to add/remove supported languages.
 */

export interface SupportedLanguage {
  code: string;
  name: string;
  // Default voice for single reader (kokoro model ID)
  singleReaderVoice: string;
  // Voices for multi-reader scenarios (alternating male/female when possible)
  multiReaderVoices: string[];
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  {
    code: "en",
    name: "English",
    singleReaderVoice: "af_heart",
    multiReaderVoices: [
      "bm_george",   // George - male (British)
      "af_heart",    // Heart - female
      "af_bella",    // Bella - female
      "am_fenrir",   // Fenrir - male
      "bf_emma",     // Emma - female (British)
      "am_michael",  // Michael - male
    ],
  },
  {
    code: "es",
    name: "Spanish",
    singleReaderVoice: "ef_dora",
    multiReaderVoices: [
      "em_alex",     // Alex - male
      "ef_dora",     // Dora - female
      "em_santa",    // Noel - male
    ],
  },
  {
    code: "fr",
    name: "French",
    singleReaderVoice: "ff_siwis",
    multiReaderVoices: [
      "ff_siwis",    // Siwis - female (only voice available)
    ],
  },
  {
    code: "it",
    name: "Italian",
    singleReaderVoice: "if_sara",
    multiReaderVoices: [
      "im_nicola",   // Nicola - male
      "if_sara",     // Sara - female
    ],
  },
  {
    code: "pt",
    name: "Portuguese",
    singleReaderVoice: "pf_dora",
    multiReaderVoices: [
      "pm_alex",     // Alex - male
      "pf_dora",     // Dora - female
      "pm_santa",    // Papai - male
    ],
  },
  {
    code: "ja",
    name: "Japanese",
    singleReaderVoice: "jf_alpha",
    multiReaderVoices: [
      "jm_kumo",     // Kumo - male
      "jf_alpha",    // Alpha - female
      "jf_gongitsune", // Gongitsune - female
      "jf_nezumi",   // Nezumi - female
    ],
  },
  {
    code: "zh",
    name: "Mandarin",
    singleReaderVoice: "zf_xiaobei",
    multiReaderVoices: [
      "zm_yunxi",    // Yunxi - male
      "zf_xiaobei",  // Xiaobei - female
      "zm_yunjian",  // Yunjian - male
      "zf_xiaoni",   // Xiaoni - female
    ],
  },
  {
    code: "hi",
    name: "Hindi",
    singleReaderVoice: "hf_alpha",
    multiReaderVoices: [
      "hm_omega",    // Omega - male
      "hf_alpha",    // Alpha - female
      "hm_psi",      // Psi - male
      "hf_beta",     // Beta - female
    ],
  },
];

// Map for quick lookup by language code
export const SUPPORTED_LANGUAGES_MAP = new Map(
  SUPPORTED_LANGUAGES.map((lang) => [lang.code, lang])
);

// Array of just the language codes
export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((lang) => lang.code);

// Get language config, fallback to English if not found
export function getLanguageConfig(languageCode: string): SupportedLanguage {
  return SUPPORTED_LANGUAGES_MAP.get(languageCode) || SUPPORTED_LANGUAGES[0];
}
