import { useEffect, useCallback } from "react";
import type { CrossBlockSelection, EditorAction } from "../types";
import type { Block } from "@/app/features/documents/types";

interface UseCrossBlockSelectionOptions {
  isEditMode: boolean;
  blocks: Block[];
  dispatch: React.Dispatch<EditorAction>;
  crossBlockSelection: CrossBlockSelection | null;
}

/**
 * Hook for detecting and managing cross-block text selections.
 * Listens for selection changes and dispatches SET_CROSS_BLOCK_SELECTION
 * when the selection spans multiple blocks.
 */
export function useCrossBlockSelection({
  isEditMode,
  blocks,
  dispatch,
  crossBlockSelection,
}: UseCrossBlockSelectionOptions) {
  // Find the block element containing a node
  const findBlockElement = useCallback((node: Node): HTMLElement | null => {
    let current: Node | null = node;
    while (current && current !== document.body) {
      if (current instanceof HTMLElement && current.hasAttribute("data-block-id")) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }, []);

  // Get ordered list of block IDs between start and end
  const getBlockIdsBetween = useCallback(
    (startBlockId: string, endBlockId: string): string[] => {
      const sortedBlocks = [...blocks].sort((a, b) => a.order - b.order);
      const startIndex = sortedBlocks.findIndex((b) => b.id === startBlockId);
      const endIndex = sortedBlocks.findIndex((b) => b.id === endBlockId);

      if (startIndex === -1 || endIndex === -1) return [];

      const minIndex = Math.min(startIndex, endIndex);
      const maxIndex = Math.max(startIndex, endIndex);

      return sortedBlocks.slice(minIndex, maxIndex + 1).map((b) => b.id);
    },
    [blocks]
  );

  // Calculate text offset within a block's content element
  const getOffsetInBlock = useCallback(
    (blockElement: HTMLElement, container: Node, offset: number): number => {
      const contentDiv = blockElement.querySelector("[data-block-content]");
      if (!contentDiv) return 0;

      // Create a range from start of content to the selection point
      const range = document.createRange();
      range.selectNodeContents(contentDiv);
      range.setEnd(container, offset);

      return range.toString().length;
    },
    []
  );

  // Check if current selection is a valid cross-block selection
  const isCrossBlockSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);
    const startBlockElement = findBlockElement(range.startContainer);
    const endBlockElement = findBlockElement(range.endContainer);

    if (!startBlockElement || !endBlockElement) return false;

    const startBlockId = startBlockElement.getAttribute("data-block-id");
    const endBlockId = endBlockElement.getAttribute("data-block-id");

    return startBlockId && endBlockId && startBlockId !== endBlockId;
  }, [findBlockElement]);

  // Handle selection change - only used to CLEAR the selection when it becomes invalid
  const handleSelectionChange = useCallback(() => {
    if (!isEditMode || !crossBlockSelection) return;

    // If selection is now collapsed, single-block, or invalid, clear cross-block selection
    if (!isCrossBlockSelection()) {
      dispatch({ type: "SET_CROSS_BLOCK_SELECTION", selection: null });
    }
  }, [isEditMode, crossBlockSelection, dispatch, isCrossBlockSelection]);

  // Handle mouseup - set cross-block selection if valid
  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      if (!isEditMode) return;

      // Don't process if clicking on floating menu
      const menuElement = document.querySelector('[data-floating-menu="true"]');
      if (menuElement && menuElement.contains(e.target as Node)) {
        return;
      }

      // Small delay to let selection finalize
      requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          if (crossBlockSelection) {
            dispatch({ type: "SET_CROSS_BLOCK_SELECTION", selection: null });
          }
          return;
        }

        const range = selection.getRangeAt(0);

        // Find block elements for start and end of selection
        const startBlockElement = findBlockElement(range.startContainer);
        const endBlockElement = findBlockElement(range.endContainer);

        if (!startBlockElement || !endBlockElement) {
          if (crossBlockSelection) {
            dispatch({ type: "SET_CROSS_BLOCK_SELECTION", selection: null });
          }
          return;
        }

        const startBlockId = startBlockElement.getAttribute("data-block-id");
        const endBlockId = endBlockElement.getAttribute("data-block-id");

        if (!startBlockId || !endBlockId) {
          if (crossBlockSelection) {
            dispatch({ type: "SET_CROSS_BLOCK_SELECTION", selection: null });
          }
          return;
        }

        // If same block, this is a single-block selection - let per-block handler deal with it
        if (startBlockId === endBlockId) {
          if (crossBlockSelection) {
            dispatch({ type: "SET_CROSS_BLOCK_SELECTION", selection: null });
          }
          return;
        }

        // This is a cross-block selection
        const selectedText = selection.toString().trim();
        if (!selectedText) {
          if (crossBlockSelection) {
            dispatch({ type: "SET_CROSS_BLOCK_SELECTION", selection: null });
          }
          return;
        }

        // Get full selection bounds for horizontal centering
        const fullRect = range.getBoundingClientRect();

        // Get position at the start of the selection for vertical positioning
        const startRange = document.createRange();
        startRange.setStart(range.startContainer, range.startOffset);
        startRange.collapse(true);
        const startRect = startRange.getBoundingClientRect();

        // If start is off-screen (above viewport), use the top of the visible selection area instead
        const visibleTop = Math.max(0, fullRect.top);

        // Calculate offsets
        const startOffset = getOffsetInBlock(startBlockElement, range.startContainer, range.startOffset);
        const endOffset = getOffsetInBlock(endBlockElement, range.endContainer, range.endOffset);

        // Get ordered list of all block IDs in selection
        const selectedBlockIds = getBlockIdsBetween(startBlockId, endBlockId);

        // Use start position if visible, otherwise use top of visible selection area
        const menuY = startRect.top >= 0 ? startRect.top - 8 : visibleTop;

        const newSelection: CrossBlockSelection = {
          startBlockId,
          endBlockId,
          startOffset,
          endOffset,
          selectedText,
          selectedBlockIds,
          anchorPosition: {
            x: fullRect.left + fullRect.width / 2,
            y: menuY,
          },
        };

        dispatch({ type: "SET_CROSS_BLOCK_SELECTION", selection: newSelection });
      });
    },
    [
      isEditMode,
      crossBlockSelection,
      dispatch,
      findBlockElement,
      getBlockIdsBetween,
      getOffsetInBlock,
    ]
  );

  useEffect(() => {
    if (!isEditMode) return;

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [isEditMode, handleMouseUp, handleSelectionChange]);

  // Clear selection when exiting edit mode
  useEffect(() => {
    if (!isEditMode && crossBlockSelection) {
      dispatch({ type: "SET_CROSS_BLOCK_SELECTION", selection: null });
    }
  }, [isEditMode, crossBlockSelection, dispatch]);

  return {
    crossBlockSelection,
    clearCrossBlockSelection: useCallback(() => {
      dispatch({ type: "SET_CROSS_BLOCK_SELECTION", selection: null });
    }, [dispatch]),
  };
}
