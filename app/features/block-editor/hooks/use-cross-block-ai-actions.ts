import { useCallback, useState } from "react";
import type { ActionType, CrossBlockSelection, EditorAction } from "../types";

export interface CrossBlockPendingReplacement {
  originalText: string;
  newText: string;
  action: ActionType;
  selection: CrossBlockSelection;
}

export interface InsufficientCreditsInfo {
  creditsNeeded: number;
  creditsAvailable: number;
  nextRefillDate: string | null;
}

interface UseCrossBlockAIActionsOptions {
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
 */
export function useCrossBlockAIActions({
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

  // Handle AI action for cross-block selection
  const handleCrossBlockAction = useCallback(
    async (action: ActionType) => {
      if (!crossBlockSelection || processingAction) return;

      const selectedText = crossBlockSelection.selectedText;
      if (!selectedText.trim()) return;

      setProcessingAction(action);

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
          setTimeout(() => setNoChangesMessage(null), 2000);
        } else {
          setPendingReplacement({
            originalText: selectedText,
            newText: result,
            action,
            selection: crossBlockSelection,
          });
        }
      }

      setProcessingAction(null);
    },
    [crossBlockSelection, processingAction, callTextApi]
  );

  // Accept the pending replacement
  const handleAcceptReplacement = useCallback(() => {
    if (!pendingReplacement) return;

    dispatch({
      type: "REPLACE_CROSS_BLOCK_SELECTION",
      newText: pendingReplacement.newText,
    });

    // Clear browser selection
    window.getSelection()?.removeAllRanges();

    setPendingReplacement(null);
  }, [pendingReplacement, dispatch]);

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

    const { action, originalText, selection } = pendingReplacement;
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
        setTimeout(() => setNoChangesMessage(null), 2000);
      } else {
        setPendingReplacement({
          originalText,
          newText: result,
          action,
          selection,
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
