"use client";

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  ReactNode,
  useMemo,
} from "react";
import type { Document, DocumentWithVersions } from "../types";

import { getUserDocumentsWithVersionsAction } from "../actions";
import {
  documentsReducer,
  type DocumentsAction,
  type DocumentsState,
} from "./reducer";
import { createClient } from "@/app/lib/supabase/client";
import {
  createDocumentsActions,
  type DocumentsActions,
} from "./create-documents-actions";
import { getThumbnailUrl } from "@/app/utils/storage";
import { DOCUMENT_TYPES } from "../constants";
import type { DocumentType } from "../types";

const supabase = createClient();

// Get valid document types from constants
const validDocumentTypes = Object.keys(DOCUMENT_TYPES) as DocumentType[];

// Type for grouped documents
export type GroupedDocuments = Record<string, DocumentWithVersions[]>;

// Extended state to include grouped documents
interface ExtendedDocumentsState extends DocumentsState {
  groupedDocuments: GroupedDocuments;
}

// Initial State
const emptyState: ExtendedDocumentsState = {
  documents: [],
  loading: true,
  error: null,
  uploadingDocuments: {},
  groupedDocuments: {},
};

// Context Types
type DocumentsDispatch = (action: DocumentsAction) => void;

// Helper functions (updated to use new constants)
export const formatDocumentType = (type: string): string => {
  // Check if it's a valid document type
  if (type in DOCUMENT_TYPES) {
    return DOCUMENT_TYPES[type as DocumentType];
  }

  // Fallback to "General Document" for any unknown types
  return "General Document";
};

export const getDocumentCount = (docs: DocumentWithVersions[]) => {
  return docs.length === 1 ? "1 document" : `${docs.length} documents`;
};

// Utility function to validate document type
export const isValidDocumentType = (type: string): type is DocumentType => {
  return validDocumentTypes.includes(type as DocumentType);
};

// Utility function to get safe document type (fallback to 'general')
export const getSafeDocumentType = (type: string): DocumentType => {
  return isValidDocumentType(type) ? type : "general";
};

// Contexts
const DocumentsStateContext = createContext<ExtendedDocumentsState>(emptyState);
const DocumentsDispatchContext = createContext<DocumentsDispatch | undefined>(
  undefined
);
const DocumentsActionsContext = createContext<DocumentsActions | undefined>(
  undefined
);

// Provider Props
interface DocumentsProviderProps {
  children: ReactNode;
  autoLoad?: boolean; // If false, won't automatically load documents on mount
}

// Provider Component
export function DocumentsProvider({ children, autoLoad = true }: DocumentsProviderProps) {
  const [state, dispatch] = useReducer(documentsReducer, emptyState);
  const hasLoadedDocuments = useRef(false);
  const currentUserId = useRef<string | null>(null);

  // Group documents by document_type (using new constants)
  const groupedDocuments = useMemo(() => {
    const groups: Record<string, DocumentWithVersions[]> = {};

    state.documents.forEach((doc) => {
      // Use the document type as-is, fallback to 'general' if invalid
      const documentType = getSafeDocumentType(doc.document_type);

      if (!groups[documentType]) {
        groups[documentType] = [];
      }
      groups[documentType].push(doc);
    });

    // Sort groups by the defined order and sort documents within each group by upload date (newest first)
    const sortedGroups: Record<string, DocumentWithVersions[]> = {};
    validDocumentTypes.forEach((type) => {
      if (groups[type]) {
        sortedGroups[type] = groups[type].sort(
          (a, b) =>
            new Date(b.upload_date).getTime() -
            new Date(a.upload_date).getTime()
        );
      }
    });

    return sortedGroups;
  }, [state.documents]);

  // Extended state with grouped documents
  const extendedState: ExtendedDocumentsState = useMemo(
    () => ({
      ...state,
      groupedDocuments,
    }),
    [state, groupedDocuments]
  );

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
        const dataWithThumbnailURL = data;
        if (dataWithThumbnailURL)
          await Promise.all(
            dataWithThumbnailURL.map(async (doc) => {
              if (doc.thumbnail_path) {
                doc.thumbnail_path = await getThumbnailUrl(doc.thumbnail_path);
              }
            })
          );
        dispatch({
          type: "SET_DOCUMENTS",
          payload: dataWithThumbnailURL || [],
        });
        hasLoadedDocuments.current = true;
      }
    } catch (error) {
      dispatch({ type: "SET_ERROR", payload: "Failed to load documents" });
    }
  }

  // Refresh documents function for the hook
  const refreshDocuments = async () => {
    hasLoadedDocuments.current = false;
    await loadDocuments();
  };

  // Create the documents actions object
  const actions = createDocumentsActions(dispatch, refreshDocuments);

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
            if (autoLoad) {
              await loadDocuments();
            }
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
        if (autoLoad) {
          await loadDocuments();
        }
      } else {
        dispatch({ type: "SET_LOADING", payload: false });
      }
    };

    checkInitialSession();

    return () => {
      subscription.unsubscribe();
    };
  }, [autoLoad]);

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
    <DocumentsStateContext.Provider value={extendedState}>
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

// New hook for grouped documents
export function useGroupedDocuments() {
  const { groupedDocuments, loading, error } = useDocumentsState();
  return { groupedDocuments, loading, error };
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
