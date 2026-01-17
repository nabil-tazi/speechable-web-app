import { useCallback, useState } from "react";
import { getTextContent } from "../utils/dom";
import type { ActionType, PendingReplacement, SelectionMenu } from "../types";
import type { BlockInput } from "@/app/features/documents/types";

interface UseAITextActionsOptions {
  contentRef: React.RefObject<HTMLDivElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  blockId: string;
  blockContent: string;
  updateBlock: (blockId: string, updates: { content: string }) => void;
  addBlock: (block: BlockInput, afterBlockId: string) => void;
  lastSyncedContentRef: React.MutableRefObject<string>;
  getScrollContainer: () => HTMLElement | null;
  originalScrollPosRef: React.MutableRefObject<number>;
  setSelectionMenu: React.Dispatch<React.SetStateAction<SelectionMenu>>;
  setIsEditing: (editing: boolean) => void;
}

interface UseAITextActionsReturn {
  processingAction: ActionType | null;
  pendingReplacement: PendingReplacement | null;
  noChangesMessage: string | null;
  handleSelectionAction: (action: ActionType) => Promise<void>;
  handleBlockAction: (action: ActionType) => Promise<void>;
  handleAcceptReplacement: () => void;
  handleDiscardReplacement: () => void;
  handleTryAgain: () => Promise<void>;
  handleInsertBelow: () => void;
  setPendingReplacement: React.Dispatch<React.SetStateAction<PendingReplacement | null>>;
}

/**
 * Hook for managing AI text actions (optimize, summarize, fix-spelling).
 */
export function useAITextActions({
  contentRef,
  containerRef,
  blockId,
  blockContent,
  updateBlock,
  addBlock,
  lastSyncedContentRef,
  getScrollContainer,
  originalScrollPosRef,
  setSelectionMenu,
  setIsEditing,
}: UseAITextActionsOptions): UseAITextActionsReturn {
  const [processingAction, setProcessingAction] = useState<ActionType | null>(null);
  const [pendingReplacement, setPendingReplacement] = useState<PendingReplacement | null>(null);
  const [noChangesMessage, setNoChangesMessage] = useState<string | null>(null);

  // API call helper for AI text processing
  const callTextApi = useCallback(
    async (endpoint: string, text: string): Promise<string | null> => {
      try {
        const response = await fetch(`/api/deepinfra-text/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        if (!response.ok) {
          console.error(`API error: ${response.status}`);
          return null;
        }

        const data = await response.json();
        return data.result || null;
      } catch (error) {
        console.error(`Error calling ${endpoint}:`, error);
        return null;
      }
    },
    []
  );

  // Handle AI action for selected text
  const handleSelectionAction = useCallback(
    async (action: ActionType) => {
      if (!contentRef.current || processingAction) return;

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const rawSelectedText = selection.toString();
      const selectedText = rawSelectedText.trim();
      if (!selectedText) return;

      // Sync DOM content to block state before calculating positions
      const currentDomContent = getTextContent(contentRef.current);
      if (currentDomContent !== blockContent) {
        updateBlock(blockId, { content: currentDomContent });
        lastSyncedContentRef.current = currentDomContent;
      }

      // Save scroll position for scroll-to-target button
      const container = getScrollContainer();
      originalScrollPosRef.current = container?.scrollTop || 0;

      // Calculate selection positions based on the synced content
      const range = selection.getRangeAt(0);
      const preRange = range.cloneRange();
      preRange.selectNodeContents(contentRef.current);
      preRange.setEnd(range.startContainer, range.startOffset);
      const selectionStart = preRange.toString().length;
      const selectionEnd = selectionStart + rawSelectedText.length;

      // Calculate trimmed positions to know exactly what text to replace
      const leadingSpaces = rawSelectedText.length - rawSelectedText.trimStart().length;
      const trailingSpaces = rawSelectedText.length - rawSelectedText.trimEnd().length;
      const trimmedStart = selectionStart + leadingSpaces;
      const trimmedEnd = selectionEnd - trailingSpaces;

      setProcessingAction(action);
      setSelectionMenu((prev) => ({ ...prev, visible: false }));

      const endpoint =
        action === "optimize"
          ? "optimize-audio"
          : action === "summarize"
          ? "summarize"
          : "fix-spelling";

      const result = await callTextApi(endpoint, selectedText);

      if (result) {
        // Check if there are no changes (for fix-spelling)
        if (action === "fix-spelling" && result.trim() === selectedText.trim()) {
          setNoChangesMessage("No spelling errors found");
          setSelectionMenu((prev) => ({ ...prev, visible: false }));
          setTimeout(() => setNoChangesMessage(null), 2000);
        } else {
          // Exit edit mode before showing preview
          setIsEditing(false);
          setPendingReplacement({
            originalText: selectedText,
            newText: result,
            action,
            isSelection: true,
            selectionStart: trimmedStart,
            selectionEnd: trimmedEnd,
            fullContent: currentDomContent,
          });
        }
      }

      setProcessingAction(null);
    },
    [
      callTextApi,
      processingAction,
      getScrollContainer,
      blockContent,
      blockId,
      updateBlock,
      contentRef,
      lastSyncedContentRef,
      originalScrollPosRef,
      setSelectionMenu,
      setIsEditing,
    ]
  );

  // Handle AI action for entire block
  const handleBlockAction = useCallback(
    async (action: ActionType) => {
      if (processingAction || !blockContent.trim()) return;

      // Save scroll position for scroll-to-target button
      const container = getScrollContainer();
      originalScrollPosRef.current = container?.scrollTop || 0;

      setProcessingAction(action);

      // Show floating menu centered on block with loading state
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setSelectionMenu({
          visible: true,
          x: rect.width / 2,
          y: 0,
          text: blockContent,
          fixedX: rect.left + rect.width / 2,
          fixedY: rect.top,
        });
      }

      const endpoint =
        action === "optimize"
          ? "optimize-audio"
          : action === "summarize"
          ? "summarize"
          : "fix-spelling";

      const result = await callTextApi(endpoint, blockContent);

      if (result) {
        if (action === "fix-spelling" && result.trim() === blockContent.trim()) {
          setNoChangesMessage("No spelling errors found");
          setSelectionMenu((prev) => ({ ...prev, visible: false }));
          setTimeout(() => setNoChangesMessage(null), 2000);
        } else {
          setIsEditing(false);
          setPendingReplacement({
            originalText: blockContent,
            newText: result,
            action,
            isSelection: false,
          });
        }
      } else {
        setSelectionMenu((prev) => ({ ...prev, visible: false }));
      }

      setProcessingAction(null);
    },
    [
      callTextApi,
      processingAction,
      blockContent,
      getScrollContainer,
      containerRef,
      originalScrollPosRef,
      setSelectionMenu,
      setIsEditing,
    ]
  );

  // Accept the pending replacement
  const handleAcceptReplacement = useCallback(() => {
    if (!pendingReplacement) return;

    let newContent: string;

    if (
      pendingReplacement.isSelection &&
      typeof pendingReplacement.selectionStart === "number" &&
      typeof pendingReplacement.selectionEnd === "number"
    ) {
      const content = pendingReplacement.fullContent || blockContent;
      const index = content.indexOf(pendingReplacement.originalText);

      if (index !== -1) {
        const before = content.slice(0, index);
        const after = content.slice(index + pendingReplacement.originalText.length);
        newContent = before + pendingReplacement.newText + after;
      } else {
        console.error("Original text not found in content!");
        const before = content.slice(0, pendingReplacement.selectionStart);
        const after = content.slice(pendingReplacement.selectionEnd);
        newContent = before + pendingReplacement.newText + after;
      }
    } else {
      newContent = pendingReplacement.newText;
    }

    if (typeof newContent === "string") {
      updateBlock(blockId, { content: newContent });
      lastSyncedContentRef.current = newContent;
    }

    setPendingReplacement(null);
    setSelectionMenu((prev) => ({ ...prev, visible: false }));
  }, [pendingReplacement, blockContent, blockId, updateBlock, lastSyncedContentRef, setSelectionMenu]);

  // Discard the pending replacement
  const handleDiscardReplacement = useCallback(() => {
    setPendingReplacement(null);
    setSelectionMenu((prev) => ({ ...prev, visible: false }));
  }, [setSelectionMenu]);

  // Try again with the same action
  const handleTryAgain = useCallback(async () => {
    if (!pendingReplacement) return;

    const { action, isSelection, originalText, selectionStart, selectionEnd, fullContent } =
      pendingReplacement;
    setPendingReplacement(null);
    setProcessingAction(action);

    const endpoint =
      action === "optimize"
        ? "optimize-audio"
        : action === "summarize"
        ? "summarize"
        : "fix-spelling";

    const result = await callTextApi(endpoint, originalText);

    if (result) {
      if (action === "fix-spelling" && result.trim() === originalText.trim()) {
        setNoChangesMessage("No spelling errors found");
        setSelectionMenu((prev) => ({ ...prev, visible: false }));
        setTimeout(() => setNoChangesMessage(null), 2000);
      } else {
        setPendingReplacement({
          originalText,
          newText: result,
          action,
          isSelection,
          selectionStart,
          selectionEnd,
          fullContent,
        });
      }
    }

    setProcessingAction(null);
  }, [pendingReplacement, callTextApi, setSelectionMenu]);

  // Insert below instead of replacing
  const handleInsertBelow = useCallback(() => {
    if (!pendingReplacement) return;

    if (pendingReplacement.isSelection) {
      const content = pendingReplacement.fullContent || blockContent;
      const slicedText = content.slice(
        pendingReplacement.selectionStart ?? 0,
        pendingReplacement.selectionEnd
      );

      let insertIndex: number;
      if (slicedText === pendingReplacement.originalText) {
        insertIndex = pendingReplacement.selectionEnd!;
      } else {
        const foundIndex = content.indexOf(pendingReplacement.originalText);
        if (foundIndex !== -1) {
          insertIndex = foundIndex + pendingReplacement.originalText.length;
        } else {
          insertIndex = pendingReplacement.selectionEnd!;
        }
      }

      const before = content.slice(0, insertIndex);
      const after = content.slice(insertIndex);
      const newContent = before + " " + pendingReplacement.newText + after;
      updateBlock(blockId, { content: newContent });
      lastSyncedContentRef.current = newContent;
    } else {
      addBlock({ type: "text", content: pendingReplacement.newText }, blockId);
    }

    setPendingReplacement(null);
    setSelectionMenu((prev) => ({ ...prev, visible: false }));
  }, [pendingReplacement, blockContent, blockId, updateBlock, addBlock, lastSyncedContentRef, setSelectionMenu]);

  return {
    processingAction,
    pendingReplacement,
    noChangesMessage,
    handleSelectionAction,
    handleBlockAction,
    handleAcceptReplacement,
    handleDiscardReplacement,
    handleTryAgain,
    handleInsertBelow,
    setPendingReplacement,
  };
}
