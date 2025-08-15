// features/audio/models.ts
// Server-side functions using server client

import { createClient } from "@/app/lib/supabase/server";
import type {
  AudioVersion,
  AudioSegment,
  AudioVersionWithSegments,
  AudioSegmentWithVersion,
} from "./types";

// AUDIO VERSION FUNCTIONS

/**
 * Create a new audio version
 */
export async function createAudioVersion(
  audioVersionData: Omit<AudioVersion, "id" | "created_at">
): Promise<AudioVersion> {
  const supabase = await createClient();

  // Verify user owns the document version
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  // Check document ownership
  const { data: docVersion } = await supabase
    .from("document_versions")
    .select(
      `
      document:documents!inner(user_id)
    `
    )
    .eq("id", audioVersionData.document_version_id)
    .eq("document.user_id", user.id)
    .single();

  if (!docVersion) {
    throw new Error("Document version not found or access denied");
  }

  const { data, error } = await supabase
    .from("audio_versions")
    .insert(audioVersionData)
    .select()
    .single();

  if (error) throw error;
  return data as AudioVersion;
}

/**
 * Get audio versions for a document version
 */
export async function getAudioVersions(
  documentVersionId: string
): Promise<AudioVersionWithSegments[]> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  const { data, error } = await supabase
    .from("audio_versions")
    .select(
      `
      *,
      segments:audio_segments(*),
      document_version:document_versions!inner(
        document:documents!inner(user_id)
      )
    `
    )
    .eq("document_version_id", documentVersionId)
    .eq("document_version.document.user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data as AudioVersionWithSegments[];
}

/**
 * Get a specific audio version with segments
 */
export async function getAudioVersionWithSegments(
  audioVersionId: string
): Promise<AudioVersionWithSegments> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  const { data, error } = await supabase
    .from("audio_versions")
    .select(
      `
      *,
      segments:audio_segments(*),
      document_version:document_versions!inner(
        document:documents!inner(user_id)
      )
    `
    )
    .eq("id", audioVersionId)
    .eq("document_version.document.user_id", user.id)
    .single();

  if (error) throw error;
  return data as AudioVersionWithSegments;
}

/**
 * Update audio version settings
 */
export async function updateAudioVersion(
  audioVersionId: string,
  updates: Partial<
    Omit<AudioVersion, "id" | "document_version_id" | "created_at">
  >
): Promise<AudioVersion> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  // Verify ownership
  const { data: audioVersion } = await supabase
    .from("audio_versions")
    .select(
      `
      document_version:document_versions!inner(
        document:documents!inner(user_id)
      )
    `
    )
    .eq("id", audioVersionId)
    .eq("document_version.document.user_id", user.id)
    .single();

  if (!audioVersion) {
    throw new Error("Audio version not found or access denied");
  }

  const { data, error } = await supabase
    .from("audio_versions")
    .update(updates)
    .eq("id", audioVersionId)
    .select()
    .single();

  if (error) throw error;
  return data as AudioVersion;
}

// AUDIO SEGMENT FUNCTIONS

/**
 * Create a new audio segment with file upload
 */
export async function createAudioSegment(
  segmentData: Omit<
    AudioSegment,
    "id" | "created_at" | "audio_path" | "audio_file_size"
  >,
  audioFile: File
): Promise<AudioSegment> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  // Check storage limit
  const { data: availableBytes, error: storageError } = await supabase.rpc(
    "get_user_available_audio_storage",
    { target_user_id: user.id }
  );

  if (storageError) {
    throw new Error("Failed to check storage limit");
  }

  if (audioFile.size > availableBytes) {
    throw new Error(
      `Storage limit exceeded. Available: ${formatBytes(
        availableBytes
      )}, Required: ${formatBytes(audioFile.size)}`
    );
  }

  // Verify ownership
  const { data: audioVersion } = await supabase
    .from("audio_versions")
    .select(
      `
      document_version:document_versions!inner(
        document:documents!inner(user_id)
      )
    `
    )
    .eq("id", segmentData.audio_version_id)
    .eq("document_version.document.user_id", user.id)
    .single();

  if (!audioVersion) {
    throw new Error("Audio version not found or access denied");
  }

  // Upload audio file
  const audioPath = await uploadAudioSegment(
    user.id,
    segmentData.audio_version_id,
    segmentData.segment_number,
    audioFile
  );

  // Create segment record
  const { data, error } = await supabase
    .from("audio_segments")
    .insert({
      ...segmentData,
      audio_path: audioPath,
      audio_file_size: audioFile.size,
    })
    .select()
    .single();

  if (error) throw error;
  return data as AudioSegment;
}

/**
 * Get segments for an audio version
 */
export async function getAudioSegments(
  audioVersionId: string
): Promise<AudioSegment[]> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  const { data, error } = await supabase
    .from("audio_segments")
    .select(
      `
      *,
      audio_version:audio_versions!inner(
        document_version:document_versions!inner(
          document:documents!inner(user_id)
        )
      )
    `
    )
    .eq("audio_version_id", audioVersionId)
    .eq("audio_version.document_version.document.user_id", user.id)
    .order("segment_number", { ascending: true });

  if (error) throw error;
  return data as AudioSegment[];
}

/**
 * Get a specific audio segment with version info
 */
export async function getAudioSegmentWithVersion(
  segmentId: string
): Promise<AudioSegmentWithVersion> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  const { data, error } = await supabase
    .from("audio_segments")
    .select(
      `
      *,
      audio_version:audio_versions!inner(
        document_version:document_versions!inner(
          document:documents!inner(user_id)
        )
      )
    `
    )
    .eq("id", segmentId)
    .eq("audio_version.document_version.document.user_id", user.id)
    .single();

  if (error) throw error;
  return data as AudioSegmentWithVersion;
}

/**
 * Update audio segment metadata
 */
export async function updateAudioSegment(
  segmentId: string,
  updates: Partial<
    Omit<
      AudioSegment,
      | "id"
      | "audio_version_id"
      | "created_at"
      | "audio_path"
      | "audio_file_size"
    >
  >
): Promise<AudioSegment> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  // Verify ownership
  const { data: segment } = await supabase
    .from("audio_segments")
    .select(
      `
      audio_version:audio_versions!inner(
        document_version:document_versions!inner(
          document:documents!inner(user_id)
        )
      )
    `
    )
    .eq("id", segmentId)
    .eq("audio_version.document_version.document.user_id", user.id)
    .single();

  if (!segment) {
    throw new Error("Audio segment not found or access denied");
  }

  const { data, error } = await supabase
    .from("audio_segments")
    .update(updates)
    .eq("id", segmentId)
    .select()
    .single();

  if (error) throw error;
  return data as AudioSegment;
}

// FILE UPLOAD FUNCTIONS

/**
 * Upload audio segment file
 */
export async function uploadAudioSegment(
  userId: string,
  audioVersionId: string,
  segmentNumber: number,
  audioFile: File
): Promise<string> {
  const supabase = await createClient();

  const fileExt = audioFile.name.split(".").pop();
  const fileName = `${audioVersionId}-segment-${segmentNumber}.${fileExt}`;
  const filePath = `${userId}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from("version-audio")
    .upload(filePath, audioFile, {
      cacheControl: "3600",
      upsert: true,
    });

  if (uploadError) throw uploadError;

  return filePath;
}

/**
 * Replace audio file for an existing segment
 */
export async function replaceAudioSegmentFile(
  segmentId: string,
  newAudioFile: File
): Promise<void> {
  const supabase = await createClient();

  // Verify user owns the segment
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  // Get current segment info and verify ownership
  const { data: segment } = await supabase
    .from("audio_segments")
    .select(
      `
      audio_path, 
      audio_version_id, 
      segment_number, 
      audio_file_size,
      audio_version:audio_versions!inner(
        document_version:document_versions!inner(
          document:documents!inner(user_id)
        )
      )
    `
    )
    .eq("id", segmentId)
    .eq("audio_version.document_version.document.user_id", user.id)
    .single();

  if (!segment) {
    throw new Error("Segment not found or access denied");
  }

  // Check storage (difference between new and old file)
  const sizeDifference = newAudioFile.size - (segment.audio_file_size || 0);
  if (sizeDifference > 0) {
    const { data: availableBytes, error: storageError } = await supabase.rpc(
      "get_user_available_audio_storage",
      { target_user_id: user.id }
    );

    if (storageError) {
      throw new Error("Failed to check storage limit");
    }

    if (sizeDifference > availableBytes) {
      throw new Error(
        `Storage limit exceeded. Additional space needed: ${formatBytes(
          sizeDifference
        )}`
      );
    }
  }

  // Delete old file if it exists
  if (segment.audio_path) {
    await supabase.storage.from("version-audio").remove([segment.audio_path]);
  }

  // Upload new file
  const newAudioPath = await uploadAudioSegment(
    user.id,
    segment.audio_version_id,
    segment.segment_number,
    newAudioFile
  );

  // Update segment record
  const { error } = await supabase
    .from("audio_segments")
    .update({
      audio_path: newAudioPath,
      audio_file_size: newAudioFile.size,
    })
    .eq("id", segmentId);

  if (error) throw error;
}

/**
 * Get signed URL for private files (if using private buckets)
 */
export async function getSignedAudioUrl(
  audioPath: string,
  expiresIn = 3600
): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase.storage
    .from("version-audio")
    .createSignedUrl(audioPath, expiresIn);

  if (error) throw error;
  return data.signedUrl;
}

// DELETE FUNCTIONS

/**
 * Delete audio segment and file
 */
export async function deleteAudioSegment(segmentId: string): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  // Get segment info and verify ownership
  const { data: segment } = await supabase
    .from("audio_segments")
    .select(
      `
      audio_path,
      audio_version:audio_versions!inner(
        document_version:document_versions!inner(
          document:documents!inner(user_id)
        )
      )
    `
    )
    .eq("id", segmentId)
    .eq("audio_version.document_version.document.user_id", user.id)
    .single();

  if (!segment) {
    throw new Error("Audio segment not found or access denied");
  }

  // Delete file from storage
  if (segment.audio_path) {
    await supabase.storage.from("version-audio").remove([segment.audio_path]);
  }

  // Delete database record
  const { error } = await supabase
    .from("audio_segments")
    .delete()
    .eq("id", segmentId);

  if (error) throw error;
}

/**
 * Delete audio version and all its segments
 */
export async function deleteAudioVersion(
  audioVersionId: string
): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  // Verify ownership and get all segments
  const { data: audioVersion } = await supabase
    .from("audio_versions")
    .select(
      `
      segments:audio_segments(audio_path),
      document_version:document_versions!inner(
        document:documents!inner(user_id)
      )
    `
    )
    .eq("id", audioVersionId)
    .eq("document_version.document.user_id", user.id)
    .single();

  if (!audioVersion) {
    throw new Error("Audio version not found or access denied");
  }

  // Delete all audio files
  if (audioVersion.segments && audioVersion.segments.length > 0) {
    const filePaths = audioVersion.segments
      .map((segment) => segment.audio_path)
      .filter(Boolean);

    if (filePaths.length > 0) {
      await supabase.storage.from("version-audio").remove(filePaths);
    }
  }

  // Delete audio version (CASCADE will handle segments)
  const { error } = await supabase
    .from("audio_versions")
    .delete()
    .eq("id", audioVersionId);

  if (error) throw error;
}

// UTILITY FUNCTIONS

/**
 * Get total duration for all segments in an audio version
 */
export async function getTotalAudioDuration(
  audioVersionId: string
): Promise<number> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("audio_segments")
    .select("audio_duration")
    .eq("audio_version_id", audioVersionId);

  if (error) throw error;

  return data.reduce(
    (total, segment) => total + (segment.audio_duration || 0),
    0
  );
}

/**
 * Reorder audio segments
 */
export async function reorderAudioSegments(
  audioVersionId: string,
  segmentOrders: Array<{ segmentId: string; newSegmentNumber: number }>
): Promise<void> {
  const supabase = await createClient();

  // Verify user owns the audio version
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  // Verify ownership
  const { data: audioVersion } = await supabase
    .from("audio_versions")
    .select(
      `
      document_version:document_versions!inner(
        document:documents!inner(user_id)
      )
    `
    )
    .eq("id", audioVersionId)
    .eq("document_version.document.user_id", user.id)
    .single();

  if (!audioVersion) {
    throw new Error("Audio version not found or access denied");
  }

  // Update each segment's number
  for (const { segmentId, newSegmentNumber } of segmentOrders) {
    const { error } = await supabase
      .from("audio_segments")
      .update({ segment_number: newSegmentNumber })
      .eq("id", segmentId)
      .eq("audio_version_id", audioVersionId);

    if (error) throw error;
  }
}

// Helper function
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
