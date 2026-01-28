"use server";

import { createClient } from "@/app/lib/supabase/server";
import type { Block, Document, DocumentVersion, DocumentWithVersions, VersionStatus } from "./types";
import { convertProcessedTextToBlocks } from "@/app/features/block-editor/utils/convert-to-blocks";

// Server Action: Create a document
export async function createDocumentAction(documentData: {
  mime_type: string;
  file_type: string;
  title: string;
  author: string;
  filename: string;
  document_type: string;
  page_count?: number;
  file_size?: number;
  metadata?: Record<string, any>;
}): Promise<{ data: Document | null; error: string | null }> {
  try {
    const supabase = await createClient();

    // Get current user from server-side session
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { data: null, error: "User not authenticated" };
    }

    const { data, error } = await supabase
      .from("documents")
      .insert({
        ...documentData,
        user_id: user.id, // Add user_id automatically
      })
      .select()
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as DocumentWithVersions, error: null };
  } catch (error) {
    return { data: null, error: "Failed to create document" };
  }
}

// Server Action: Upload thumbnail
export async function uploadDocumentThumbnailAction(
  documentId: string,
  thumbnailData: string | File
): Promise<{ success: boolean; error: string | null }> {
  try {
    const supabase = await createClient();

    // Get current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "User not authenticated" };
    }

    let uploadData: Buffer | File;
    let contentType = "image/png";
    let fileExtension = "png";

    if (typeof thumbnailData === "string") {
      // Handle data URL - extract mime type and data
      const mimeMatch = thumbnailData.match(/^data:([^;]+);base64,/);
      if (mimeMatch) {
        contentType = mimeMatch[1];
        // Get extension from mime type (e.g., image/webp -> webp)
        fileExtension = contentType.split("/")[1] || "png";
      }
      const base64Data = thumbnailData.split(",")[1];
      uploadData = Buffer.from(base64Data, "base64");
    } else {
      // Handle File object - convert to buffer
      const arrayBuffer = await thumbnailData.arrayBuffer();
      uploadData = Buffer.from(arrayBuffer);
      contentType = thumbnailData.type;
      fileExtension = contentType.split("/")[1] || "png";
    }

    const filePath = `${user.id}/${documentId}.${fileExtension}`;

    const { error: uploadError } = await supabase.storage
      .from("document-thumbnails")
      .upload(filePath, uploadData, {
        contentType,
        cacheControl: "3600",
        upsert: true,
      });

    if (uploadError) {
      return { success: false, error: uploadError.message };
    }

    // Update document record
    const { error: updateError } = await supabase
      .from("documents")
      .update({ thumbnail_path: filePath })
      .eq("id", documentId)
      .eq("user_id", user.id);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: "Failed to upload thumbnail" };
  }
}

// Server Action: Get user documents (simple)
export async function getUserDocumentsAction(): Promise<{
  data: Document[] | null;
  error: string | null;
}> {
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
      .from("documents")
      .select("*")
      .eq("user_id", user.id)
      .order("upload_date", { ascending: false });

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as Document[], error: null };
  } catch (error) {
    return { data: null, error: "Failed to get documents" };
  }
}

// Server Action: Get user documents WITH versions
export async function getUserDocumentsWithVersionsAction(): Promise<{
  data: DocumentWithVersions[] | null;
  error: string | null;
}> {
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
      .from("documents")
      .select(
        `
        id,
        user_id,
        title,
        author,
        filename,
        thumbnail_path,
        document_type,
        language,
        file_type,
        page_count,
        file_size,
        upload_date,
        updated_at,
        mime_type,
        versions:document_versions(
          id,
          document_id,
          version_name,
          created_at
        )
      `
      )
      .eq("user_id", user.id)
      .order("upload_date", { ascending: false });

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as DocumentWithVersions[], error: null };
  } catch (error) {
    return { data: null, error: "Failed to get documents with versions" };
  }
}

// Server Action: Get a single document with versions by ID
export async function getDocumentByIdAction(documentId: string): Promise<{
  data: DocumentWithVersions | null;
  error: string | null;
}> {
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
      .from("documents")
      .select(`
        *,
        versions:document_versions(*)
      `)
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();


    if (error) {
      return { data: null, error: error.message };
    }

    // Handle thumbnail URL if present
    if (data && data.thumbnail_path) {
      const { data: signedUrl } = await supabase.storage
        .from("document-thumbnails")
        .createSignedUrl(data.thumbnail_path, 60 * 60); // 1 hour expiry

      if (signedUrl) {
        data.thumbnail_path = signedUrl.signedUrl;
      }
    }

    return { data: data as DocumentWithVersions, error: null };
  } catch (error) {
    return { data: null, error: "Failed to get document" };
  }
}

// Server Action: Update a document
export async function updateDocumentAction(
  documentId: string,
  updates: Partial<Omit<Document, "id" | "user_id" | "upload_date">>
): Promise<{ data: Document | null; error: string | null }> {
  try {
    const supabase = await createClient();

    // Get current user from server-side session
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { data: null, error: "User not authenticated" };
    }

    const { data, error } = await supabase
      .from("documents")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .eq("user_id", user.id) // Security: only update own documents
      .select()
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as Document, error: null };
  } catch (error) {
    return { data: null, error: "Failed to update document" };
  }
}

// Server Action: Create a document version
export async function createDocumentVersionAction(
  versionData: Omit<DocumentVersion, "id" | "created_at">
): Promise<{ data: DocumentVersion | null; error: string | null }> {
  try {
    const supabase = await createClient();

    // Get current user from server-side session
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { data: null, error: "User not authenticated" };
    }

    // Check document ownership
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("user_id")
      .eq("id", versionData.document_id)
      .single();

    if (docError) {
      return { data: null, error: "Failed to verify document ownership" };
    }

    if (!document || document.user_id !== user.id) {
      return { data: null, error: "Document not found or access denied" };
    }

    const { data, error } = await supabase
      .from("document_versions")
      .insert(versionData)
      .select()
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as DocumentVersion, error: null };
  } catch (error) {
    return { data: null, error: "Failed to create document version" };
  }
}

// Server Action: Toggle document starred status
export async function toggleDocumentStarredAction(documentId: string): Promise<{
  data: { is_starred: boolean } | null;
  error: string | null;
}> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { data: null, error: "User not authenticated" };
    }

    // Get current starred status
    const { data: document, error: fetchError } = await supabase
      .from("documents")
      .select("is_starred")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();

    if (fetchError) {
      return { data: null, error: fetchError.message };
    }

    const newStarredStatus = !document.is_starred;

    const { error: updateError } = await supabase
      .from("documents")
      .update({ is_starred: newStarredStatus })
      .eq("id", documentId)
      .eq("user_id", user.id);

    if (updateError) {
      return { data: null, error: updateError.message };
    }

    return { data: { is_starred: newStarredStatus }, error: null };
  } catch (error) {
    return { data: null, error: "Failed to toggle starred status" };
  }
}

// Server Action: Update last_opened timestamp
export async function updateDocumentLastOpenedAction(documentId: string): Promise<{
  success: boolean;
  error: string | null;
}> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "User not authenticated" };
    }

    const { error: updateError } = await supabase
      .from("documents")
      .update({ last_opened: new Date().toISOString() })
      .eq("id", documentId)
      .eq("user_id", user.id);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: "Failed to update last opened" };
  }
}

// Server Action: Get starred documents (for sidebar)
export async function getStarredDocumentsAction(): Promise<{
  data: Pick<Document, "id" | "title">[] | null;
  error: string | null;
}> {
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
      .from("documents")
      .select("id, title")
      .eq("user_id", user.id)
      .eq("is_starred", true)
      .order("title", { ascending: true });

    if (error) {
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch (error) {
    return { data: null, error: "Failed to get starred documents" };
  }
}

// Server Action: Get recent documents (for sidebar)
export async function getRecentDocumentsAction(limit: number = 10): Promise<{
  data: Pick<Document, "id" | "title" | "last_opened">[] | null;
  error: string | null;
}> {
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
      .from("documents")
      .select("id, title, last_opened")
      .eq("user_id", user.id)
      .not("last_opened", "is", null)
      .order("last_opened", { ascending: false })
      .limit(limit);

    if (error) {
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch (error) {
    return { data: null, error: "Failed to get recent documents" };
  }
}

// Server Action: Update document version blocks
export async function updateDocumentVersionBlocksAction(
  versionId: string,
  blocks: Block[]
): Promise<{ data: DocumentVersion | null; error: string | null }> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { data: null, error: "User not authenticated" };
    }

    // Verify ownership through document
    const { data: version } = await supabase
      .from("document_versions")
      .select(
        `
        id,
        document:documents!inner(user_id)
      `
      )
      .eq("id", versionId)
      .single();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = version?.document as any;
    if (!version || !doc || doc.user_id !== user.id) {
      return { data: null, error: "Version not found or access denied" };
    }

    const { data, error } = await supabase
      .from("document_versions")
      .update({
        blocks: blocks,
      })
      .eq("id", versionId)
      .select()
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as DocumentVersion, error: null };
  } catch (error) {
    return { data: null, error: "Failed to update document version blocks" };
  }
}

// Server Action: Update document version name
export async function updateDocumentVersionNameAction(
  versionId: string,
  versionName: string
): Promise<{ data: DocumentVersion | null; error: string | null }> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { data: null, error: "User not authenticated" };
    }

    // Verify ownership through document
    const { data: version } = await supabase
      .from("document_versions")
      .select(
        `
        id,
        document:documents!inner(user_id)
      `
      )
      .eq("id", versionId)
      .single();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = version?.document as any;
    if (!version || !doc || doc.user_id !== user.id) {
      return { data: null, error: "Version not found or access denied" };
    }

    const { data, error } = await supabase
      .from("document_versions")
      .update({
        version_name: versionName,
      })
      .eq("id", versionId)
      .select()
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as DocumentVersion, error: null };
  } catch (error) {
    return { data: null, error: "Failed to update document version name" };
  }
}

// Server Action: Delete a document and all associated data
export async function deleteDocumentAction(
  documentId: string
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
      return { success: false, error: "Document not found or access denied" };
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
      const thumbnailFiles = filesToDelete.filter((path) =>
        path.includes(user.id)
      );
      const audioFiles = filesToDelete.filter(
        (path) => path.includes(user.id) && !path.includes("thumbnail")
      );

      if (thumbnailFiles.length > 0) {
        await supabase.storage
          .from("document-thumbnails")
          .remove(thumbnailFiles);
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

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: "Failed to delete document" };
  }
}

// Server Action: Regenerate blocks from document's processed_text
export async function regenerateBlocksFromProcessedTextAction(
  versionId: string
): Promise<{ data: Block[] | null; error: string | null }> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { data: null, error: "User not authenticated" };
    }

    // Get the version with its document's processed_text
    const { data: versionWithDoc } = await supabase
      .from("document_versions")
      .select(
        `
        id,
        document:documents!inner(
          user_id,
          processed_text
        )
      `
      )
      .eq("id", versionId)
      .single();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = versionWithDoc?.document as any;
    if (!versionWithDoc || !doc || doc.user_id !== user.id) {
      return { data: null, error: "Version not found or access denied" };
    }

    if (!doc.processed_text) {
      return { data: null, error: "No processed_text found on document" };
    }

    const processedText = doc.processed_text;

    const blocks = convertProcessedTextToBlocks(processedText);

    // Save the regenerated blocks
    const { error } = await supabase
      .from("document_versions")
      .update({ blocks: blocks })
      .eq("id", versionId);

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: blocks, error: null };
  } catch (error) {
    return { data: null, error: "Failed to regenerate blocks" };
  }
}

// Server Action: Create a pending version for streaming
export async function createPendingVersionAction(versionData: {
  document_id: string;
  version_name: string;
  processing_type: string;
  processing_metadata?: Record<string, any>;
}): Promise<{ data: DocumentVersion | null; error: string | null }> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { data: null, error: "User not authenticated" };
    }

    // Check document ownership
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("user_id")
      .eq("id", versionData.document_id)
      .single();

    if (docError) {
      return { data: null, error: "Failed to verify document ownership" };
    }

    if (!document || document.user_id !== user.id) {
      return { data: null, error: "Document not found or access denied" };
    }

    const { data, error } = await supabase
      .from("document_versions")
      .insert({
        ...versionData,
        status: "pending",
        streaming_text: "",
        processing_progress: 0,
      })
      .select()
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as DocumentVersion, error: null };
  } catch (error) {
    return { data: null, error: "Failed to create pending version" };
  }
}

// Server Action: Update version streaming text and progress
export async function updateVersionStreamingAction(
  versionId: string,
  updates: {
    streaming_text?: string;
    processing_progress?: number;
    status?: VersionStatus;
    error_message?: string;
  }
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

    // Verify ownership through document
    const { data: version } = await supabase
      .from("document_versions")
      .select(
        `
        id,
        document:documents!inner(user_id)
      `
      )
      .eq("id", versionId)
      .single();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = version?.document as any;
    if (!version || !doc || doc.user_id !== user.id) {
      return { success: false, error: "Version not found or access denied" };
    }

    const { error } = await supabase
      .from("document_versions")
      .update(updates)
      .eq("id", versionId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: "Failed to update version streaming" };
  }
}

// Server Action: Finalize version - convert streaming_text to blocks and mark completed
export async function finalizeVersionAction(
  versionId: string,
  blocks: Block[]
): Promise<{ data: DocumentVersion | null; error: string | null }> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { data: null, error: "User not authenticated" };
    }

    // Verify ownership through document
    const { data: version } = await supabase
      .from("document_versions")
      .select(
        `
        id,
        document:documents!inner(user_id)
      `
      )
      .eq("id", versionId)
      .single();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = version?.document as any;
    if (!version || !doc || doc.user_id !== user.id) {
      return { data: null, error: "Version not found or access denied" };
    }

    const { data, error } = await supabase
      .from("document_versions")
      .update({
        blocks,
        status: "completed",
        streaming_text: "", // Clear streaming text after conversion
        processing_progress: 100,
      })
      .eq("id", versionId)
      .select()
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as DocumentVersion, error: null };
  } catch (error) {
    return { data: null, error: "Failed to finalize version" };
  }
}

// Server Action: Delete a document version
export async function deleteDocumentVersionAction(
  versionId: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { deleteDocumentVersion } = await import("./models");
    await deleteDocumentVersion(versionId);
    return { success: true, error: null };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete version",
    };
  }
}
