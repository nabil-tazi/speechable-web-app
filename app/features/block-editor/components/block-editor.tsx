"use client";

import React, { useCallback, useRef, useEffect, useMemo } from "react";
import { useEditor } from "../context/editor-provider";
import { BlockComponent } from "./block";
import { EditorFloatingMenu } from "./editor-floating-menu";
import { Plus, Heading1, Heading2, Heading3, Heading4, Type } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { BlockType } from "@/app/features/documents/types";
import { useSentences, usePlayback } from "@/app/features/tts";
import { useCredits } from "@/app/features/users/context";
import { cn } from "@/lib/utils";
import { getDisabledBlockIds } from "../utils/disabled-sections";
import {
  useCrossBlockSelection,
  useCrossBlockKeyboard,
  useCrossBlockAIActions,
} from "../hooks";
import InsufficientCreditsDialog from "@/app/features/credits/components/insufficient-credits-dialog";

interface BlockEditorProps {
  isEditMode?: boolean;
  isConversation?: boolean;
}

export function BlockEditor({ isEditMode = false, isConversation = false }: BlockEditorProps) {
  const { state, addBlock, updateBlock, dispatch } = useEditor();
  const { updateCredits } = useCredits();

  // TTS integration
  const { sentences, currentSentence, currentIndex } = useSentences();
  const { isPlaybackOn, playFromSentence } = usePlayback();

  // Ref for auto-scrolling to playing sentence
  const playingSentenceRef = useRef<HTMLDivElement>(null);

  // Cross-block selection hook
  const { crossBlockSelection } = useCrossBlockSelection({
    isEditMode,
    blocks: state.blocks,
    dispatch,
    crossBlockSelection: state.crossBlockSelection,
  });

  // Cross-block keyboard handling
  useCrossBlockKeyboard({
    isEditMode,
    crossBlockSelection,
    dispatch,
  });

  // Cross-block AI actions
  const {
    processingAction: crossBlockProcessingAction,
    pendingReplacement: crossBlockPendingReplacement,
    noChangesMessage: crossBlockNoChangesMessage,
    insufficientCreditsInfo,
    handleCrossBlockAction,
    handleAcceptReplacement: handleCrossBlockAcceptReplacement,
    handleDiscardReplacement: handleCrossBlockDiscardReplacement,
    handleTryAgain: handleCrossBlockTryAgain,
    clearInsufficientCreditsInfo,
  } = useCrossBlockAIActions({
    crossBlockSelection,
    dispatch,
    onCreditsUpdated: updateCredits,
  });

  // Get sorted blocks once (for consistent index mapping)
  const sortedBlocks = useMemo(
    () => state.blocks.slice().sort((a, b) => a.order - b.order),
    [state.blocks]
  );

  // Compute disabled block IDs for visual indication
  const disabledBlockIds = useMemo(
    () => getDisabledBlockIds(state.blocks),
    [state.blocks]
  );

  // Group sentences by segmentIndex
  const sentencesBySegment = useMemo(() => {
    const grouped = new Map<number, typeof sentences>();
    for (const sentence of sentences) {
      const existing = grouped.get(sentence.segmentIndex) || [];
      existing.push(sentence);
      grouped.set(sentence.segmentIndex, existing);
    }
    return grouped;
  }, [sentences]);

  // Map block index to segment index (accounting for empty blocks being skipped)
  // parseSegmentsFromBlocks skips empty blocks, so segmentIndex doesn't match block index
  const blockIndexToSegmentIndex = useMemo(() => {
    const mapping = new Map<number, number>();
    let segmentIndex = 0;
    sortedBlocks.forEach((block, blockIndex) => {
      if (block.content.trim()) {
        mapping.set(blockIndex, segmentIndex);
        segmentIndex++;
      }
    });
    return mapping;
  }, [sortedBlocks]);

  // Auto-scroll to currently playing sentence
  useEffect(() => {
    if (playingSentenceRef.current && isPlaybackOn && currentSentence) {
      const scrollContainer = document.querySelector(
        '[data-scroll-container="true"]'
      );
      if (scrollContainer) {
        const headerOffset = 80; // Account for fixed header
        const elementRect = playingSentenceRef.current.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();

        // Check if element is outside visible area (accounting for header offset)
        const isAboveViewport = elementRect.top < containerRect.top + headerOffset;
        const isBelowViewport = elementRect.bottom > containerRect.bottom;

        if (isAboveViewport || isBelowViewport) {
          const elementTop = elementRect.top;
          const containerTop = containerRect.top;
          const scrollTop =
            scrollContainer.scrollTop + elementTop - containerTop - headerOffset;
          scrollContainer.scrollTo({
            top: scrollTop,
            behavior: "smooth",
          });
        }
      }
    }
  }, [currentIndex, isPlaybackOn, currentSentence]);

  const handleSelectBlock = useCallback(
    (blockId: string) => {
      dispatch({ type: "SELECT_BLOCK", blockId });
    },
    [dispatch]
  );

  const handleFocusBlock = useCallback(
    (blockId: string) => {
      dispatch({ type: "FOCUS_BLOCK", blockId });
    },
    [dispatch]
  );

  const handleAddBlock = useCallback(
    (type: BlockType) => {
      addBlock({ type, content: "" });
    },
    [addBlock]
  );

  const handleSentenceClick = useCallback(
    (globalIndex: number) => {
      playFromSentence(globalIndex);
    },
    [playFromSentence]
  );

  // Handle type change for all selected blocks in cross-block selection
  const handleCrossBlockTypeChange = useCallback(
    (type: BlockType) => {
      if (!crossBlockSelection) return;
      for (const blockId of crossBlockSelection.selectedBlockIds) {
        updateBlock(blockId, { type });
      }
    },
    [crossBlockSelection, updateBlock]
  );

  // Determine which segment contains the currently playing sentence
  const playingSegmentIndex = isPlaybackOn && currentSentence
    ? currentSentence.segmentIndex
    : -1;

  return (
    <div className="px-4 py-6 pb-24 min-h-screen bg-sidebar">
      {/* Paper container - wider in edit mode to accommodate padding */}
      <div
        className={cn(
          "mx-auto transition-all duration-300 border border-transparent",
          isEditMode
            ? "max-w-4xl bg-white shadow-lg rounded-xl border-gray-200 p-16"
            : "max-w-3xl"
        )}
      >
        {/* Content wrapper - maintains consistent text width */}
        <div className="max-w-3xl mx-auto space-y-1">
          {sortedBlocks.map((block, index) => {
            // Skip disabled blocks entirely (they're hidden until re-enabled)
            if (disabledBlockIds.has(block.id)) return null;

            // Use mapping to get correct segmentIndex for this block
            const segmentIndex = blockIndexToSegmentIndex.get(index);
            const blockSentences = segmentIndex !== undefined
              ? sentencesBySegment.get(segmentIndex) || []
              : [];
            const hasPlayingSentence = segmentIndex === playingSegmentIndex;
            return (
              <div
                key={block.id}
                ref={hasPlayingSentence ? playingSentenceRef : null}
              >
                <BlockComponent
                  block={block}
                  isSelected={state.selectedBlockId === block.id}
                  isFocused={state.focusedBlockId === block.id}
                  isEditMode={isEditMode}
                  isConversation={isConversation}
                  sentences={blockSentences}
                  currentPlayingIndex={currentIndex}
                  isPlaybackOn={isPlaybackOn}
                  crossBlockSelection={crossBlockSelection}
                  onSelect={() => handleSelectBlock(block.id)}
                  onFocus={() => handleFocusBlock(block.id)}
                  onSentenceClick={handleSentenceClick}
                />
              </div>
            );
          })}

          {/* Add block button with dropdown - only in edit mode */}
          {isEditMode && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full py-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add block
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                <DropdownMenuItem onClick={() => handleAddBlock("text")}>
                  <Type className="h-4 w-4 mr-2" />
                  Text
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAddBlock("heading1")}>
                  <Heading1 className="h-4 w-4 mr-2" />
                  Heading 1
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAddBlock("heading2")}>
                  <Heading2 className="h-4 w-4 mr-2" />
                  Heading 2
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAddBlock("heading3")}>
                  <Heading3 className="h-4 w-4 mr-2" />
                  Heading 3
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAddBlock("heading4")}>
                  <Heading4 className="h-4 w-4 mr-2" />
                  Heading 4
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Editor-level floating menu for cross-block selection */}
      {isEditMode && crossBlockSelection && (
        <EditorFloatingMenu
          crossBlockSelection={crossBlockSelection}
          pendingReplacement={crossBlockPendingReplacement}
          processingAction={crossBlockProcessingAction}
          noChangesMessage={crossBlockNoChangesMessage}
          onAction={handleCrossBlockAction}
          onAcceptReplacement={handleCrossBlockAcceptReplacement}
          onDiscardReplacement={handleCrossBlockDiscardReplacement}
          onTryAgain={handleCrossBlockTryAgain}
          onTypeChange={handleCrossBlockTypeChange}
        />
      )}

      {/* Insufficient credits dialog */}
      <InsufficientCreditsDialog
        isOpen={!!insufficientCreditsInfo}
        onClose={clearInsufficientCreditsInfo}
        creditsNeeded={insufficientCreditsInfo?.creditsNeeded ?? 0}
        creditsAvailable={insufficientCreditsInfo?.creditsAvailable ?? 0}
        nextRefillDate={insufficientCreditsInfo?.nextRefillDate ?? null}
      />
    </div>
  );
}
