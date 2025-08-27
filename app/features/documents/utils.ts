// features/documents/utils.ts

import type { ProcessedText } from "./types";

/**
 * Generate thumbnail URL from storage path (client-side utility)
 */
export function getThumbnailUrl(thumbnailPath: string): string {
  if (!thumbnailPath) return "";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${supabaseUrl}/storage/v1/object/public/document-thumbnails/${thumbnailPath}`;
}

/**
 * Generate audio URL from storage path (client-side utility)
 */
export function getAudioUrl(audioPath: string): string {
  if (!audioPath) return "";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${supabaseUrl}/storage/v1/object/public/version-audio/${audioPath}`;
}

/**
 * Format bytes for display
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function formatProcessingType(processingLevel: string) {
  switch (processingLevel) {
    case "0":
      return "original";
    case "1":
      return "natural";
    case "2":
      return "lecture";
    case "3":
      return "conversational";
    default:
      return "";
  }
}

export function assignVoicesToReaders(
  processed_text: ProcessedText,
  voices: string[]
): Record<string, string> {
  console.log(processed_text);
  // Collect all unique reader_ids
  const readerIds = Array.from(
    new Set(
      processed_text.processed_text.sections.flatMap((section) =>
        section.content.speech.map((s) => s.reader_id)
      )
    )
  );

  const result: Record<string, string> = {};
  const usedVoices = new Set<string>();

  readerIds.forEach((readerId, index) => {
    // Pick the voice at the same index if available and not already used
    const candidateVoice = voices[index];
    if (candidateVoice && !usedVoices.has(candidateVoice)) {
      result[readerId] = candidateVoice;
      usedVoices.add(candidateVoice);
    } else {
      // Fallback to "onyx"
      result[readerId] = "onyx";
    }
  });

  return result;
}
