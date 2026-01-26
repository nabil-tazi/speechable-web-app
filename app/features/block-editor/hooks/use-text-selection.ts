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
 * Calculate character offset from container start to a specific node/offset,
 * counting <br> elements as newline characters.
 */
function getCharacterOffset(
  container: Node,
  targetNode: Node,
  targetOffset: number
): number {
  let offset = 0;

  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        if (node.nodeName === "BR") return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      },
    }
  );

  let node: Node | null = walker.nextNode();
  while (node) {
    if (node === targetNode) {
      // Target is this node - add the offset within it
      if (node.nodeType === Node.TEXT_NODE) {
        offset += targetOffset;
      }
      // For BR, offset is always 0 or 1, but we've already counted it
      return offset;
    }

    // Count this node's contribution
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent?.length || 0;
    } else if (node.nodeName === "BR") {
      offset += 1; // Count BR as newline character
    }

    node = walker.nextNode();
  }

  // If target node is the container itself (cursor at element boundary)
  if (targetNode === container) {
    return offset;
  }

  return offset;
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
      // Use DOM walking to properly count <br> elements as newline characters
      const selectionStart = getCharacterOffset(
        contentRef.current,
        range.startContainer,
        range.startOffset
      );
      const selectionEnd = getCharacterOffset(
        contentRef.current,
        range.endContainer,
        range.endOffset
      );

      // If selection top is above viewport, clamp to minimum visible position
      // Match the editor-floating-menu constants: MENU_HEIGHT (50) + VIEWPORT_PADDING (60) = 110
      const minY = 110;
      const menuY = Math.max(minY, rect.top - 8);

      const relativeX = rect.left + rect.width / 2 - contentRect.left;
      const relativeY = rect.top - contentRect.top - 8;
      setSelectionMenu({
        visible: true,
        x: relativeX,
        y: relativeY,
        text: selectedText,
        fixedX: rect.left + rect.width / 2,
        fixedY: menuY,
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
