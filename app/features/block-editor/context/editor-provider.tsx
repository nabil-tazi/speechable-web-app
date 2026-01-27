"use client";

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  useEffect,
  useState,
} from "react";
import { editorReducer, initialEditorState } from "./editor-reducer";
import {
  updateDocumentVersionBlocksAction,
  updateDocumentVersionNameAction,
} from "@/app/features/documents/actions";
import type { EditorState, EditorAction } from "../types";
import type { Block, BlockInput } from "@/app/features/documents/types";

interface EditorContextValue {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  // Actions
  updateBlock: (blockId: string, updates: Partial<Block>) => void;
  addBlock: (block: BlockInput, afterBlockId?: string, focus?: boolean) => void;
  deleteBlock: (blockId: string) => void;
  moveBlock: (blockId: string, newOrder: number) => void;
  toggleBlockDisabled: (blockId: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  // Save/Discard
  save: () => Promise<void>;
  discardChanges: () => void;
  isDirty: boolean;
  // Version name
  versionName: string;
  setVersionName: (name: string) => void;
  // Direct block access for TTS integration
  blocks: Block[];
}

const EditorContext = createContext<EditorContextValue | null>(null);

interface EditorProviderProps {
  children: React.ReactNode;
  documentVersionId: string;
  initialBlocks: Block[];
  initialVersionName?: string;
  autoSaveDelay?: number;
  autoSave?: boolean;
}

export function EditorProvider({
  children,
  documentVersionId,
  initialBlocks,
  initialVersionName = "",
  autoSaveDelay = 2000,
  autoSave = true,
}: EditorProviderProps) {
  const [state, dispatch] = useReducer(editorReducer, {
    ...initialEditorState,
    blocks: initialBlocks,
  });

  const [versionName, setVersionName] = useState(initialVersionName);
  const initialVersionNameRef = useRef(initialVersionName);

  // Sync version name when initialVersionName changes (e.g., switching versions)
  useEffect(() => {
    setVersionName(initialVersionName);
    initialVersionNameRef.current = initialVersionName;
  }, [initialVersionName]);

  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const blocksRef = useRef(state.blocks);
  const initialBlocksRef = useRef(initialBlocks);

  // Keep blocksRef in sync
  useEffect(() => {
    blocksRef.current = state.blocks;
  }, [state.blocks]);

  // Update initial blocks ref when they change (e.g., after save)
  useEffect(() => {
    initialBlocksRef.current = initialBlocks;
  }, [initialBlocks]);

  // Initialize history
  useEffect(() => {
    dispatch({ type: "RESET_HISTORY", blocks: initialBlocks });
  }, [initialBlocks]);

  const save = useCallback(async () => {
    if (state.isSaving) return;

    dispatch({ type: "SAVE_START" });

    try {
      // Save blocks - use state.blocks directly to avoid stale ref issue
      // (blocksRef is updated in useEffect which may not have run yet)
      const { error: blocksError } = await updateDocumentVersionBlocksAction(
        documentVersionId,
        state.blocks
      );

      if (blocksError) {
        dispatch({ type: "SAVE_ERROR" });
        console.error("Failed to save blocks:", blocksError);
        return;
      }

      // Save version name if changed
      if (versionName !== initialVersionNameRef.current) {
        const { error: nameError } = await updateDocumentVersionNameAction(
          documentVersionId,
          versionName
        );

        if (nameError) {
          dispatch({ type: "SAVE_ERROR" });
          console.error("Failed to save version name:", nameError);
          return;
        }

        // Update the initial ref after successful save
        initialVersionNameRef.current = versionName;
      }

      // Update initial refs after successful save so discard goes back to last saved state
      initialBlocksRef.current = state.blocks;

      dispatch({ type: "SAVE_SUCCESS", savedAt: new Date() });
    } catch (error) {
      dispatch({ type: "SAVE_ERROR" });
      console.error("Failed to save:", error);
    }
  }, [documentVersionId, state.blocks, state.isSaving, versionName]);

  // Auto-save with debounce (only when autoSave is enabled)
  useEffect(() => {
    if (autoSave && state.isDirty && !state.isSaving) {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      autoSaveTimeoutRef.current = setTimeout(() => {
        save();
      }, autoSaveDelay);
    }

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [autoSave, state.isDirty, state.isSaving, save, autoSaveDelay]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          dispatch({ type: "REDO" });
        } else {
          dispatch({ type: "UNDO" });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const updateBlock = useCallback(
    (blockId: string, updates: Partial<Block>) => {
      dispatch({ type: "UPDATE_BLOCK", blockId, updates });
    },
    []
  );

  const addBlock = useCallback(
    (block: BlockInput, afterBlockId?: string, focus?: boolean) => {
      dispatch({ type: "ADD_BLOCK", block, afterBlockId, focus });
    },
    []
  );

  const deleteBlock = useCallback((blockId: string) => {
    dispatch({ type: "DELETE_BLOCK", blockId });
  }, []);

  const moveBlock = useCallback((blockId: string, newOrder: number) => {
    dispatch({ type: "MOVE_BLOCK", blockId, newOrder });
  }, []);

  const toggleBlockDisabled = useCallback((blockId: string) => {
    dispatch({ type: "TOGGLE_BLOCK_DISABLED", blockId });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: "UNDO" });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: "REDO" });
  }, []);

  const discardChanges = useCallback(() => {
    dispatch({ type: "RESET_HISTORY", blocks: initialBlocksRef.current });
    setVersionName(initialVersionNameRef.current);
  }, []);

  const canUndo = state.historyIndex > 0;
  const canRedo = state.historyIndex < state.history.length - 1;

  const value: EditorContextValue = {
    state,
    dispatch,
    updateBlock,
    addBlock,
    deleteBlock,
    moveBlock,
    toggleBlockDisabled,
    undo,
    redo,
    canUndo,
    canRedo,
    save,
    discardChanges,
    isDirty: state.isDirty,
    versionName,
    setVersionName,
    blocks: state.blocks,
  };

  return (
    <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
  );
}

export function useEditor() {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error("useEditor must be used within an EditorProvider");
  }
  return context;
}
