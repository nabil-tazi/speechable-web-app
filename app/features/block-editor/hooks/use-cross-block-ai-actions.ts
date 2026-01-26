import { useCallback, useState } from "react";
import type { Block } from "@/app/features/documents/types";
import type { ActionType, CrossBlockSelection, EditorAction } from "../types";

// Per-block replacement info
export interface BlockReplacement {
  blockId: string;
  originalText: string;
  newText: string;
  // For start/end blocks, we need to know where to splice
  startOffset: number;
  endOffset: number;
}

export interface CrossBlockPendingReplacement {
  action: ActionType;
  selection: CrossBlockSelection;
  blockReplacements: BlockReplacement[];
}

export interface InsufficientCreditsInfo {
  creditsNeeded: number;
  creditsAvailable: number;
  nextRefillDate: string | null;
}

interface UseCrossBlockAIActionsOptions {
  blocks: Block[];
  crossBlockSelection: CrossBlockSelection | null;
  dispatch: React.Dispatch<EditorAction>;
  onCreditsUpdated?: (newCredits: number) => void;
}

interface UseCrossBlockAIActionsReturn {
  processingAction: ActionType | null;
  pendingReplacement: CrossBlockPendingReplacement | null;
  noChangesMessage: string | null;
  insufficientCreditsInfo: InsufficientCreditsInfo | null;
  handleCrossBlockAction: (action: ActionType) => Promise<void>;
  handleAcceptReplacement: () => void;
  handleDiscardReplacement: () => void;
  handleTryAgain: () => Promise<void>;
  clearInsufficientCreditsInfo: () => void;
}

/**
 * Hook for managing AI text actions on cross-block selections.
 * Processes each block separately and applies replacements per-block.
 */
export function useCrossBlockAIActions({
  blocks,
  crossBlockSelection,
  dispatch,
  onCreditsUpdated,
}: UseCrossBlockAIActionsOptions): UseCrossBlockAIActionsReturn {
  const [processingAction, setProcessingAction] = useState<ActionType | null>(null);
  const [pendingReplacement, setPendingReplacement] = useState<CrossBlockPendingReplacement | null>(null);
  const [noChangesMessage, setNoChangesMessage] = useState<string | null>(null);
  const [insufficientCreditsInfo, setInsufficientCreditsInfo] = useState<InsufficientCreditsInfo | null>(null);

  const clearInsufficientCreditsInfo = useCallback(() => {
    setInsufficientCreditsInfo(null);
  }, []);

  // API call helper for AI text processing
  const callTextApi = useCallback(
    async (endpoint: string, text: string): Promise<string | null> => {
      try {
        const response = await fetch(`/api/deepinfra-text/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        // Handle insufficient credits
        if (response.status === 402) {
          const errorData = await response.json();
          setInsufficientCreditsInfo({
            creditsNeeded: errorData.creditsNeeded,
            creditsAvailable: errorData.creditsAvailable,
            nextRefillDate: errorData.nextRefillDate || null,
          });
          return null;
        }

        if (!response.ok) {
          console.error(`API error: ${response.status}`);
          return null;
        }

        const data = await response.json();

        // Update credits if callback provided and credits info returned
        if (onCreditsUpdated && typeof data.creditsRemaining === "number") {
          onCreditsUpdated(data.creditsRemaining);
        }

        return data.result || null;
      } catch (error) {
        console.error(`Error calling ${endpoint}:`, error);
        return null;
      }
    },
    [onCreditsUpdated]
  );

  // Get the selected text portion for a specific block
  const getBlockSelectedText = useCallback(
    (blockId: string): { text: string; startOffset: number; endOffset: number } | null => {
      if (!crossBlockSelection) return null;

      const { startBlockId, endBlockId, startOffset, endOffset, selectedBlockIds } = crossBlockSelection;
      const block = blocks.find((b) => b.id === blockId);
      if (!block) return null;

      const blockIndex = selectedBlockIds.indexOf(blockId);
      if (blockIndex === -1) return null;

      const isStartBlock = blockId === startBlockId;
      const isEndBlock = blockId === endBlockId;

      let textStartOffset: number;
      let textEndOffset: number;

      if (isStartBlock && isEndBlock) {
        // Selection is within a single block (shouldn't happen for cross-block, but handle it)
        textStartOffset = startOffset;
        textEndOffset = endOffset;
      } else if (isStartBlock) {
        // First block: from startOffset to end of content
        textStartOffset = startOffset;
        textEndOffset = block.content.length;
      } else if (isEndBlock) {
        // Last block: from start to endOffset
        textStartOffset = 0;
        textEndOffset = endOffset;
      } else {
        // Middle block: entire content
        textStartOffset = 0;
        textEndOffset = block.content.length;
      }

      const text = block.content.slice(textStartOffset, textEndOffset);
      return { text, startOffset: textStartOffset, endOffset: textEndOffset };
    },
    [blocks, crossBlockSelection]
  );

  // Handle AI action for cross-block selection - process each block separately
  const handleCrossBlockAction = useCallback(
    async (action: ActionType) => {
      if (!crossBlockSelection || processingAction) return;

      const { selectedBlockIds } = crossBlockSelection;
      if (selectedBlockIds.length === 0) return;

      setProcessingAction(action);

      const endpoint =
        action === "optimize"
          ? "optimize-audio"
          : action === "summarize"
          ? "summarize"
          : "fix-spelling";

      // Process each block in parallel
      const replacementPromises = selectedBlockIds.map(async (blockId): Promise<BlockReplacement | null> => {
        const selectedInfo = getBlockSelectedText(blockId);
        if (!selectedInfo || !selectedInfo.text.trim()) return null;

        const block = blocks.find((b) => b.id === blockId);
        const isHeading = block?.type?.startsWith("heading");

        // Skip API call for headings (except fix-spelling) - return original text unchanged
        if (isHeading && action !== "fix-spelling") {
          return {
            blockId,
            originalText: selectedInfo.text,
            newText: selectedInfo.text, // Keep original
            startOffset: selectedInfo.startOffset,
            endOffset: selectedInfo.endOffset,
          };
        }

        const result = await callTextApi(endpoint, selectedInfo.text);
        if (!result) return null;

        return {
          blockId,
          originalText: selectedInfo.text,
          newText: result,
          startOffset: selectedInfo.startOffset,
          endOffset: selectedInfo.endOffset,
        };
      });

      const results = await Promise.all(replacementPromises);
      const validReplacements = results.filter((r): r is BlockReplacement => r !== null);

      // Filter out blocks with no changes (e.g., headings that were skipped)
      const changedReplacements = validReplacements.filter(
        (r) => r.newText.trim() !== r.originalText.trim()
      );

      if (changedReplacements.length > 0) {
        setPendingReplacement({
          action,
          selection: crossBlockSelection,
          blockReplacements: changedReplacements,
        });
        // Clear browser selection after DOM updates to diff view
        setTimeout(() => {
          window.getSelection()?.removeAllRanges();
        }, 0);
      } else if (validReplacements.length > 0 && action === "fix-spelling") {
        // All blocks had no spelling errors
        setNoChangesMessage("No spelling errors found");
        setTimeout(() => setNoChangesMessage(null), 2000);
      }

      setProcessingAction(null);
    },
    [blocks, crossBlockSelection, processingAction, callTextApi, getBlockSelectedText]
  );

  // Accept the pending replacement - apply all block replacements in a single batch
  const handleAcceptReplacement = useCallback(() => {
    if (!pendingReplacement) return;

    const { blockReplacements } = pendingReplacement;

    // Build batch updates for all blocks
    const batchUpdates: Array<{ blockId: string; updates: { content: string } }> = [];

    for (const replacement of blockReplacements) {
      const block = blocks.find((b) => b.id === replacement.blockId);
      if (!block) continue;

      // Splice the new text into the block content
      const newContent =
        block.content.slice(0, replacement.startOffset) +
        replacement.newText +
        block.content.slice(replacement.endOffset);

      batchUpdates.push({
        blockId: replacement.blockId,
        updates: { content: newContent },
      });
    }

    // Apply all updates in a single action (single undo step)
    if (batchUpdates.length > 0) {
      dispatch({
        type: "UPDATE_BLOCKS_BATCH",
        updates: batchUpdates,
      });
    }

    // Clear cross-block selection
    dispatch({ type: "SET_CROSS_BLOCK_SELECTION", selection: null });

    setPendingReplacement(null);

    // Clear browser selection after DOM updates (setTimeout ensures it runs after React re-render)
    setTimeout(() => {
      window.getSelection()?.removeAllRanges();
    }, 0);
  }, [pendingReplacement, blocks, dispatch]);

  // Discard the pending replacement
  const handleDiscardReplacement = useCallback(() => {
    setPendingReplacement(null);
    dispatch({ type: "SET_CROSS_BLOCK_SELECTION", selection: null });

    // Clear browser selection
    window.getSelection()?.removeAllRanges();
  }, [dispatch]);

  // Try again with the same action
  const handleTryAgain = useCallback(async () => {
    if (!pendingReplacement) return;

    const { action, selection, blockReplacements } = pendingReplacement;
    setPendingReplacement(null);
    setProcessingAction(action);

    const endpoint =
      action === "optimize"
        ? "optimize-audio"
        : action === "summarize"
        ? "summarize"
        : "fix-spelling";

    // Re-process each block
    const replacementPromises = blockReplacements.map(async (prevReplacement): Promise<BlockReplacement | null> => {
      const result = await callTextApi(endpoint, prevReplacement.originalText);
      if (!result) return null;

      return {
        ...prevReplacement,
        newText: result,
      };
    });

    const results = await Promise.all(replacementPromises);
    const validReplacements = results.filter((r): r is BlockReplacement => r !== null);

    if (validReplacements.length > 0) {
      const allNoChanges = action === "fix-spelling" &&
        validReplacements.every((r) => r.newText.trim() === r.originalText.trim());

      if (allNoChanges) {
        setNoChangesMessage("No spelling errors found");
        setTimeout(() => setNoChangesMessage(null), 2000);
      } else {
        setPendingReplacement({
          action,
          selection,
          blockReplacements: validReplacements,
        });
      }
    }

    setProcessingAction(null);
  }, [pendingReplacement, callTextApi]);

  return {
    processingAction,
    pendingReplacement,
    noChangesMessage,
    insufficientCreditsInfo,
    handleCrossBlockAction,
    handleAcceptReplacement,
    handleDiscardReplacement,
    handleTryAgain,
    clearInsufficientCreditsInfo,
  };
}
