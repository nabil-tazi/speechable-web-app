import { supabase } from "../lib/supabase";

// Memoized URL generator to avoid recreating URLs
const urlCache = new Map<string, string>();

export function getPublicUrl(
  bucket: string,
  path: string | null
): string | undefined {
  if (!path) return undefined; // Change from null to undefined

  const cacheKey = `${bucket}:${path}`;

  if (urlCache.has(cacheKey)) {
    return urlCache.get(cacheKey)!;
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  urlCache.set(cacheKey, data.publicUrl);

  return data.publicUrl;
}

// Convenience functions for your specific buckets
export const getThumbnailUrl = (path: string | null) =>
  getPublicUrl("document-thumbnails", path);

export const getAvatarUrl = (path: string | null) =>
  getPublicUrl("avatars", path);
