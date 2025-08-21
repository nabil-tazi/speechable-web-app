import { supabase } from "../lib/supabase";

// Memoized URL generator to avoid recreating URLs
const urlCache = new Map<string, string>();

export function getPublicUrl(
  bucket: string,
  path: string | null
): string | undefined {
  if (!path) return undefined;

  const cacheKey = `${bucket}:${path}`;

  if (urlCache.has(cacheKey)) {
    return urlCache.get(cacheKey)!;
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  urlCache.set(cacheKey, data.publicUrl);

  return data.publicUrl;
}

// For private storage - get signed URL
export async function getSignedUrl(
  bucket: string,
  path: string | null,
  expiresIn: number = 3600 // 1 hour default
): Promise<string | undefined> {
  if (!path) return undefined;

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);

    if (error) {
      console.error("Error creating signed URL:", error);
      return undefined;
    }

    return data.signedUrl;
  } catch (error) {
    console.error("Error creating signed URL:", error);
    return undefined;
  }
}

// Convenience functions for specific buckets
export const getThumbnailUrl = (path: string | null) =>
  getSignedUrl("document-thumbnails", path);

export const getAvatarUrl = (path: string | null) =>
  getPublicUrl("avatars", path);

export const getAudioUrl = (path: string | null) =>
  getSignedUrl("audio-segments", path);
