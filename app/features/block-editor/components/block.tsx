"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BlockType } from "@/app/features/documents/types";

import { useEditor } from "../context/editor-provider";
import { useCredits } from "@/app/features/users/context";
import { ReaderSelector } from "./reader-selector";
import { SentenceRenderer } from "./sentence-renderer";
import { FloatingMenu } from "./floating-menu";
import { BlockDropdownMenu } from "./block-dropdown-menu";
import { PendingReplacementPreview } from "./pending-replacement-preview";
import { DiffRenderer } from "./diff-renderer";
import { PendingEditDialog } from "./pending-edit-dialog";
import InsufficientCreditsDialog from "@/app/features/credits/components/insufficient-credits-dialog";

import {
  useScrollContainer,
  useCursorPosition,
  useContentEditing,
  useTextSelection,
  useAITextActions,
  useBlockKeyboard,
} from "../hooks";

import type { BlockComponentProps } from "../types";

export function BlockComponent({
  block,
  isSelected,
  isFocused,
  isEditMode,
  isConversation = false,
  sentences,
  currentPlayingIndex,
  isPlaybackOn,
  crossBlockSelection,
  crossBlockReplacement,
  onSelect,
  onFocus,
  onSentenceClick,
}: BlockComponentProps) {
  const { updateBlock, deleteBlock, addBlock, blocks, dispatch } = useEditor();
  const { updateCredits } = useCredits();

  // Refs
  const contentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const blockContainerRef = useRef<HTMLDivElement>(null);
  const newTextRef = useRef<HTMLSpanElement>(null);
  const scrollTargetRef = useRef<HTMLDivElement>(null);
  const selectionRangeRef = useRef<{ start: number; end: number } | null>(null);
  const isDraggingRef = useRef(false);
  const dragAnchorOffsetRef = useRef<number | null>(null);
  const pendingSelectionRef = useRef<{
    anchorOffset: number;
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const crossBlockDragActiveRef = useRef(false);
  const savedAnchorPositionRef = useRef<{ node: Node; offset: number } | null>(
    null,
  );

  // Local state
  const [isEditing, setIsEditing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showPendingDialog, setShowPendingDialog] = useState(false);
  const [buttonsPosition, setButtonsPosition] = useState<{
    top: number;
  } | null>(null);
  const [customSelection, setCustomSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);

  // Scroll container hook
  const {
    getScrollContainer,
    scrollToTarget,
    isScrolledAway,
    originalScrollPosRef,
    keepMenuVisibleRef,
  } = useScrollContainer({
    containerRef,
    isMenuVisible: false, // Will be updated below
  });

  // Content editing hook
  const {
    handleInput,
    handleBlur: handleContentBlur,
    lastSyncedContentRef,
    debounceTimerRef,
  } = useContentEditing({
    contentRef,
    blockId: block.id,
    blockContent: block.content,
    updateBlock,
  });

  // Cursor position hook
  const { getCursorPosition, isCursorAtEnd, setSelectionRange } =
    useCursorPosition(contentRef);

  // Text selection hook
  const { selectionMenu, setSelectionMenu } = useTextSelection({
    contentRef,
    isEditMode,
    keepMenuVisibleRef,
    onScrollPositionCapture: useCallback(() => {
      const container = getScrollContainer();
      originalScrollPosRef.current = container?.scrollTop || 0;
    }, [getScrollContainer, originalScrollPosRef]),
    crossBlockSelection,
  });

  // AI text actions hook
  const {
    processingAction,
    pendingReplacement,
    noChangesMessage,
    insufficientCreditsInfo,
    handleSelectionAction,
    handleBlockAction,
    handleAcceptReplacement,
    handleDiscardReplacement,
    handleTryAgain,
    handleInsertBelow,
    clearInsufficientCreditsInfo,
  } = useAITextActions({
    contentRef,
    containerRef,
    blockId: block.id,
    blockContent: block.content,
    updateBlock,
    addBlock,
    lastSyncedContentRef,
    getScrollContainer,
    originalScrollPosRef,
    selectionMenu,
    setSelectionMenu,
    setIsEditing,
    onCreditsUpdated: updateCredits,
  });

  // Keyboard handler hook
  const { handleKeyDown } = useBlockKeyboard({
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
  });

  // Handler for reader change (conversation mode)
  const handleReaderChange = useCallback(
    (newReaderId: string) => {
      updateBlock(block.id, { reader_id: newReaderId });
    },
    [updateBlock, block.id],
  );

  const handleBlur = () => {
    handleContentBlur(() => setIsEditing(false));
  };

  // Show dialog when clicking outside while pending replacement exists
  useEffect(() => {
    if (!pendingReplacement) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const floatingMenu = document.querySelector(
        '[data-floating-menu="true"]',
      );
      const alertDialog = document.querySelector('[role="alertdialog"]');

      if (floatingMenu?.contains(target) || alertDialog?.contains(target)) {
        return;
      }

      if (blockContainerRef.current?.contains(target)) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      setShowPendingDialog(true);
    };

    document.addEventListener("mousedown", handleClickOutside, true);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside, true);
  }, [pendingReplacement]);

  // Update buttons position when pending replacement changes
  useEffect(() => {
    if (pendingReplacement) {
      const updatePosition = () => {
        if (newTextRef.current && containerRef.current) {
          const rect = newTextRef.current.getBoundingClientRect();
          const containerRect = containerRef.current.getBoundingClientRect();
          setButtonsPosition({ top: rect.bottom - containerRect.top + 4 });
        }
      };
      requestAnimationFrame(updatePosition);
    } else {
      setButtonsPosition(null);
    }
  }, [pendingReplacement]);

  // Set content and focus when entering edit mode
  useEffect(() => {
    if (isEditing && contentRef.current) {
      contentRef.current.innerText = block.content;
      contentRef.current.focus({ preventScroll: true });

      if (selectionRangeRef.current !== null) {
        setSelectionRange(
          selectionRangeRef.current.start,
          selectionRangeRef.current.end,
        );
        selectionRangeRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  // Auto-focus when this block becomes focused
  useEffect(() => {
    if (isFocused && isEditMode && !isEditing) {
      let cursorPosition = 0;
      try {
        const stored = sessionStorage.getItem("block-focus-position");
        if (stored) {
          const { blockId, position } = JSON.parse(stored);
          if (blockId === block.id) {
            cursorPosition = position;
            sessionStorage.removeItem("block-focus-position");
          }
        }
      } catch {
        // Ignore parsing errors
      }

      lastSyncedContentRef.current = block.content;
      selectionRangeRef.current = {
        start: cursorPosition,
        end: cursorPosition,
      };
      setIsEditing(true);
      onSelect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);

  // Sync DOM with block.content when it changes externally
  useEffect(() => {
    if (isEditing && contentRef.current) {
      const domContent = contentRef.current.innerText;
      if (
        block.content !== lastSyncedContentRef.current &&
        block.content !== domContent
      ) {
        const cursorPos = getCursorPosition();
        contentRef.current.innerText = block.content;
        setSelectionRange(Math.min(cursorPos, block.content.length));
      }
      lastSyncedContentRef.current = block.content;
    }
  }, [
    block.content,
    isEditing,
    getCursorPosition,
    setSelectionRange,
    lastSyncedContentRef,
  ]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [debounceTimerRef]);

  // Clear custom selection when menu becomes invisible
  useEffect(() => {
    if (!selectionMenu.visible && customSelection) {
      setCustomSelection(null);
    }
  }, [selectionMenu.visible, customSelection]);

  // Exit edit mode when user drags outside block (for cross-block selection)
  useEffect(() => {
    if (!isEditing || !contentRef.current) return;

    const handleMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;

      // Capture the anchor offset based on where the user clicked (not the current caret position)
      if (contentRef.current) {
        const caretRange = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (
          caretRange &&
          contentRef.current.contains(caretRange.startContainer)
        ) {
          const preRange = document.createRange();
          preRange.selectNodeContents(contentRef.current);
          preRange.setEnd(caretRange.startContainer, caretRange.startOffset);
          dragAnchorOffsetRef.current = preRange.toString().length;
        }
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      dragAnchorOffsetRef.current = null;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !contentRef.current) return;

      const rect = contentRef.current.getBoundingClientRect();
      const isOutside =
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom;

      if (isOutside && dragAnchorOffsetRef.current !== null) {
        // Store pending selection info to restore after DOM updates
        pendingSelectionRef.current = {
          anchorOffset: dragAnchorOffsetRef.current,
          mouseX: e.clientX,
          mouseY: e.clientY,
        };

        // Sync content before exiting edit mode
        const currentContent = contentRef.current.innerText;
        if (currentContent !== lastSyncedContentRef.current) {
          updateBlock(block.id, { content: currentContent });
          lastSyncedContentRef.current = currentContent;
        }

        // Exit edit mode to allow cross-block selection
        setIsEditing(false);
        isDraggingRef.current = false;
        dragAnchorOffsetRef.current = null;
      }
    };

    const content = contentRef.current;
    content.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousemove", handleMouseMove);

    return () => {
      content.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousemove", handleMouseMove);
    };
  }, [isEditing, block.id, updateBlock, lastSyncedContentRef]);

  // Restore selection after exiting edit mode (when DOM has updated)
  useEffect(() => {
    if (isEditing || !pendingSelectionRef.current || !contentRef.current)
      return;

    const { anchorOffset, mouseX, mouseY } = pendingSelectionRef.current;
    pendingSelectionRef.current = null;

    // Find the text node and position for the anchor
    const findTextPosition = (
      element: Node,
      targetOffset: number,
    ): { node: Node; offset: number } | null => {
      let currentOffset = 0;

      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null,
      );
      let node: Text | null;

      while ((node = walker.nextNode() as Text | null)) {
        const nodeLength = node.textContent?.length || 0;
        if (currentOffset + nodeLength >= targetOffset) {
          return { node, offset: targetOffset - currentOffset };
        }
        currentOffset += nodeLength;
      }

      // If we didn't find it, return the last position
      const lastNode = walker.currentNode || element;
      return { node: lastNode, offset: lastNode.textContent?.length || 0 };
    };

    // Find anchor position in the (now non-contentEditable) block
    const anchorPos = findTextPosition(contentRef.current, anchorOffset);
    if (!anchorPos) return;

    // Save anchor position for continued drag updates
    savedAnchorPositionRef.current = anchorPos;
    crossBlockDragActiveRef.current = true;

    // Check if a node is within a valid block element
    const isWithinBlock = (node: Node): boolean => {
      let current: Node | null = node;
      while (current && current !== document.body) {
        if (
          current instanceof HTMLElement &&
          current.hasAttribute("data-block-id")
        ) {
          return true;
        }
        current = current.parentNode;
      }
      return false;
    };

    // Function to update selection from saved anchor to current mouse position
    const updateSelectionToMouse = (mx: number, my: number) => {
      const anchor = savedAnchorPositionRef.current;
      if (!anchor) return;

      const caretRange = document.caretRangeFromPoint(mx, my);
      if (!caretRange) return;

      // Only update selection if the caret position is within a valid block
      if (!isWithinBlock(caretRange.startContainer)) return;

      const selection = window.getSelection();
      if (selection) {
        // Use setBaseAndExtent for better control over anchor vs focus
        selection.setBaseAndExtent(
          anchor.node,
          anchor.offset,
          caretRange.startContainer,
          caretRange.startOffset,
        );
      }
    };

    // Set initial selection
    updateSelectionToMouse(mouseX, mouseY);

    // Continue updating selection as user drags
    const handleMouseMove = (e: MouseEvent) => {
      if (!crossBlockDragActiveRef.current) return;
      updateSelectionToMouse(e.clientX, e.clientY);
    };

    const handleMouseUp = () => {
      crossBlockDragActiveRef.current = false;
      savedAnchorPositionRef.current = null;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isEditing]);

  const handleStartEditing = (e: React.MouseEvent) => {
    lastSyncedContentRef.current = block.content;
    if (contentRef.current) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const preStartRange = range.cloneRange();
        preStartRange.selectNodeContents(contentRef.current);
        preStartRange.setEnd(range.startContainer, range.startOffset);
        const startOffset = preStartRange.toString().length;
        const preEndRange = range.cloneRange();
        preEndRange.selectNodeContents(contentRef.current);
        preEndRange.setEnd(range.endContainer, range.endOffset);
        const endOffset = preEndRange.toString().length;
        selectionRangeRef.current = { start: startOffset, end: endOffset };
      }
    }
    setIsEditing(true);
    onSelect();
    onFocus();
  };

  const getBlockStyles = () => {
    switch (block.type) {
      case "heading1":
        return "text-2xl font-bold";
      case "heading2":
        return "text-xl font-semibold";
      case "heading3":
        return "text-lg font-bold";
      case "heading4":
        return "text-base font-bold";
      default:
        return "text-base";
    }
  };

  const getPlaceholder = () => {
    switch (block.type) {
      case "heading1":
        return "Heading 1";
      case "heading2":
        return "Heading 2";
      case "heading3":
        return "Heading 3";
      case "heading4":
        return "Heading 4";
      default:
        return "Type something...";
    }
  };

  return (
    <div
      ref={blockContainerRef}
      data-block-id={block.id}
      className={cn("group relative flex gap-2 py-1 px-2 rounded-lg", isConversation ? "items-baseline" : "items-start")}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Reader selector - in flex flow for baseline alignment */}
      {isConversation && (
        <div className="flex-shrink-0 -translate-y-[2px]">
          <ReaderSelector
            readerId={block.reader_id}
            onChange={handleReaderChange}
            visible={true}
            readOnly={!isEditMode}
          />
        </div>
      )}

      {/* Block content */}
      <div ref={containerRef} className={cn("flex-1 min-w-0 relative", isConversation ? "pr-8" : "px-8")}>
        {/* No changes notification */}
        {noChangesMessage && (
          <div
            className="z-50 -translate-x-1/2 -translate-y-full fixed"
            style={{ left: selectionMenu.fixedX, top: selectionMenu.fixedY }}
          >
            <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 text-sm text-gray-600 mb-1">
              <Check className="h-4 w-4 text-green-500" />
              {noChangesMessage}
            </div>
          </div>
        )}

        {/* Floating menu - hide when cross-block selection is active */}
        {isEditMode &&
          !crossBlockSelection &&
          (selectionMenu.visible || pendingReplacement || processingAction) && (
            <FloatingMenu
              selectionMenu={selectionMenu}
              pendingReplacement={pendingReplacement}
              processingAction={processingAction}
              isScrolledAway={isScrolledAway}
              blockType={block.type}
              keepMenuVisibleRef={keepMenuVisibleRef}
              onCustomSelectionChange={setCustomSelection}
              onTypeChange={(type, selectionRange) => {
                // Clear custom selection after action
                setCustomSelection(null);
                const content = block.content;
                const start = selectionRange?.start;
                const end = selectionRange?.end;

                // If no selection range or selection covers entire block, just change type
                if (
                  start === undefined ||
                  end === undefined ||
                  (start === 0 && end >= content.length)
                ) {
                  updateBlock(block.id, { type });
                  return;
                }

                const beforeText = content.slice(0, start);
                const selectedText = content.slice(start, end);
                const afterText = content.slice(end);

                // Build segments array based on selection position
                const segments: Array<{ content: string; type: typeof type }> =
                  [];

                if (beforeText) {
                  segments.push({ content: beforeText, type: block.type });
                }
                segments.push({ content: selectedText, type });
                if (afterText) {
                  segments.push({ content: afterText, type: block.type });
                }

                dispatch({
                  type: "SPLIT_BLOCK_WITH_TYPES",
                  blockId: block.id,
                  segments,
                });
              }}
              onSelectionAction={handleSelectionAction}
              onAcceptReplacement={handleAcceptReplacement}
              onDiscardReplacement={handleDiscardReplacement}
              onTryAgain={handleTryAgain}
              onInsertBelow={handleInsertBelow}
              onScrollToTarget={scrollToTarget}
            />
          )}

        {/* Pending replacement preview (single-block) */}
        {pendingReplacement && (
          <PendingReplacementPreview
            pendingReplacement={pendingReplacement}
            blockType={block.type}
            blockContent={block.content}
            newTextRef={newTextRef}
            scrollTargetRef={scrollTargetRef}
            getBlockStyles={getBlockStyles}
            isConversation={isConversation}
          />
        )}

        {/* Cross-block replacement preview */}
        {!pendingReplacement && crossBlockReplacement && (
          <div
            className={cn(
              "leading-relaxed text-justify whitespace-pre-wrap",
              block.type === "text" && !isConversation && "indent-8",
              getBlockStyles(),
            )}
          >
            {block.content.slice(0, crossBlockReplacement.startOffset)}
            {crossBlockReplacement.action === "fix-spelling" ? (
              // For fix-spelling, use DiffRenderer
              <DiffRenderer
                original={crossBlockReplacement.originalText}
                updated={crossBlockReplacement.newText}
                newTextRef={newTextRef}
              />
            ) : (
              // For other actions, show strikethrough + new text
              <>
                <span className="line-through opacity-50">
                  {crossBlockReplacement.originalText}
                </span>
                <span ref={newTextRef} className="bg-blue-100">
                  {crossBlockReplacement.newText}
                </span>
              </>
            )}
            {block.content.slice(crossBlockReplacement.endOffset)}
          </div>
        )}

        {/* Normal content display */}
        {!pendingReplacement && !crossBlockReplacement && (
          <div
            ref={contentRef}
            data-block-content="true"
            contentEditable={isEditing}
            suppressContentEditableWarning
            onInput={handleInput}
            onBlur={handleBlur}
            onFocus={onFocus}
            onKeyDown={isEditing ? handleKeyDown : undefined}
            onMouseUp={(e) => {
              // Only start editing on click if no text is selected (not a selection drag)
              const selection = window.getSelection();
              const hasSelection = selection && !selection.isCollapsed;
              if (
                isEditMode &&
                !isEditing &&
                !pendingReplacement &&
                !hasSelection
              ) {
                handleStartEditing(e);
              }
            }}
            className={cn(
              "leading-relaxed text-justify whitespace-pre-wrap outline-none",
              block.type === "text" && !isConversation && "indent-8",
              isEditMode && "cursor-text",
              getBlockStyles(),
            )}
          >
            {isEditing
              ? null
              : (() => {
                  if (!block.content) {
                    if (isEditMode) {
                      return (
                        <span className="text-gray-400">
                          {getPlaceholder()}
                        </span>
                      );
                    }
                    return null;
                  }

                  if (!isEditMode && sentences.length > 0) {
                    return (
                      <SentenceRenderer
                        blockContent={block.content}
                        sentences={sentences}
                        currentPlayingIndex={currentPlayingIndex}
                        isPlaybackOn={isPlaybackOn}
                        onSentenceClick={onSentenceClick}
                      />
                    );
                  }

                  // Show custom selection highlight when native selection is lost
                  if (customSelection) {
                    const { start, end } = customSelection;
                    const before = block.content.slice(0, start);
                    const selected = block.content.slice(start, end);
                    const after = block.content.slice(end);
                    return (
                      <>
                        {before}
                        <mark className="bg-blue-200 py-0.5">{selected}</mark>
                        {after}
                      </>
                    );
                  }

                  return block.content;
                })()}
          </div>
        )}
      </div>

      {/* Block actions dropdown */}
      {isEditMode && !pendingReplacement && (
        <div
          className={cn(
            "absolute right-2 top-1 transition-opacity",
            isMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <BlockDropdownMenu
            block={block}
            isMenuOpen={isMenuOpen}
            processingAction={processingAction}
            onMenuOpenChange={setIsMenuOpen}
            onAddBlock={() => addBlock({ type: "text", content: "" }, block.id)}
            onBlockAction={handleBlockAction}
            onTypeChange={(type: BlockType) => updateBlock(block.id, { type })}
            onDelete={() => deleteBlock(block.id)}
          />
        </div>
      )}

      {/* Pending edit dialog */}
      <PendingEditDialog
        open={showPendingDialog}
        onOpenChange={setShowPendingDialog}
        onDiscard={() => {
          handleDiscardReplacement();
          setShowPendingDialog(false);
        }}
        onKeep={() => {
          handleAcceptReplacement();
          setShowPendingDialog(false);
        }}
      />

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
