import React, { useMemo } from "react";
import {
  AudioLines,
  Minimize2,
  SpellCheck,
  Loader2,
  Check,
  X,
  RefreshCw,
  ChevronDown,
  Type,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { estimateCredits } from "../utils/credits";
import type { ActionType, CrossBlockSelection } from "../types";
import type { CrossBlockPendingReplacement } from "../hooks/use-cross-block-ai-actions";
import type { BlockType } from "@/app/features/documents/types";

const BLOCK_TYPE_CONFIG: Record<BlockType, { label: string; icon: React.ReactNode }> = {
  text: { label: "Text", icon: <Type className="h-4 w-4" /> },
  heading1: { label: "Heading 1", icon: <Heading1 className="h-4 w-4" /> },
  heading2: { label: "Heading 2", icon: <Heading2 className="h-4 w-4" /> },
  heading3: { label: "Heading 3", icon: <Heading3 className="h-4 w-4" /> },
  heading4: { label: "Heading 4", icon: <Heading4 className="h-4 w-4" /> },
};

const MENU_HEIGHT = 50; // Approximate height of the menu
const VIEWPORT_PADDING = 60; // Padding from viewport edges

interface EditorFloatingMenuProps {
  crossBlockSelection: CrossBlockSelection | null;
  pendingReplacement: CrossBlockPendingReplacement | null;
  processingAction: ActionType | null;
  noChangesMessage: string | null;
  onAction: (action: ActionType) => void;
  onAcceptReplacement: () => void;
  onDiscardReplacement: () => void;
  onTryAgain: () => void;
  onTypeChange: (type: BlockType) => void;
}

/**
 * Editor-level floating menu that appears above cross-block text selection.
 * Shows action buttons, loading state, or accept/discard options based on state.
 */
export function EditorFloatingMenu({
  crossBlockSelection,
  pendingReplacement,
  processingAction,
  noChangesMessage,
  onAction,
  onAcceptReplacement,
  onDiscardReplacement,
  onTryAgain,
  onTypeChange,
}: EditorFloatingMenuProps) {
  // Use current selection or fall back to selection stored in pending replacement
  const selection = crossBlockSelection || pendingReplacement?.selection;
  if (!selection) return null;

  const { anchorPosition, selectedText } = selection;

  // Clamp position to keep menu visible in viewport
  const clampedPosition = useMemo(() => {
    const minY = MENU_HEIGHT + VIEWPORT_PADDING;
    const maxY = window.innerHeight - VIEWPORT_PADDING;

    // Clamp Y: ensure menu doesn't go above viewport
    // Since menu uses -translate-y-full, the anchor Y needs to be at least MENU_HEIGHT from top
    const clampedY = Math.max(minY, Math.min(anchorPosition.y, maxY));

    // Clamp X: ensure menu stays within horizontal bounds
    // Menu is centered (-translate-x-1/2), so we need half the menu width as buffer
    const menuHalfWidth = 150; // Approximate half-width of menu
    const clampedX = Math.max(
      menuHalfWidth + VIEWPORT_PADDING,
      Math.min(
        anchorPosition.x,
        window.innerWidth - menuHalfWidth - VIEWPORT_PADDING,
      ),
    );

    return { x: clampedX, y: clampedY };
  }, [anchorPosition.x, anchorPosition.y]);

  return (
    <div
      data-floating-menu="true"
      className="z-50 -translate-x-1/2 -translate-y-full fixed"
      style={{
        left: clampedPosition.x,
        top: clampedPosition.y,
      }}
    >
      {/* No changes notification */}
      {noChangesMessage && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 text-sm text-gray-600 mb-1">
          <Check className="h-4 w-4 text-green-500" />
          {noChangesMessage}
        </div>
      )}

      {!noChangesMessage && (
        <div
          className={cn(
            "bg-white border border-gray-200 rounded-lg shadow-lg p-1 flex items-center gap-1 mb-1",
            (pendingReplacement || processingAction) && "whitespace-nowrap",
          )}
        >
          {processingAction && !pendingReplacement ? (
            // Loading state
            <div className="flex items-center gap-2 px-3 py-1.5 text-gray-600 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                {processingAction === "optimize"
                  ? "Optimizing for speech..."
                  : processingAction === "summarize"
                    ? "Summarizing..."
                    : "Fixing spelling..."}
              </span>
            </div>
          ) : pendingReplacement ? (
            // Accept/Discard state
            <>
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onAcceptReplacement();
                }}
              >
                <Check className="h-4 w-4" />
                Accept
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onDiscardReplacement();
                }}
              >
                <X className="h-4 w-4" />
                Discard
              </Button>
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTryAgain();
                      }}
                      disabled={processingAction !== null}
                    >
                      {processingAction ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      Try again
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {estimateCredits(
                        pendingReplacement?.blockReplacements
                          .map((r) => r.originalText)
                          .join("") || ""
                      )}{" "}
                      credits
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          ) : (
            // Action buttons
            <TooltipProvider delayDuration={300}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-gray-100 rounded text-gray-700 text-sm"
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <span>Turn into</span>
                    <ChevronDown className="h-3 w-3 text-gray-400" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {(Object.entries(BLOCK_TYPE_CONFIG) as [BlockType, { label: string; icon: React.ReactNode }][]).map(
                    ([type, config]) => (
                      <DropdownMenuItem
                        key={type}
                        onClick={() => onTypeChange(type)}
                        className="flex items-center gap-2"
                      >
                        {config.icon}
                        <span>{config.label}</span>
                      </DropdownMenuItem>
                    )
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="w-px h-6 bg-gray-200 mx-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onAction("optimize");
                    }}
                    disabled={processingAction !== null}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 rounded text-gray-700 text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {processingAction === "optimize" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <AudioLines className="h-4 w-4" />
                    )}
                    <span>Optimize for speech</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{estimateCredits(selectedText)} credits</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onAction("summarize");
                    }}
                    disabled={processingAction !== null}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 rounded text-gray-700 text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {processingAction === "summarize" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Minimize2 className="h-4 w-4" />
                    )}
                    <span>Summarize</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{estimateCredits(selectedText)} credits</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onAction("fix-spelling");
                    }}
                    disabled={processingAction !== null}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 rounded text-gray-700 text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {processingAction === "fix-spelling" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <SpellCheck className="h-4 w-4" />
                    )}
                    <span>Fix spelling</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{estimateCredits(selectedText)} credits</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      )}
    </div>
  );
}
