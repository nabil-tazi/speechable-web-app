import { useCallback, useRef } from "react";
import { getTextContent } from "../utils/dom";

const CHECKPOINT_DEBOUNCE_MS = 1000;

interface UseContentEditingOptions {
  contentRef: React.RefObject<HTMLDivElement | null>;
  blockId: string;
  blockContent: string;
  updateBlock: (blockId: string, updates: { content: string }) => void;
}

interface UseContentEditingReturn {
  handleInput: () => void;
  handleBlur: (onEditingEnd: () => void) => void;
  createCheckpoint: () => void;
  lastSyncedContentRef: React.MutableRefObject<string>;
  debounceTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
}

/**
 * Hook for managing contentEditable content synchronization and checkpoints.
 */
export function useContentEditing({
  contentRef,
  blockId,
  blockContent,
  updateBlock,
}: UseContentEditingOptions): UseContentEditingReturn {
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSyncedContentRef = useRef<string>(blockContent);

  // Debounced checkpoint creation
  const createCheckpoint = useCallback(() => {
    if (contentRef.current) {
      const currentContent = getTextContent(contentRef.current);
      if (currentContent !== lastSyncedContentRef.current) {
        updateBlock(blockId, { content: currentContent });
        lastSyncedContentRef.current = currentContent;
      }
    }
  }, [blockId, updateBlock, contentRef]);

  const handleInput = useCallback(() => {
    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    // Set new timer for checkpoint
    debounceTimerRef.current = setTimeout(
      createCheckpoint,
      CHECKPOINT_DEBOUNCE_MS
    );
  }, [createCheckpoint]);

  const handleBlur = useCallback(
    (onEditingEnd: () => void) => {
      // Clear any pending checkpoint timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      // Sync content to EditorProvider on blur
      if (contentRef.current) {
        const currentContent = getTextContent(contentRef.current);
        if (currentContent !== lastSyncedContentRef.current) {
          updateBlock(blockId, { content: currentContent });
          lastSyncedContentRef.current = currentContent;
        }
        // Clear DOM content before exiting edit mode
        // React will render the display mode children
        contentRef.current.innerText = "";
      }
      onEditingEnd();
    },
    [blockId, updateBlock, contentRef]
  );

  return {
    handleInput,
    handleBlur,
    createCheckpoint,
    lastSyncedContentRef,
    debounceTimerRef,
  };
}
