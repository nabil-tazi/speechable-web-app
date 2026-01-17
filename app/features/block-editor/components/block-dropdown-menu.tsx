import React from "react";
import {
  MoreVertical,
  Trash2,
  AudioLines,
  Minimize2,
  SpellCheck,
  Type,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Plus,
  Loader2,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Block, BlockType } from "@/app/features/documents/types";
import { estimateCredits } from "../utils/credits";
import type { ActionType } from "../types";

interface BlockDropdownMenuProps {
  block: Block;
  isMenuOpen: boolean;
  processingAction: ActionType | null;
  onMenuOpenChange: (open: boolean) => void;
  onAddBlock: () => void;
  onBlockAction: (action: ActionType) => void;
  onTypeChange: (type: BlockType) => void;
  onDelete: () => void;
}

/**
 * Dropdown menu for block actions (AI actions, type conversion, delete).
 */
export function BlockDropdownMenu({
  block,
  isMenuOpen,
  processingAction,
  onMenuOpenChange,
  onAddBlock,
  onBlockAction,
  onTypeChange,
  onDelete,
}: BlockDropdownMenuProps) {
  return (
    <DropdownMenu open={isMenuOpen} onOpenChange={onMenuOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onAddBlock}>
          <Plus className="h-4 w-4 mr-2" />
          Add block below
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuItem
                onClick={() => onBlockAction("optimize")}
                disabled={processingAction !== null || !block.content.trim()}
              >
                {processingAction === "optimize" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <AudioLines className="h-4 w-4 mr-2" />
                )}
                Optimize for speech
              </DropdownMenuItem>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>{estimateCredits(block.content)} credits</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuItem
                onClick={() => onBlockAction("summarize")}
                disabled={processingAction !== null || !block.content.trim()}
              >
                {processingAction === "summarize" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Minimize2 className="h-4 w-4 mr-2" />
                )}
                Summarize
              </DropdownMenuItem>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>{estimateCredits(block.content)} credits</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuItem
                onClick={() => onBlockAction("fix-spelling")}
                disabled={processingAction !== null || !block.content.trim()}
              >
                {processingAction === "fix-spelling" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <SpellCheck className="h-4 w-4 mr-2" />
                )}
                Fix spelling
              </DropdownMenuItem>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>{estimateCredits(block.content)} credits</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Type className="h-4 w-4 mr-2" />
            Convert to
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem
              onClick={() => onTypeChange("text")}
              disabled={block.type === "text"}
            >
              <Type className="h-4 w-4 mr-2" />
              Text
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onTypeChange("heading1")}
              disabled={block.type === "heading1"}
            >
              <Heading1 className="h-4 w-4 mr-2" />
              Heading 1
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onTypeChange("heading2")}
              disabled={block.type === "heading2"}
            >
              <Heading2 className="h-4 w-4 mr-2" />
              Heading 2
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onTypeChange("heading3")}
              disabled={block.type === "heading3"}
            >
              <Heading3 className="h-4 w-4 mr-2" />
              Heading 3
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onTypeChange("heading4")}
              disabled={block.type === "heading4"}
            >
              <Heading4 className="h-4 w-4 mr-2" />
              Heading 4
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onDelete}
          className="text-red-600 focus:text-red-600"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
