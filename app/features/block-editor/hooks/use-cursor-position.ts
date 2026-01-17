import { useCallback } from "react";

interface UseCursorPositionReturn {
  getCursorPosition: () => number;
  isCursorAtEnd: () => boolean;
  findNodeAndOffset: (container: Node, targetOffset: number) => { node: Node; offset: number } | null;
  setSelectionRange: (start: number, end?: number) => void;
}

/**
 * Hook for cursor position manipulation in contentEditable elements.
 */
export function useCursorPosition(
  contentRef: React.RefObject<HTMLDivElement | null>
): UseCursorPositionReturn {
  // Helper to get current cursor position (counts BR elements as newlines)
  const getCursorPosition = useCallback(() => {
    if (!contentRef.current) return 0;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return 0;
    const range = selection.getRangeAt(0);
    const cursorContainer = range.startContainer;
    const cursorOffset = range.startOffset;

    let position = 0;

    // Walk through all nodes before the cursor
    const walker = document.createTreeWalker(
      contentRef.current,
      NodeFilter.SHOW_ALL,
      null
    );

    let node: Node | null = walker.nextNode();
    while (node) {
      // If we've reached the cursor container
      if (node === cursorContainer) {
        if (node.nodeType === Node.TEXT_NODE) {
          position += cursorOffset;
        }
        // For element nodes, cursorOffset is child index - handled below
        break;
      }

      // Count text content
      if (node.nodeType === Node.TEXT_NODE) {
        position += node.textContent?.length || 0;
      }
      // Count BR as 1 character (newline)
      else if (node.nodeName === "BR") {
        position += 1;
      }

      node = walker.nextNode();
    }

    // If cursor is in the container element itself (not a text node),
    // cursorOffset represents the child index
    if (cursorContainer === contentRef.current) {
      const children = Array.from(contentRef.current.childNodes);
      for (let i = 0; i < cursorOffset && i < children.length; i++) {
        const child = children[i];
        if (child.nodeType === Node.TEXT_NODE) {
          position += child.textContent?.length || 0;
        } else if (child.nodeName === "BR") {
          position += 1;
        } else {
          position += child.textContent?.length || 0;
        }
      }
    }

    return position;
  }, [contentRef]);

  // Helper to check if cursor is at the very end of the content
  const isCursorAtEnd = useCallback(() => {
    if (!contentRef.current) return false;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);

    // Create a range from cursor to end of content
    const afterCaretRange = range.cloneRange();
    afterCaretRange.selectNodeContents(contentRef.current);
    afterCaretRange.setStart(range.endContainer, range.endOffset);

    // Check if there's any text content after cursor
    const textAfter = afterCaretRange.toString();
    if (textAfter.length > 0) return false;

    // Also check if there are any non-empty nodes after cursor (like BR followed by text)
    const fragment = afterCaretRange.cloneContents();
    const hasContentAfter =
      fragment.textContent && fragment.textContent.length > 0;

    return !hasContentAfter;
  }, [contentRef]);

  // Helper to find the node and offset for a given character position
  const findNodeAndOffset = useCallback(
    (
      container: Node,
      targetOffset: number
    ): { node: Node; offset: number } | null => {
      let currentOffset = 0;

      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: (node) => {
            // Accept text nodes and BR elements
            if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
            if (node.nodeName === "BR") return NodeFilter.FILTER_ACCEPT;
            return NodeFilter.FILTER_SKIP;
          },
        }
      );

      let node: Node | null = walker.nextNode();
      while (node) {
        if (node.nodeType === Node.TEXT_NODE) {
          const textLength = node.textContent?.length || 0;
          if (currentOffset + textLength >= targetOffset) {
            // Target is within this text node
            return { node, offset: targetOffset - currentOffset };
          }
          currentOffset += textLength;
        } else if (node.nodeName === "BR") {
          // BR counts as 1 character (newline)
          if (currentOffset + 1 >= targetOffset) {
            // Target is at the BR - place cursor after it
            return { node, offset: 0 };
          }
          currentOffset += 1;
        }
        node = walker.nextNode();
      }

      // If we've exhausted all nodes, return the last position
      const lastChild = container.lastChild;
      if (lastChild?.nodeType === Node.TEXT_NODE) {
        return { node: lastChild, offset: lastChild.textContent?.length || 0 };
      }
      return null;
    },
    []
  );

  // Helper to set cursor position or selection range
  const setSelectionRange = useCallback(
    (start: number, end?: number) => {
      if (!contentRef.current) return;

      const selection = window.getSelection();
      if (!selection) return;

      const range = document.createRange();

      const startPos = findNodeAndOffset(contentRef.current, start);
      const endPos =
        end !== undefined
          ? findNodeAndOffset(contentRef.current, end)
          : startPos;

      if (!startPos || !endPos) return;

      range.setStart(startPos.node, startPos.offset);
      range.setEnd(endPos.node, endPos.offset);

      selection.removeAllRanges();
      selection.addRange(range);
    },
    [contentRef, findNodeAndOffset]
  );

  return {
    getCursorPosition,
    isCursorAtEnd,
    findNodeAndOffset,
    setSelectionRange,
  };
}
