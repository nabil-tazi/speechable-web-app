"use server";

import { createClient } from "@/app/lib/supabase/server";
import type {
  AudioVersion,
  AudioSegment,
  AudioVersionWithSegments,
  AudioSegmentWithVersion,
} from "./types";

// AUDIO VERSION ACTIONS

/**
 * Server Action: Create a new audio version
 */
export async function createAudioVersionAction(
  audioVersionData: Omit<AudioVersion, "id" | "created_at">
): Promise<{ data: AudioVersion | null; error: string | null }> {
  try {
    const supabase = await createClient();

    // Verify user owns the document version
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { data: null, error: "User not authenticated" };
    }

    // Check document ownership through document_versions -> documents
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
      return {
        data: null,
        error: "Document version not found or access denied",
      };
    }

    const { data, error } = await supabase
      .from("audio_versions")
      .insert(audioVersionData)
      .select()
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as AudioVersion, error: null };
  } catch (error) {
    return { data: null, error: "Failed to create audio version" };
  }
}

/**
 * Server Action: Get audio versions for a document version
 */
export async function getAudioVersionsAction(
  documentVersionId: string
): Promise<{ data: AudioVersionWithSegments[] | null; error: string | null }> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { data: null, error: "User not authenticated" };
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

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as AudioVersionWithSegments[], error: null };
  } catch (error) {
    return { data: null, error: "Failed to get audio versions" };
  }
}

/**
 * Server Action: Update audio version settings
 */
export async function updateAudioVersionAction(
  audioVersionId: string,
  updates: Partial<
    Omit<AudioVersion, "id" | "document_version_id" | "created_at">
  >
): Promise<{ data: AudioVersion | null; error: string | null }> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { data: null, error: "User not authenticated" };
    }

    // Verify ownership through the chain
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
      return { data: null, error: "Audio version not found or access denied" };
    }

    const { data, error } = await supabase
      .from("audio_versions")
      .update(updates)
      .eq("id", audioVersionId)
      .select()
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as AudioVersion, error: null };
  } catch (error) {
    return { data: null, error: "Failed to update audio version" };
  }
}

// AUDIO SEGMENT ACTIONS

/**
 * Server Action: Create a new audio segment with file upload
 */
export async function createAudioSegmentAction(
  segmentData: Omit<
    AudioSegment,
    "id" | "created_at" | "audio_path" | "audio_file_size"
  >,
  audioFile: File
): Promise<{ data: AudioSegment | null; error: string | null }> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { data: null, error: "User not authenticated" };
    }

    // Check storage limit
    const { data: availableBytes, error: storageError } = await supabase.rpc(
      "get_user_available_audio_storage",
      { target_user_id: user.id }
    );

    if (storageError) {
      return { data: null, error: "Failed to check storage limit" };
    }

    if (audioFile.size > availableBytes) {
      return {
        data: null,
        error: `Storage limit exceeded. Available: ${formatBytes(
          availableBytes
        )}, Required: ${formatBytes(audioFile.size)}`,
      };
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
      return { data: null, error: "Audio version not found or access denied" };
    }

    // Upload audio file
    const fileExt = audioFile.name.split(".").pop();
    const fileName = `${segmentData.audio_version_id}-segment-${segmentData.segment_number}.${fileExt}`;
    const filePath = `${user.id}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from("version-audio")
      .upload(filePath, audioFile, {
        cacheControl: "3600",
        upsert: true,
      });

    if (uploadError) {
      return { data: null, error: uploadError.message };
    }

    // Create segment record
    const { data, error } = await supabase
      .from("audio_segments")
      .insert({
        ...segmentData,
        audio_path: filePath,
        audio_file_size: audioFile.size,
      })
      .select()
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as AudioSegment, error: null };
  } catch (error) {
    return { data: null, error: "Failed to create audio segment" };
  }
}

/**
 * Server Action: Get segments for an audio version
 */
export async function getAudioSegmentsAction(
  audioVersionId: string
): Promise<{ data: AudioSegment[] | null; error: string | null }> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { data: null, error: "User not authenticated" };
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

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as AudioSegment[], error: null };
  } catch (error) {
    return { data: null, error: "Failed to get audio segments" };
  }
}

/**
 * Server Action: Update audio segment metadata
 */
export async function updateAudioSegmentAction(
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
): Promise<{ data: AudioSegment | null; error: string | null }> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { data: null, error: "User not authenticated" };
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
      return { data: null, error: "Audio segment not found or access denied" };
    }

    const { data, error } = await supabase
      .from("audio_segments")
      .update(updates)
      .eq("id", segmentId)
      .select()
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as AudioSegment, error: null };
  } catch (error) {
    return { data: null, error: "Failed to update audio segment" };
  }
}

/**
 * Server Action: Delete audio segment and file
 */
export async function deleteAudioSegmentAction(
  segmentId: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "User not authenticated" };
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
      return {
        success: false,
        error: "Audio segment not found or access denied",
      };
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

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: "Failed to delete audio segment" };
  }
}

/**
 * Server Action: Delete audio version and all its segments
 */
export async function deleteAudioVersionAction(
  audioVersionId: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "User not authenticated" };
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
      return {
        success: false,
        error: "Audio version not found or access denied",
      };
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

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: "Failed to delete audio version" };
  }
}

// Helper function for formatting bytes (used in error messages)
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
