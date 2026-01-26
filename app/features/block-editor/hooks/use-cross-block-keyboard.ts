import { useEffect, useCallback } from "react";
import type { CrossBlockSelection, EditorAction } from "../types";

interface UseCrossBlockKeyboardOptions {
  isEditMode: boolean;
  crossBlockSelection: CrossBlockSelection | null;
  dispatch: React.Dispatch<EditorAction>;
}

/**
 * Hook for handling keyboard events when cross-block selection is active.
 * Handles Delete/Backspace to delete selection and typing to replace selection.
 */
export function useCrossBlockKeyboard({
  isEditMode,
  crossBlockSelection,
  dispatch,
}: UseCrossBlockKeyboardOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isEditMode || !crossBlockSelection) return;

      // Capture values before dispatch (React may update state before requestAnimationFrame runs)
      const startBlockId = crossBlockSelection.startBlockId;
      const startOffset = crossBlockSelection.startOffset;

      // Handle Delete or Backspace
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        dispatch({ type: "DELETE_CROSS_BLOCK_SELECTION" });

        // Clear browser selection
        window.getSelection()?.removeAllRanges();

        // Set cursor position in the merged block
        requestAnimationFrame(() => {
          const startBlock = document.querySelector(
            `[data-block-id="${startBlockId}"]`
          );
          if (startBlock) {
            const contentDiv = startBlock.querySelector("[data-block-content]");
            if (contentDiv) {
              // Focus the element
              (contentDiv as HTMLElement).focus();

              // Set cursor at the merge point
              const selection = window.getSelection();
              if (selection) {
                const range = document.createRange();
                const textNode = contentDiv.firstChild;

                if (textNode) {
                  const offset = Math.min(
                    startOffset,
                    textNode.textContent?.length || 0
                  );
                  range.setStart(textNode, offset);
                  range.setEnd(textNode, offset);
                } else {
                  range.selectNodeContents(contentDiv);
                  range.collapse(true);
                }

                selection.removeAllRanges();
                selection.addRange(range);
              }
            }
          }
        });
        return;
      }

      // Handle typing to replace selection (printable characters)
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        dispatch({ type: "REPLACE_CROSS_BLOCK_SELECTION", newText: e.key });

        // Clear browser selection
        window.getSelection()?.removeAllRanges();

        // Set cursor position after the typed character
        requestAnimationFrame(() => {
          const startBlock = document.querySelector(
            `[data-block-id="${startBlockId}"]`
          );
          if (startBlock) {
            const contentDiv = startBlock.querySelector("[data-block-content]");
            if (contentDiv) {
              // Focus the element
              (contentDiv as HTMLElement).focus();

              // Set cursor after the typed character
              const selection = window.getSelection();
              if (selection) {
                const range = document.createRange();
                const textNode = contentDiv.firstChild;

                if (textNode) {
                  // Position after the typed character
                  const offset = Math.min(
                    startOffset + 1,
                    textNode.textContent?.length || 0
                  );
                  range.setStart(textNode, offset);
                  range.setEnd(textNode, offset);
                } else {
                  range.selectNodeContents(contentDiv);
                  range.collapse(false);
                }

                selection.removeAllRanges();
                selection.addRange(range);
              }
            }
          }
        });
        return;
      }
    },
    [isEditMode, crossBlockSelection, dispatch]
  );

  useEffect(() => {
    if (!isEditMode) return;

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isEditMode, handleKeyDown]);
}
