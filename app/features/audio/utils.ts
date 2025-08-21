// features/audio/utils.ts

/**
 * Generate audio URL from storage path (client-side utility)
 */
export function getAudioUrl(audioPath: string): string {
  if (!audioPath) return "";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${supabaseUrl}/storage/v1/object/public/audio-segments/${audioPath}`;
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

/**
 * Get audio duration from file (client-side)
 */
// export async function getAudioDuration(audioFile: File): Promise<number> {
//   return new Promise((resolve, reject) => {
//     const audio = new Audio();

//     audio.onloadedmetadata = () => {
//       resolve(audio.duration);
//       URL.revokeObjectURL(audio.src);
//     };

//     audio.onerror = () => {
//       reject(new Error("Failed to load audio file"));
//       URL.revokeObjectURL(audio.src);
//     };

//     audio.src = URL.createObjectURL(audioFile);
//   });
// }

/**
 * Convert seconds to human readable format (e.g., "2:34")
 */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "0:00";

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

/**
 * Convert human readable duration to seconds
 */
export function parseDuration(duration: string): number {
  const parts = duration.split(":");
  if (parts.length !== 2) return 0;

  const minutes = parseInt(parts[0], 10) || 0;
  const seconds = parseInt(parts[1], 10) || 0;

  return minutes * 60 + seconds;
}

/**
 * Check if an audio file type is supported
 */
export function isAudioFileSupported(file: File): boolean {
  const supportedTypes = [
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/mp4",
    "audio/m4a",
    "audio/ogg",
    "audio/webm",
  ];

  return supportedTypes.includes(file.type);
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || "";
}

/**
 * Generate a safe filename for audio segments
 */
export function generateSegmentFilename(
  audioVersionId: string,
  segmentNumber: number,
  originalExtension: string = "mp3"
): string {
  return `${audioVersionId}-segment-${segmentNumber}.${originalExtension}`;
}

/**
 * Calculate total size of multiple audio files
 */
export function calculateTotalFileSize(files: File[]): number {
  return files.reduce((total, file) => total + file.size, 0);
}

/**
 * Sort audio segments by segment number
 */
export function sortSegmentsByNumber<T extends { segment_number: number }>(
  segments: T[]
): T[] {
  return [...segments].sort((a, b) => a.segment_number - b.segment_number);
}

/**
 * Generate segment numbers for bulk upload
 */
export function generateSegmentNumbers(
  count: number,
  startFrom: number = 1
): number[] {
  return Array.from({ length: count }, (_, i) => startFrom + i);
}

/**
 * Validate audio segment data
 */
export function validateSegmentData(segmentData: {
  segment_number: number;
  section_title?: string;
  start_page?: number;
  end_page?: number;
  text_start_index?: number;
  text_end_index?: number;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (segmentData.segment_number < 1) {
    errors.push("Segment number must be greater than 0");
  }

  if (
    segmentData.start_page &&
    segmentData.end_page &&
    segmentData.start_page > segmentData.end_page
  ) {
    errors.push("Start page cannot be greater than end page");
  }

  if (
    segmentData.text_start_index &&
    segmentData.text_end_index &&
    segmentData.text_start_index > segmentData.text_end_index
  ) {
    errors.push("Text start index cannot be greater than text end index");
  }

  if (
    segmentData.section_title &&
    segmentData.section_title.trim().length === 0
  ) {
    errors.push("Section title cannot be empty");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export const getAudioDuration = (audioBlob: Blob): Promise<number> => {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const objectUrl = URL.createObjectURL(audioBlob);

    audio.addEventListener("loadedmetadata", () => {
      URL.revokeObjectURL(objectUrl); // Clean up
      resolve(audio.duration);
    });

    audio.addEventListener("error", (e) => {
      URL.revokeObjectURL(objectUrl); // Clean up
      reject(new Error("Failed to load audio metadata"));
    });

    audio.src = objectUrl;
  });
};

export async function getAudioDurationAccurate(blob: Blob): Promise<number> {
  const audioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)();

  try {
    // Convert blob to ArrayBuffer
    const arrayBuffer = await blob.arrayBuffer();

    // Decode the audio - this gives us the exact duration
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Duration in seconds with full precision
    const duration = audioBuffer.duration;

    return duration;
  } catch (error) {
    console.error("Error decoding audio:", error);
    throw error;
  } finally {
    // Clean up audio context
    await audioContext.close();
  }
}
