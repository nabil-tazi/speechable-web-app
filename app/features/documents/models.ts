import type {
  Document,
  DocumentVersion,
  DocumentWithVersions,
  DocumentVersionWithAudio,
  UserStorageUsage,
} from "./types";
import { createClient } from "@/app/lib/supabase/server";

// DOCUMENT FUNCTIONS

/**
 * Get all documents for a user
 */
export async function getUserDocuments(userId: string): Promise<Document[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("user_id", userId)
    .order("upload_date", { ascending: false });

  if (error) throw error;
  return data as Document[];
}

/**
 * Get all documents for a user WITH their versions
 */
export async function getUserDocumentsWithVersions(
  userId: string
): Promise<DocumentWithVersions[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("documents")
    .select(
      `
      *,
      versions:document_versions(*)
    `
    )
    .eq("user_id", userId)
    .order("upload_date", { ascending: false });

  if (error) throw error;
  return data as DocumentWithVersions[];
}

/**
 * Get a specific document with all its versions and audio
 */
export async function getDocumentWithFullHierarchy(documentId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("documents")
    .select(
      `
      *,
      versions:document_versions(
        *,
        audio_versions(
          *,
          segments:audio_segments(*)
        )
      )
    `
    )
    .eq("id", documentId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Create a new document
 */
export async function createDocument(
  document: Omit<Document, "id" | "upload_date" | "updated_at" | "user_id">
): Promise<Document> {
  const supabase = await createClient();

  // Get current user from server-side session
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  const { data, error } = await supabase
    .from("documents")
    .insert({
      ...document,
      user_id: user.id, // Add user_id automatically
    })
    .select()
    .single();

  if (error) throw error;
  return data as Document;
}

/**
 * Update document metadata
 */
export async function updateDocument(
  documentId: string,
  updates: Partial<Omit<Document, "id" | "user_id" | "upload_date">>
): Promise<Document> {
  const supabase = await createClient();

  // Verify user owns the document
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  const { data, error } = await supabase
    .from("documents")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("user_id", user.id) // Security: only update own documents
    .select()
    .single();

  if (error) throw error;
  return data as Document;
}

/**
 * Search documents by filename
 */
export async function searchUserDocuments(
  userId: string,
  searchTerm: string
): Promise<Document[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("user_id", userId)
    .ilike("original_filename", `%${searchTerm}%`)
    .order("upload_date", { ascending: false });

  if (error) throw error;
  return data as Document[];
}

// DOCUMENT VERSION FUNCTIONS

/**
 * Create a new document version
 */
export async function createDocumentVersion(
  versionData: Omit<DocumentVersion, "id" | "created_at">
): Promise<DocumentVersion> {
  const supabase = await createClient();

  // Verify user owns the document
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  // Check document ownership
  const { data: document } = await supabase
    .from("documents")
    .select("user_id")
    .eq("id", versionData.document_id)
    .single();

  if (!document || document.user_id !== user.id) {
    throw new Error("Document not found or access denied");
  }

  const { data, error } = await supabase
    .from("document_versions")
    .insert(versionData)
    .select()
    .single();

  if (error) throw error;
  return data as DocumentVersion;
}

/**
 * Get all versions for a document
 */
export async function getDocumentVersions(
  documentId: string
): Promise<DocumentVersion[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("document_versions")
    .select("*")
    .eq("document_id", documentId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data as DocumentVersion[];
}

/**
 * Get a specific document version with audio
 */
export async function getDocumentVersionWithAudio(
  versionId: string
): Promise<DocumentVersionWithAudio> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("document_versions")
    .select(
      `
      *,
      audio_versions(
        *,
        segments:audio_segments(*)
      )
    `
    )
    .eq("id", versionId)
    .single();

  if (error) throw error;
  return data as DocumentVersionWithAudio;
}

/**
 * Update document version
 */
export async function updateDocumentVersion(
  versionId: string,
  updates: Partial<Omit<DocumentVersion, "id" | "document_id" | "created_at">>
): Promise<DocumentVersion> {
  const supabase = await createClient();

  // Verify user owns the document version
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  const { data, error } = await supabase
    .from("document_versions")
    .update(updates)
    .eq("id", versionId)
    .select()
    .single();

  if (error) throw error;
  return data as DocumentVersion;
}

// FILE UPLOAD FUNCTIONS

/**
 * Helper function to generate thumbnail URL from path
 * NOTE: This should be used client-side only
 */
export function getThumbnailUrl(thumbnailPath: string): string {
  if (!thumbnailPath) return "";

  // This creates a client instance for URL generation only
  // Consider moving this to a client-side utility
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${supabaseUrl}/storage/v1/object/public/document-thumbnails/${thumbnailPath}`;
}

/**
 * Upload thumbnail for a document
 */
export async function uploadDocumentThumbnail(
  documentId: string,
  thumbnailData: string | File // Accept both data URL and File
): Promise<string> {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  const filePath = `${user.id}/${documentId}.png`;
  let uploadData: Buffer | File;
  let contentType = "image/png";

  if (typeof thumbnailData === "string") {
    // Handle data URL
    const base64Data = thumbnailData.split(",")[1];
    uploadData = Buffer.from(base64Data, "base64");
  } else {
    // Handle File object
    uploadData = thumbnailData;
    contentType = thumbnailData.type;
  }

  const { error: uploadError } = await supabase.storage
    .from("document-thumbnails")
    .upload(filePath, uploadData, {
      contentType,
      cacheControl: "3600",
      upsert: true,
    });

  if (uploadError) throw uploadError;

  // Update document record
  const { error: updateError } = await supabase
    .from("documents")
    .update({ thumbnail_path: filePath })
    .eq("id", documentId)
    .eq("user_id", user.id); // Security: only update own documents

  if (updateError) throw updateError;

  return filePath;
}

/**
 * Delete thumbnail file and update database
 */
export async function deleteDocumentThumbnail(
  documentId: string
): Promise<void> {
  const supabase = await createClient();

  // Verify user owns the document
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  // Get current thumbnail path
  const { data: document } = await supabase
    .from("documents")
    .select("thumbnail_path")
    .eq("id", documentId)
    .eq("user_id", user.id)
    .single();

  if (document?.thumbnail_path) {
    // Delete from storage
    await supabase.storage
      .from("document-thumbnails")
      .remove([document.thumbnail_path]);
  }

  // Update database
  const { error } = await supabase
    .from("documents")
    .update({ thumbnail_path: null })
    .eq("id", documentId)
    .eq("user_id", user.id);

  if (error) throw error;
}

// STORAGE MANAGEMENT FUNCTIONS

/**
 * Get user's current storage usage
 */
export async function getUserStorageUsage(
  userId: string
): Promise<UserStorageUsage> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("user_storage_usage")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  // If no record exists, create one
  if (!data) {
    await updateUserStorageUsage(userId);
    return getUserStorageUsage(userId);
  }

  return data;
}

/**
 * Update user's storage calculation
 */
export async function updateUserStorageUsage(userId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("update_user_storage_usage", {
    target_user_id: userId,
  });

  if (error) throw error;
}

/**
 * Check available storage for user
 */
export async function getUserAvailableAudioStorage(
  userId: string
): Promise<number> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "get_user_available_audio_storage",
    {
      target_user_id: userId,
    }
  );

  if (error) throw error;
  return data;
}

/**
 * Set user's storage limit
 */
export async function setUserStorageLimit(
  userId: string,
  maxBytes: number
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from("user_storage_usage").upsert({
    user_id: userId,
    max_audio_bytes: maxBytes,
  });

  if (error) throw error;
}

/**
 * Get storage usage percentage
 */
export async function getUserStoragePercentage(
  userId: string
): Promise<number> {
  const usage = await getUserStorageUsage(userId);
  return (usage.total_audio_bytes / usage.max_audio_bytes) * 100;
}

// DELETE FUNCTIONS

/**
 * Delete document and all associated files
 */
export async function deleteDocument(documentId: string): Promise<void> {
  const supabase = await createClient();

  // Verify user owns the document
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  // Get all associated files for cleanup
  const { data: document } = await supabase
    .from("documents")
    .select(
      `
      thumbnail_path,
      versions:document_versions(
        audio_versions(
          segments:audio_segments(audio_path)
        )
      )
    `
    )
    .eq("id", documentId)
    .eq("user_id", user.id)
    .single();

  if (!document) {
    throw new Error("Document not found or access denied");
  }

  // Collect all file paths to delete
  const filesToDelete: string[] = [];

  if (document.thumbnail_path) {
    filesToDelete.push(document.thumbnail_path);
  }

  document.versions?.forEach((version) => {
    version.audio_versions?.forEach((audioVersion) => {
      audioVersion.segments?.forEach((segment) => {
        if (segment.audio_path) {
          filesToDelete.push(segment.audio_path);
        }
      });
    });
  });

  // Delete files from storage
  if (filesToDelete.length > 0) {
    const thumbnailFiles = filesToDelete.filter(
      (path) => path.includes(user.id) // Additional safety check
    );
    const audioFiles = filesToDelete.filter(
      (path) => path.includes(user.id) && !path.includes("thumbnail")
    );

    if (thumbnailFiles.length > 0) {
      await supabase.storage.from("document-thumbnails").remove(thumbnailFiles);
    }
    if (audioFiles.length > 0) {
      await supabase.storage.from("version-audio").remove(audioFiles);
    }
  }

  // Delete document (CASCADE will handle related records)
  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("id", documentId)
    .eq("user_id", user.id);

  if (error) throw error;
}

/**
 * Delete document version and all associated audio
 */
export async function deleteDocumentVersion(versionId: string): Promise<void> {
  const supabase = await createClient();

  // Verify user owns the document version
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error("User not authenticated");
  }

  // Get all associated audio files for cleanup
  const { data: version } = await supabase
    .from("document_versions")
    .select(
      `
      audio_versions(
        segments:audio_segments(audio_path)
      ),
      document:documents!inner(user_id)
    `
    )
    .eq("id", versionId)
    .eq("document.user_id", user.id)
    .single();

  if (!version) {
    throw new Error("Document version not found or access denied");
  }

  // Collect audio file paths
  const audioFiles: string[] = [];
  version.audio_versions?.forEach((audioVersion) => {
    audioVersion.segments?.forEach((segment) => {
      if (segment.audio_path) {
        audioFiles.push(segment.audio_path);
      }
    });
  });

  // Delete audio files from storage
  if (audioFiles.length > 0) {
    await supabase.storage.from("version-audio").remove(audioFiles);
  }

  // Delete version (CASCADE will handle related records)
  const { error } = await supabase
    .from("document_versions")
    .delete()
    .eq("id", versionId);

  if (error) throw error;
}
