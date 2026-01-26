import { useEffect, useState } from "react";
import type { SelectionMenu, CrossBlockSelection } from "../types";

interface UseTextSelectionOptions {
  contentRef: React.RefObject<HTMLDivElement | null>;
  isEditMode: boolean;
  keepMenuVisibleRef: React.MutableRefObject<boolean>;
  onScrollPositionCapture: () => void;
  crossBlockSelection?: CrossBlockSelection | null;
}

interface UseTextSelectionReturn {
  selectionMenu: SelectionMenu;
  setSelectionMenu: React.Dispatch<React.SetStateAction<SelectionMenu>>;
}

/**
 * Hook for managing text selection state and floating menu positioning.
 */
export function useTextSelection({
  contentRef,
  isEditMode,
  keepMenuVisibleRef,
  onScrollPositionCapture,
  crossBlockSelection,
}: UseTextSelectionOptions): UseTextSelectionReturn {
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenu>({
    visible: false,
    x: 0,
    y: 0,
    text: "",
  });

  // Handle text selection in edit mode (for AI menu)
  useEffect(() => {
    if (!isEditMode) return;

    const handleMouseUp = (e: MouseEvent) => {
      const selection = window.getSelection();

      // Check if click was inside the floating menu - if so, don't process
      const menuElement = document.querySelector('[data-floating-menu="true"]');
      if (menuElement && menuElement.contains(e.target as Node)) {
        return;
      }

      // Reset keep-visible flag when user clicks elsewhere
      keepMenuVisibleRef.current = false;

      // Hide per-block menu if cross-block selection is active
      if (crossBlockSelection) {
        setSelectionMenu((prev) => ({ ...prev, visible: false }));
        return;
      }

      if (!selection || selection.isCollapsed || !contentRef.current) {
        setSelectionMenu((prev) => ({ ...prev, visible: false }));
        return;
      }

      // Check if selection is within this block's content div
      const range = selection.getRangeAt(0);
      if (!contentRef.current.contains(range.commonAncestorContainer)) {
        setSelectionMenu((prev) => ({ ...prev, visible: false }));
        return;
      }

      const selectedText = selection.toString().trim();
      if (!selectedText) {
        setSelectionMenu((prev) => ({ ...prev, visible: false }));
        return;
      }

      // Get selection bounds for positioning
      const rect = range.getBoundingClientRect();
      const contentRect = contentRef.current.getBoundingClientRect();

      // Save scroll position for scroll-to-target button
      onScrollPositionCapture();

      // Calculate character offsets within the block content
      const startRange = document.createRange();
      startRange.selectNodeContents(contentRef.current);
      startRange.setEnd(range.startContainer, range.startOffset);
      const selectionStart = startRange.toString().length;

      const endRange = document.createRange();
      endRange.selectNodeContents(contentRef.current);
      endRange.setEnd(range.endContainer, range.endOffset);
      const selectionEnd = endRange.toString().length;

      const relativeX = rect.left + rect.width / 2 - contentRect.left;
      const relativeY = rect.top - contentRect.top - 8;
      setSelectionMenu({
        visible: true,
        x: relativeX,
        y: relativeY,
        text: selectedText,
        fixedX: rect.left + rect.width / 2,
        fixedY: rect.top - 8,
        selectionStart,
        selectionEnd,
      });
    };

    // Hide menu when selection changes (e.g., clicking elsewhere)
    const handleSelectionChange = () => {
      // Don't hide if interacting with the floating menu
      if (keepMenuVisibleRef.current) return;

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setSelectionMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    // Re-check selection when window regains focus (selection may have been cleared)
    const handleWindowFocus = () => {
      // Don't hide if we're in the middle of scrolling to target
      if (keepMenuVisibleRef.current) return;

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setSelectionMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("selectionchange", handleSelectionChange);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("selectionchange", handleSelectionChange);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [isEditMode, contentRef, keepMenuVisibleRef, onScrollPositionCapture, crossBlockSelection]);

  return {
    selectionMenu,
    setSelectionMenu,
  };
}
