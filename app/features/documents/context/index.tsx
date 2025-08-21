"use client";

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import type { Document, DocumentWithVersions } from "../types";
import {
  createDocumentAction,
  uploadDocumentThumbnailAction,
  getUserDocumentsAction,
  getUserDocumentsWithVersionsAction,
} from "../actions";
import {
  documentsReducer,
  type DocumentsAction,
  type DocumentsState,
} from "./reducer";
import { createClient } from "@/app/lib/supabase/client";

const supabase = createClient();
// Initial State
const emptyState: DocumentsState = {
  documents: [],
  loading: true,
  error: null,
  uploadingDocuments: {},
};

// Context Types
type DocumentsDispatch = (action: DocumentsAction) => void;

// Document Actions Interface
interface DocumentsActions {
  createDocument: (documentData: {
    mime_type: string;
    filename: string;
    original_filename: string;
    document_type: string;
    raw_text?: string;
    page_count?: number;
    file_size?: number;
    metadata?: Record<string, any>;
  }) => Promise<{
    success: boolean;
    document?: DocumentWithVersions;
    error?: string;
  }>;

  uploadThumbnail: (
    documentId: string,
    thumbnailData: string | File
  ) => Promise<{ success: boolean; error?: string | null }>;

  refreshDocuments: () => Promise<void>;

  removeDocument: (documentId: string) => void;
}

// Contexts
const DocumentsStateContext = createContext<DocumentsState>(emptyState);
const DocumentsDispatchContext = createContext<DocumentsDispatch | undefined>(
  undefined
);
const DocumentsActionsContext = createContext<DocumentsActions | undefined>(
  undefined
);

// Provider Props
interface DocumentsProviderProps {
  children: ReactNode;
}

// Provider Component
export function DocumentsProvider({ children }: DocumentsProviderProps) {
  const [state, dispatch] = useReducer(documentsReducer, emptyState);
  const hasLoadedDocuments = useRef(false);
  const currentUserId = useRef<string | null>(null);

  // Load initial documents WITH versions
  async function loadDocuments() {
    try {
      dispatch({ type: "SET_LOADING", payload: true });
      console.log("loading documents with versions");
      const { data, error } = await getUserDocumentsWithVersionsAction();
      console.log(data);

      if (error) {
        dispatch({ type: "SET_ERROR", payload: error });
      } else {
        dispatch({ type: "SET_DOCUMENTS", payload: data || [] });
        hasLoadedDocuments.current = true;
      }
    } catch (error) {
      dispatch({ type: "SET_ERROR", payload: "Failed to load documents" });
    }
  }

  // Actions
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

  const uploadThumbnail = async (
    documentId: string,
    thumbnailData: string | File
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

  const refreshDocuments = async () => {
    hasLoadedDocuments.current = false;
    await loadDocuments();
  };

  const removeDocument = (documentId: string) => {
    dispatch({ type: "REMOVE_DOCUMENT", payload: documentId });
  };

  // Fix: Define the actions object
  const actions: DocumentsActions = {
    createDocument,
    uploadThumbnail,
    refreshDocuments,
    removeDocument,
  };

  // Load documents on mount and listen for auth changes
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Timeout recommended in Supabase doc
      // Allows other supabase function to run before this one
      setTimeout(async () => {
        const newUserId = session?.user?.id || null;

        if (event === "SIGNED_IN" && session?.user) {
          // Only reload if it's a different user or we haven't loaded documents yet
          if (
            currentUserId.current !== newUserId ||
            !hasLoadedDocuments.current
          ) {
            currentUserId.current = newUserId;
            hasLoadedDocuments.current = false;
            await loadDocuments();
          }
        } else if (event === "SIGNED_OUT") {
          currentUserId.current = null;
          hasLoadedDocuments.current = false;
          dispatch({ type: "CLEAR_DOCUMENTS" });
        }
      }, 0);
    });

    // Load initial documents if user is already signed in
    const checkInitialSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        currentUserId.current = session.user.id;
        await loadDocuments();
      } else {
        dispatch({ type: "SET_LOADING", payload: false });
      }
    };

    checkInitialSession();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Listen for real-time changes (optional)
  useEffect(() => {
    // Fix: Make this async to properly get user
    const setupRealtimeSubscription = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const channel = supabase
        .channel("documents_changes")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "documents",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            console.log("Document change received:", payload);

            switch (payload.eventType) {
              case "INSERT":
                // Cast to unknown first, then to DocumentWithVersions
                const documentData = payload.new as unknown as Document;
                const newDocument: DocumentWithVersions = {
                  ...documentData,
                  versions: [],
                };
                dispatch({
                  type: "ADD_DOCUMENT",
                  payload: newDocument,
                });
                break;
              case "UPDATE":
                dispatch({
                  type: "UPDATE_DOCUMENT",
                  payload: {
                    id: payload.new.id,
                    updates: payload.new as Partial<DocumentWithVersions>,
                  },
                });
                break;
              case "DELETE":
                dispatch({ type: "REMOVE_DOCUMENT", payload: payload.old.id });
                break;
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    };

    setupRealtimeSubscription();
  }, []); // Fix: Remove supabase from dependencies

  return (
    <DocumentsStateContext.Provider value={state}>
      <DocumentsDispatchContext.Provider value={dispatch}>
        <DocumentsActionsContext.Provider value={actions}>
          {children}
        </DocumentsActionsContext.Provider>
      </DocumentsDispatchContext.Provider>
    </DocumentsStateContext.Provider>
  );
}

// Custom Hooks
export function useDocumentsState() {
  const state = useContext(DocumentsStateContext);
  if (state === undefined) {
    throw new Error(
      "useDocumentsState must be used within a DocumentsProvider"
    );
  }
  return state;
}

export function useDocumentsDispatch() {
  const dispatch = useContext(DocumentsDispatchContext);
  if (dispatch === undefined) {
    throw new Error(
      "useDocumentsDispatch must be used within a DocumentsProvider"
    );
  }
  return dispatch;
}

export function useDocumentsActions() {
  const actions = useContext(DocumentsActionsContext);
  if (actions === undefined) {
    throw new Error(
      "useDocumentsActions must be used within a DocumentsProvider"
    );
  }
  return actions;
}

// Convenience Hooks
export function useDocuments() {
  const { documents, loading, error } = useDocumentsState();
  return { documents, loading, error };
}

export function useDocumentUpload() {
  const { uploadingDocuments } = useDocumentsState();
  const { createDocument, uploadThumbnail } = useDocumentsActions();

  return {
    createDocument,
    uploadThumbnail,
    uploadingDocuments,
    isUploading: (id: string) => uploadingDocuments[id] || false,
  };
}
