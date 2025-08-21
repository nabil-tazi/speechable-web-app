import type { DocumentWithVersions } from "../types";

// Document State Interface
export interface DocumentsState {
  documents: DocumentWithVersions[];
  loading: boolean;
  error: string | null;
  uploadingDocuments: Record<string, boolean>; // Track individual uploads
}

// Action Types
export type DocumentsAction =
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SET_DOCUMENTS"; payload: DocumentWithVersions[] }
  | { type: "ADD_DOCUMENT"; payload: DocumentWithVersions }
  | {
      type: "UPDATE_DOCUMENT";
      payload: { id: string; updates: Partial<DocumentWithVersions> };
    }
  | { type: "REMOVE_DOCUMENT"; payload: string }
  | { type: "SET_UPLOADING"; payload: { id: string; uploading: boolean } }
  | { type: "CLEAR_DOCUMENTS" };

export function documentsReducer(
  state: DocumentsState,
  action: DocumentsAction
): DocumentsState {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, loading: action.payload };

    case "SET_ERROR":
      return { ...state, error: action.payload, loading: false };

    case "SET_DOCUMENTS":
      return {
        ...state,
        documents: action.payload,
        loading: false,
        error: null,
      };

    case "ADD_DOCUMENT":
      return {
        ...state,
        documents: [action.payload, ...state.documents],
        error: null,
      };

    case "UPDATE_DOCUMENT":
      return {
        ...state,
        documents: state.documents.map((doc) =>
          doc.id === action.payload.id
            ? { ...doc, ...action.payload.updates }
            : doc
        ),
      };

    case "REMOVE_DOCUMENT":
      return {
        ...state,
        documents: state.documents.filter((doc) => doc.id !== action.payload),
      };

    case "SET_UPLOADING":
      return {
        ...state,
        uploadingDocuments: {
          ...state.uploadingDocuments,
          [action.payload.id]: action.payload.uploading,
        },
      };

    case "CLEAR_DOCUMENTS":
      return {
        ...state,
        documents: [],
        uploadingDocuments: {},
        error: null,
      };

    default:
      return state;
  }
}
