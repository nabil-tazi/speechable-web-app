/**
 * Assigns default voices based on the number of unique readers and target language.
 * - 1 reader: uses language-specific single reader voice
 * - 2+ readers: cycles through language-specific multi-reader voices
 */

import { getLanguageConfig } from "@/app/features/audio/supported-languages";

/**
 * Assigns default voices to reader IDs based on the number of readers and language.
 * @param readerIds - Array of unique reader IDs
 * @param languageCode - ISO 639-1 language code (defaults to "en")
 * @returns A voice map (reader_id -> voice_id)
 */
export function assignDefaultVoices(
  readerIds: string[],
  languageCode: string = "en"
): Record<string, string> {
  const voiceMap: Record<string, string> = {};
  const langConfig = getLanguageConfig(languageCode);

  // Filter out "skip" reader IDs - they don't need voice assignment
  const playableReaderIds = readerIds.filter((id) => id !== "skip");

  if (playableReaderIds.length === 0) {
    return voiceMap;
  }

  if (playableReaderIds.length === 1) {
    // Single reader: use language-specific default
    voiceMap[playableReaderIds[0]] = langConfig.singleReaderVoice;
  } else {
    // Multiple readers: cycle through language-specific voices
    playableReaderIds.forEach((readerId, index) => {
      voiceMap[readerId] = langConfig.multiReaderVoices[index % langConfig.multiReaderVoices.length];
    });
  }

  return voiceMap;
}
