/**
 * Assigns default voices based on the number of unique readers.
 * - 1 reader: Heart (female)
 * - 2 readers: George (male) + Heart (female)
 * - 3+ readers: cycles through additional voices
 */

const SINGLE_READER_VOICE = "af_heart"; // Heart - female

const MULTI_READER_VOICES = [
  "bm_george",  // George - male (primary for multi-reader)
  "af_heart",   // Heart - female (secondary for multi-reader)
  "af_bella",   // Bella - female
  "am_fenrir",  // Fenrir - male
  "bf_emma",    // Emma - female (British)
  "am_michael", // Michael - male
];

/**
 * Assigns default voices to reader IDs based on the number of readers.
 * @param readerIds - Array of unique reader IDs
 * @returns A voice map (reader_id -> voice_id)
 */
export function assignDefaultVoices(readerIds: string[]): Record<string, string> {
  const voiceMap: Record<string, string> = {};

  if (readerIds.length === 1) {
    // Single reader: use Heart
    voiceMap[readerIds[0]] = SINGLE_READER_VOICE;
  } else {
    // Multiple readers: George first, Heart second, then cycle through others
    readerIds.forEach((readerId, index) => {
      voiceMap[readerId] = MULTI_READER_VOICES[index % MULTI_READER_VOICES.length];
    });
  }

  return voiceMap;
}
