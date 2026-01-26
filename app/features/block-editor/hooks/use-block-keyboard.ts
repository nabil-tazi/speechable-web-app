import { useCallback } from "react";
import { getTextContent } from "../utils/dom";
import type { Block, BlockInput } from "@/app/features/documents/types";
import type { EditorAction } from "../types";

interface UseBlockKeyboardOptions {
  contentRef: React.RefObject<HTMLDivElement | null>;
  block: Block;
  blocks: Block[];
  updateBlock: (blockId: string, updates: { content: string }) => void;
  deleteBlock: (blockId: string) => void;
  addBlock: (block: BlockInput, afterBlockId: string, focus?: boolean) => void;
  dispatch: React.Dispatch<EditorAction>;
  getCursorPosition: () => number;
  isCursorAtEnd: () => boolean;
  lastSyncedContentRef: React.MutableRefObject<string>;
  debounceTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
  setIsEditing: (editing: boolean) => void;
}

interface UseBlockKeyboardReturn {
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

/**
 * Hook for handling keyboard events in block editor (Enter, Backspace, Escape).
 */
export function useBlockKeyboard({
  contentRef,
  block,
  blocks,
  updateBlock,
  deleteBlock,
  addBlock,
  dispatch,
  getCursorPosition,
  isCursorAtEnd,
  lastSyncedContentRef,
  debounceTimerRef,
  setIsEditing,
}: UseBlockKeyboardOptions): UseBlockKeyboardReturn {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        // Clear pending timer
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }

        if (contentRef.current) {
          // If cursor is at the end, just create an empty block below
          if (isCursorAtEnd()) {
            const currentContent = getTextContent(contentRef.current);
            // Sync current content first
            if (currentContent !== lastSyncedContentRef.current) {
              updateBlock(block.id, { content: currentContent });
              lastSyncedContentRef.current = currentContent;
            }
            addBlock({ type: "text", content: "" }, block.id, true);
            setIsEditing(false);
          } else {
            const currentContent = getTextContent(contentRef.current);
            const cursorPos = getCursorPosition();
            // Split content at cursor position
            const contentBefore = currentContent.slice(0, cursorPos);
            const contentAfter = currentContent.slice(cursorPos).replace(/^\n/, "");

            // Update DOM to only show content before cursor
            contentRef.current.innerText = contentBefore;
            lastSyncedContentRef.current = contentBefore;

            // Atomic split operation (single history entry)
            dispatch({
              type: "SPLIT_BLOCK",
              blockId: block.id,
              contentBefore,
              contentAfter,
            });

            // Exit editing mode on this block since focus moves to new block
            setIsEditing(false);
          }
        } else {
          // Fallback: create empty block
          addBlock({ type: "text", content: "" }, block.id);
        }
      }

      if (e.key === "Backspace") {
        // Check if there's an active selection - if so, let browser handle deletion
        const selection = window.getSelection();
        const hasSelection = selection && !selection.isCollapsed;
        if (hasSelection) {
          // Let browser delete the selected text
          return;
        }

        const cursorPos = getCursorPosition();
        const currentContent = contentRef.current
          ? getTextContent(contentRef.current)
          : "";

        // Delete empty block (check trimmed - browsers may leave <br> as "\n")
        if (currentContent.trim() === "") {
          e.preventDefault();

          // Focus previous block at end of its content
          const sortedBlocks = [...blocks].sort((a, b) => a.order - b.order);
          const currentIndex = sortedBlocks.findIndex((b) => b.id === block.id);
          if (currentIndex > 0) {
            const prevBlock = sortedBlocks[currentIndex - 1];
            sessionStorage.setItem(
              "block-focus-position",
              JSON.stringify({
                blockId: prevBlock.id,
                position: prevBlock.content.length,
              })
            );
            dispatch({ type: "FOCUS_BLOCK", blockId: prevBlock.id });
          }

          deleteBlock(block.id);
          setIsEditing(false);
          return;
        }

        // Merge with previous block when cursor is at the beginning (no selection)
        if (cursorPos === 0) {
          e.preventDefault();

          // Find previous block to get cursor position for focus
          const sortedBlocks = [...blocks].sort((a, b) => a.order - b.order);
          const currentIndex = sortedBlocks.findIndex((b) => b.id === block.id);

          if (currentIndex > 0) {
            const prevBlock = sortedBlocks[currentIndex - 1];

            // Clear pending timer
            if (debounceTimerRef.current) {
              clearTimeout(debounceTimerRef.current);
              debounceTimerRef.current = null;
            }

            // Store cursor position for when the previous block focuses
            sessionStorage.setItem(
              "block-focus-position",
              JSON.stringify({
                blockId: prevBlock.id,
                position: prevBlock.content.length,
              })
            );

            // Atomic merge operation (single history entry)
            dispatch({ type: "MERGE_WITH_PREVIOUS", blockId: block.id });

            setIsEditing(false);
          }
        }
      }

      if (e.key === "Delete") {
        // Check if there's an active selection - if so, let browser handle deletion
        const selection = window.getSelection();
        const hasSelection = selection && !selection.isCollapsed;
        if (hasSelection) {
          // Let browser delete the selected text
          return;
        }

        const currentContent = contentRef.current
          ? getTextContent(contentRef.current)
          : "";

        // Delete empty block (check trimmed - browsers may leave <br> as "\n")
        if (currentContent.trim() === "") {
          e.preventDefault();

          // Focus previous block at end of its content
          const sortedBlocks = [...blocks].sort((a, b) => a.order - b.order);
          const currentIndex = sortedBlocks.findIndex((b) => b.id === block.id);
          if (currentIndex > 0) {
            const prevBlock = sortedBlocks[currentIndex - 1];
            sessionStorage.setItem(
              "block-focus-position",
              JSON.stringify({
                blockId: prevBlock.id,
                position: prevBlock.content.length,
              })
            );
            dispatch({ type: "FOCUS_BLOCK", blockId: prevBlock.id });
          }

          deleteBlock(block.id);
          setIsEditing(false);
        }
      }

      if (e.key === "Escape") {
        contentRef.current?.blur();
      }
    },
    [
      contentRef,
      block,
      blocks,
      updateBlock,
      deleteBlock,
      addBlock,
      dispatch,
      getCursorPosition,
      isCursorAtEnd,
      lastSyncedContentRef,
      debounceTimerRef,
      setIsEditing,
    ]
  );

  return { handleKeyDown };
}
