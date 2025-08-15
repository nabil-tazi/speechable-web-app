// features/documents/utils.ts

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
