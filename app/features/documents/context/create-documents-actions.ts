import type { Document, DocumentWithVersions } from "../types";
import {
  createDocumentAction,
  updateDocumentAction,
  uploadDocumentThumbnailAction,
} from "../actions";
import type { DocumentsAction } from "../context/reducer";
import { CustomContextAction } from "@/app/features/shared/types/context-actions";
import { getThumbnailUrl } from "@/app/utils/storage";

// Document Actions Interface - Derived from server actions
interface DocumentsActions {
  createDocument: (
    documentData: Parameters<typeof createDocumentAction>[0]
  ) => Promise<{
    success: boolean;
    document?: DocumentWithVersions;
    error?: string;
  }>;

  updateDocument: CustomContextAction<
    [string, Parameters<typeof updateDocumentAction>[1]],
    { success: boolean; document?: Document; error?: string }
  >;

  uploadThumbnail: (
    documentId: string,
    thumbnailData: Parameters<typeof uploadDocumentThumbnailAction>[1]
  ) => Promise<{ success: boolean; error?: string | null }>;

  refreshDocuments: () => Promise<void>;
  removeDocument: (documentId: string) => void;
}

export function createDocumentsActions(
  dispatch: (action: DocumentsAction) => void,
  refreshDocuments: () => Promise<void>
): DocumentsActions {
  const createDocument = async (
    documentData: Parameters<typeof createDocumentAction>[0]
  ) => {
    try {
      const tempId = `temp-${Date.now()}`;
      dispatch({
        type: "SET_UPLOADING",
        payload: { id: tempId, uploading: true },
      });

      const { data, error } = await createDocumentAction(documentData);

      dispatch({
        type: "SET_UPLOADING",
        payload: { id: tempId, uploading: false },
      });

      if (error) {
        return { success: false, error };
      }

      if (data) {
        // Convert Document to DocumentWithVersions by adding empty versions array
        const documentWithVersions: DocumentWithVersions = {
          ...data,
          versions: [],
        };
        dispatch({ type: "ADD_DOCUMENT", payload: documentWithVersions });
        return { success: true, document: documentWithVersions };
      }

      return { success: false, error: "Unknown error occurred" };
    } catch (error) {
      return { success: false, error: "Failed to create document" };
    }
  };

  const updateDocument = async (
    documentId: string,
    updates: Parameters<typeof updateDocumentAction>[1]
  ) => {
    try {
      const { data, error } = await updateDocumentAction(documentId, updates);

      if (error) {
        return { success: false, error };
      }

      if (data) {
        // Convert thumbnail_path to full URL if it exists
        if (data.thumbnail_path) {
          data.thumbnail_path = await getThumbnailUrl(data.thumbnail_path);
        }

        // Update the document in the state
        dispatch({
          type: "UPDATE_DOCUMENT",
          payload: {
            id: documentId,
            updates: data,
          },
        });
        return { success: true, document: data };
      }

      return { success: false, error: "Unknown error occurred" };
    } catch (error) {
      return { success: false, error: "Failed to update document" };
    }
  };

  const uploadThumbnail = async (
    documentId: string,
    thumbnailData: Parameters<typeof uploadDocumentThumbnailAction>[1]
  ) => {
    try {
      dispatch({
        type: "SET_UPLOADING",
        payload: { id: documentId, uploading: true },
      });

      const { success, error } = await uploadDocumentThumbnailAction(
        documentId,
        thumbnailData
      );

      dispatch({
        type: "SET_UPLOADING",
        payload: { id: documentId, uploading: false },
      });

      if (success) {
        // Update the document to reflect the thumbnail upload
        dispatch({
          type: "UPDATE_DOCUMENT",
          payload: {
            id: documentId,
            updates: { thumbnail_path: `${documentId}.png` },
          },
        });
        return { success: true };
      }

      return { success: false, error: error || undefined };
    } catch (error) {
      dispatch({
        type: "SET_UPLOADING",
        payload: { id: documentId, uploading: false },
      });
      return { success: false, error: "Failed to upload thumbnail" };
    }
  };

  const removeDocument = (documentId: string) => {
    dispatch({ type: "REMOVE_DOCUMENT", payload: documentId });
  };

  return {
    createDocument,
    updateDocument,
    uploadThumbnail,
    refreshDocuments,
    removeDocument,
  };
}

export type { DocumentsActions };