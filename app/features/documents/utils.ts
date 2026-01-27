// features/documents/utils.ts

import type { ProcessedText } from "./types";
import { getLanguageConfig } from "@/app/features/audio/supported-languages";

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

/**
 * Extract plain text from processed_text structure
 * Used for AI processing - extracts text from sections for LLM input
 */
export function extractTextFromProcessedText(processedText: ProcessedText): string {
  if (!processedText?.processed_text?.sections) {
    return "";
  }

  return processedText.processed_text.sections
    .map((section) => {
      const title = section.title ? section.title + "\n\n" : "";
      const content = section.content.speech.map((s) => s.text).join(" ");
      return title + content;
    })
    .join("\n\n");
}

export function assignVoicesToReaders(
  processed_text: ProcessedText,
  voices: string[],
  languageCode: string = "en"
): Record<string, string> {
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
  const langConfig = getLanguageConfig(languageCode);

  // If no custom voices provided, use language-specific defaults
  if (!voices || voices.length === 0) {
    if (readerIds.length === 1) {
      result[readerIds[0]] = langConfig.singleReaderVoice;
    } else {
      readerIds.forEach((readerId, index) => {
        result[readerId] = langConfig.multiReaderVoices[index % langConfig.multiReaderVoices.length];
      });
    }
    return result;
  }

  // Use provided voices
  readerIds.forEach((readerId, index) => {
    const candidateVoice = voices[index];
    if (candidateVoice && !usedVoices.has(candidateVoice)) {
      result[readerId] = candidateVoice;
      usedVoices.add(candidateVoice);
    } else {
      // Fallback to language-specific default
      result[readerId] = langConfig.singleReaderVoice;
    }
  });

  return result;
}
