import { unifiedVoices } from "./voice-constants";
import type { Accent, Gender, Language, Model, Voice } from "./voice-types";

// Helper functions
const getVoicesByModel = (model: Model): Record<Language, Voice[]> => {
  const result: Record<Language, Voice[]> = {} as Record<Language, Voice[]>;
  Object.entries(unifiedVoices).forEach(([lang, voices]) => {
    result[lang as Language] = voices.filter(
      (voice: Voice) => voice.models[model] !== null
    );
  });
  return result;
};

const getVoicesByGender = (language: Language, gender: Gender): Voice[] => {
  return (
    unifiedVoices[language]?.filter(
      (voice: Voice) => voice.gender === gender
    ) || []
  );
};

const getVoicesByAccent = (language: Language, accent: Accent): Voice[] => {
  return (
    unifiedVoices[language]?.filter(
      (voice: Voice) => voice.accent === accent
    ) || []
  );
};

const findVoice = (name: string, language: Language): Voice | undefined => {
  return unifiedVoices[language]?.find((voice: Voice) => voice.name === name);
};

// Statistics
const stats = {
  totalLanguages: Object.keys(unifiedVoices).length,
  totalVoices: Object.values(unifiedVoices).reduce(
    (sum, voices) => sum + voices.length,
    0
  ),
  kokoro: {
    totalVoices: Object.values(unifiedVoices).reduce(
      (sum, voices) =>
        sum + voices.filter((v) => v.models.kokoro !== null).length,
      0
    ),
  },
  lemonfox: {
    totalVoices: Object.values(unifiedVoices).reduce(
      (sum, voices) =>
        sum + voices.filter((v) => v.models.lemonfox !== null).length,
      0
    ),
  },
  sharedVoices: Object.values(unifiedVoices).reduce(
    (sum, voices) =>
      sum +
      voices.filter(
        (v) => v.models.kokoro !== null && v.models.lemonfox !== null
      ).length,
    0
  ),
};

// console.log("Unified Voice Statistics:");
// console.log(`Total Languages: ${stats.totalLanguages}`);
// console.log(`Total Unique Voices: ${stats.totalVoices}`);
// console.log(`Kokoro Voices: ${stats.kokoro.totalVoices}`);
// console.log(`Lemonfox Voices: ${stats.lemonfox.totalVoices}`);
// console.log(`Shared Voices: ${stats.sharedVoices}`);

export {
  unifiedVoices,
  getVoicesByModel,
  getVoicesByGender,
  getVoicesByAccent,
  findVoice,
  stats,
};
