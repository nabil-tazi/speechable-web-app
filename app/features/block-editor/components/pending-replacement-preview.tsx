import React from "react";
import { cn } from "@/lib/utils";
import { DiffRenderer } from "./diff-renderer";
import type { PendingReplacement } from "../types";
import type { BlockType } from "@/app/features/documents/types";

interface PendingReplacementPreviewProps {
  pendingReplacement: PendingReplacement;
  blockType: BlockType;
  blockContent: string;
  newTextRef: React.RefObject<HTMLSpanElement | null>;
  scrollTargetRef: React.RefObject<HTMLDivElement | null>;
  getBlockStyles: () => string;
  isConversation?: boolean;
}

/**
 * Preview component for pending AI replacements.
 * Shows diff for fix-spelling, strikethrough + new text for other actions.
 */
export function PendingReplacementPreview({
  pendingReplacement,
  blockType,
  blockContent,
  newTextRef,
  scrollTargetRef,
  getBlockStyles,
  isConversation = false,
}: PendingReplacementPreviewProps) {
  // Use fullContent if available (for selections), otherwise fall back to blockContent
  const content = pendingReplacement.fullContent || blockContent;

  // For selections, use indexOf to find correct position (Range API positions can be unreliable)
  const getSlices = () => {
    if (!pendingReplacement.isSelection) return { before: "", after: "" };
    const index = content.indexOf(pendingReplacement.originalText);
    if (index !== -1) {
      return {
        before: content.slice(0, index),
        after: content.slice(index + pendingReplacement.originalText.length),
      };
    }
    // Fallback to stored positions
    return {
      before: content.slice(0, pendingReplacement.selectionStart),
      after: content.slice(pendingReplacement.selectionEnd),
    };
  };

  const renderContent = () => {
    if (pendingReplacement.action === "fix-spelling") {
      // For fix-spelling, show word-by-word diff
      if (pendingReplacement.isSelection) {
        const { before, after } = getSlices();
        return (
          <>
            {before}
            <DiffRenderer
              original={pendingReplacement.originalText}
              updated={pendingReplacement.newText}
              newTextRef={newTextRef}
            />
            {after}
          </>
        );
      }
      return (
        <DiffRenderer
          original={pendingReplacement.originalText}
          updated={pendingReplacement.newText}
          newTextRef={newTextRef}
        />
      );
    }

    if (pendingReplacement.isSelection) {
      const { before, after } = getSlices();
      return (
        <>
          {before}
          <span className="line-through opacity-50">
            {pendingReplacement.originalText}
          </span>
          <span ref={newTextRef} className="bg-blue-100">
            {pendingReplacement.newText}
          </span>
          {after}
        </>
      );
    }

    // Full block replacement (not a selection)
    return (
      <>
        <div className="line-through opacity-50 mb-2">
          {pendingReplacement.originalText}
        </div>
        <span ref={newTextRef} className="bg-blue-100">
          {pendingReplacement.newText}
        </span>
      </>
    );
  };

  return (
    <div
      ref={scrollTargetRef}
      className={cn(
        "leading-relaxed text-justify whitespace-pre-wrap",
        blockType === "text" && !isConversation && "indent-8",
        getBlockStyles()
      )}
    >
      {renderContent()}
    </div>
  );
}
