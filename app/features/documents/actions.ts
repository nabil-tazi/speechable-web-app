"use server";

import { createClient } from "@/app/lib/supabase/server";
import type { Document, DocumentVersion, DocumentWithVersions } from "./types";

// Server Action: Create a document
export async function createDocumentAction(documentData: {
  mime_type: string;
  file_type: string;
  title: string;
  author: string;
  filename: string;
  document_type: string;
  raw_text?: string;
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

    const filePath = `${user.id}/${documentId}.png`;
    let uploadData: Buffer | File;
    let contentType = "image/png";

    if (typeof thumbnailData === "string") {
      // Handle data URL
      const base64Data = thumbnailData.split(",")[1];
      uploadData = Buffer.from(base64Data, "base64");
    } else {
      // Handle File object - convert to buffer
      const arrayBuffer = await thumbnailData.arrayBuffer();
      uploadData = Buffer.from(arrayBuffer);
      contentType = thumbnailData.type;
    }

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
