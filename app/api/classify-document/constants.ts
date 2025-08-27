import {
  BookOpen,
  BookText,
  DollarSign,
  File,
  GraduationCap,
  Newspaper,
  Scale,
  Settings,
} from "lucide-react";

// ISO 639-1 language codes with their display names
export const LANGUAGE_MAP = new Map([
  ["en", "English"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["ru", "Russian"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh", "Chinese"],
  ["ar", "Arabic"],
  ["hi", "Hindi"],
  ["tr", "Turkish"],
  ["pl", "Polish"],
  ["nl", "Dutch"],
  ["sv", "Swedish"],
  ["da", "Danish"],
  ["no", "Norwegian"],
  ["fi", "Finnish"],
  ["cs", "Czech"],
  ["hu", "Hungarian"],
  ["ro", "Romanian"],
  ["bg", "Bulgarian"],
  ["hr", "Croatian"],
  ["sk", "Slovak"],
  ["sl", "Slovenian"],
  ["et", "Estonian"],
  ["lv", "Latvian"],
  ["lt", "Lithuanian"],
  ["el", "Greek"],
  ["he", "Hebrew"],
  ["th", "Thai"],
  ["vi", "Vietnamese"],
  ["id", "Indonesian"],
  ["ms", "Malay"],
  ["tl", "Filipino"],
  ["uk", "Ukrainian"],
  ["be", "Belarusian"],
  ["ka", "Georgian"],
  ["hy", "Armenian"],
  ["az", "Azerbaijani"],
  ["kk", "Kazakh"],
  ["ky", "Kyrgyz"],
  ["uz", "Uzbek"],
  ["mn", "Mongolian"],
  ["ne", "Nepali"],
  ["si", "Sinhala"],
  ["my", "Burmese"],
  ["km", "Khmer"],
  ["lo", "Lao"],
  ["is", "Icelandic"],
  ["mt", "Maltese"],
  ["ga", "Irish"],
  ["cy", "Welsh"],
  ["eu", "Basque"],
  ["ca", "Catalan"],
  ["gl", "Galician"],
  ["af", "Afrikaans"],
  ["sw", "Swahili"],
  ["am", "Amharic"],
  ["or", "Odia"],
  ["bn", "Bengali"],
  ["gu", "Gujarati"],
  ["kn", "Kannada"],
  ["ml", "Malayalam"],
  ["mr", "Marathi"],
  ["pa", "Punjabi"],
  ["ta", "Tamil"],
  ["te", "Telugu"],
  ["ur", "Urdu"],
  ["fa", "Persian"],
  ["ps", "Pashto"],
  ["sd", "Sindhi"],
]);

export const VALID_LANGUAGE_CODES = new Set(LANGUAGE_MAP.keys());

// Helper function to get language name from code
export const getLanguageName = (code: string): string => {
  return LANGUAGE_MAP.get(code.toLowerCase()) || code.toUpperCase();
};

// Alternative: if you prefer an array format
export const DOCUMENT_TYPE_CONFIG = {
  general: {
    icon: File,
    label: "General",
    className: "bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-200",
  },
  academic: {
    icon: GraduationCap,
    label: "Academic",
    className: "bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200",
  },
  legal: {
    icon: Scale,
    label: "Legal",
    className:
      "bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-200",
  },
  financial: {
    icon: DollarSign,
    label: "Financial",
    className:
      "bg-green-100 text-green-800 border-green-200 hover:bg-green-200",
  },
  technical: {
    icon: Settings,
    label: "Technical",
    className:
      "bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-200",
  },
  manual: {
    icon: BookOpen,
    label: "Manual",
    className:
      "bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-200",
  },
  news: {
    icon: Newspaper,
    label: "News",
    className: "bg-red-100 text-red-800 border-red-200 hover:bg-red-200",
  },
  literature: {
    icon: BookText,
    label: "Literature",
    className:
      "bg-indigo-100 text-indigo-800 border-indigo-200 hover:bg-indigo-200",
  },
} as const;
