import React, { useRef } from "react";
import {
  AudioLines,
  Minimize2,
  SpellCheck,
  Loader2,
  Check,
  X,
  RefreshCw,
  ListEnd,
  Focus,
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
import type { ActionType, PendingReplacement, SelectionMenu } from "../types";
import type { BlockType } from "@/app/features/documents/types";

const BLOCK_TYPE_CONFIG: Record<BlockType, { label: string; icon: React.ReactNode }> = {
  text: { label: "Text", icon: <Type className="h-4 w-4" /> },
  heading1: { label: "Heading 1", icon: <Heading1 className="h-4 w-4" /> },
  heading2: { label: "Heading 2", icon: <Heading2 className="h-4 w-4" /> },
  heading3: { label: "Heading 3", icon: <Heading3 className="h-4 w-4" /> },
  heading4: { label: "Heading 4", icon: <Heading4 className="h-4 w-4" /> },
};

interface FloatingMenuProps {
  selectionMenu: SelectionMenu;
  pendingReplacement: PendingReplacement | null;
  processingAction: ActionType | null;
  isScrolledAway: boolean;
  blockType: BlockType;
  keepMenuVisibleRef: React.MutableRefObject<boolean>;
  onCustomSelectionChange: (selection: { start: number; end: number } | null) => void;
  onTypeChange: (type: BlockType, selectionRange: { start: number; end: number } | null) => void;
  onSelectionAction: (action: ActionType) => void;
  onAcceptReplacement: () => void;
  onDiscardReplacement: () => void;
  onTryAgain: () => void;
  onInsertBelow: () => void;
  onScrollToTarget: () => void;
}

/**
 * Floating menu that appears above text selection or block.
 * Shows action buttons, loading state, or accept/discard options based on state.
 */
export function FloatingMenu({
  selectionMenu,
  pendingReplacement,
  processingAction,
  isScrolledAway,
  blockType,
  keepMenuVisibleRef,
  onCustomSelectionChange,
  onTypeChange,
  onSelectionAction,
  onAcceptReplacement,
  onDiscardReplacement,
  onTryAgain,
  onInsertBelow,
  onScrollToTarget,
}: FloatingMenuProps) {
  const currentTypeConfig = BLOCK_TYPE_CONFIG[blockType];

  // Ref to store selection before dropdown steals focus
  const selectionOnPointerDownRef = useRef<{ start: number; end: number } | null>(null);
  return (
    <div
      data-floating-menu="true"
      className="z-50 -translate-x-1/2 -translate-y-full fixed"
      style={{
        left: selectionMenu.fixedX,
        top: selectionMenu.fixedY,
      }}
      onPointerDownCapture={() => {
        keepMenuVisibleRef.current = true;
        // Set custom selection to show visual highlight
        const selection =
          selectionMenu.selectionStart !== undefined && selectionMenu.selectionEnd !== undefined
            ? { start: selectionMenu.selectionStart, end: selectionMenu.selectionEnd }
            : null;
        selectionOnPointerDownRef.current = selection;
        onCustomSelectionChange(selection);
      }}
      onPointerUpCapture={() => {
        setTimeout(() => {
          keepMenuVisibleRef.current = false;
        }, 100);
      }}
    >
      <div
        className={cn(
          "bg-white border border-gray-200 rounded-lg shadow-lg p-1 flex items-center gap-1 mb-1",
          (pendingReplacement || processingAction) && "whitespace-nowrap"
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
                    {estimateCredits(pendingReplacement?.originalText || "")}{" "}
                    credits
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {pendingReplacement?.action !== "fix-spelling" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onInsertBelow();
                }}
              >
                <ListEnd className="h-4 w-4" />
                Insert below
              </Button>
            )}
            {isScrolledAway && (
              <>
                <div className="w-px h-6 bg-gray-200 mx-1" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onScrollToTarget();
                  }}
                  title="Scroll to text"
                >
                  <Focus className="h-4 w-4" />
                </Button>
              </>
            )}
          </>
        ) : (
          <TooltipProvider delayDuration={300}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-gray-100 rounded text-gray-700 text-sm"
                >
                  {currentTypeConfig.icon}
                  <span>{currentTypeConfig.label}</span>
                  <ChevronDown className="h-3 w-3 text-gray-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {(Object.entries(BLOCK_TYPE_CONFIG) as [BlockType, { label: string; icon: React.ReactNode }][]).map(
                  ([type, config]) => (
                    <DropdownMenuItem
                      key={type}
                      onPointerUp={() => onTypeChange(type, selectionOnPointerDownRef.current)}
                      className={cn(
                        "flex items-center gap-2",
                        type === blockType && "bg-gray-100"
                      )}
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
                    onSelectionAction("optimize");
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
                <p>{estimateCredits(selectionMenu.text)} credits</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelectionAction("summarize");
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
                <p>{estimateCredits(selectionMenu.text)} credits</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelectionAction("fix-spelling");
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
                <p>{estimateCredits(selectionMenu.text)} credits</p>
              </TooltipContent>
            </Tooltip>
            {isScrolledAway && (
              <>
                <div className="w-px h-6 bg-gray-200 mx-1" />
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onScrollToTarget();
                  }}
                  className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-gray-100 text-gray-500 rounded text-sm"
                  title="Scroll to text"
                >
                  <Focus className="h-4 w-4" />
                </button>
              </>
            )}
          </TooltipProvider>
        )}
      </div>
    </div>
  );
}
