"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CONVERSATION_READERS } from "../constants";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ReaderSelectorProps {
  readerId: string;
  onChange?: (readerId: string) => void;
  visible: boolean; // Controlled by parent (hover or selected state)
  readOnly?: boolean; // If true, just show the badge without popover
}

export function ReaderSelector({ readerId, onChange, visible, readOnly = false }: ReaderSelectorProps) {
  const [open, setOpen] = useState(false);

  const currentReader =
    CONVERSATION_READERS.find((r) => r.id === readerId) || CONVERSATION_READERS[0];

  const handleSelect = (newReaderId: string) => {
    onChange?.(newReaderId);
    setOpen(false);
  };

  // Read-only mode: just show the badge with hover effect and tooltip
  if (readOnly) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "px-1.5 py-0.5 rounded text-xs font-medium transition-all cursor-default",
              "bg-gray-200 text-gray-700 hover:bg-gray-300",
              visible ? "opacity-100" : "opacity-0"
            )}
          >
            {currentReader.shortLabel}
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={4}>
          {currentReader.label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "px-1.5 py-0.5 rounded text-xs font-medium transition-opacity",
            "bg-gray-100 text-gray-600 hover:bg-gray-200",
            visible || open ? "opacity-100" : "opacity-0"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {currentReader.shortLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-28 p-1"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        {CONVERSATION_READERS.map((reader) => (
          <button
            key={reader.id}
            onClick={() => handleSelect(reader.id)}
            className={cn(
              "w-full px-2 py-1.5 text-left text-sm rounded transition-colors",
              reader.id === readerId
                ? "bg-gray-100 text-gray-900 font-medium"
                : "text-gray-600 hover:bg-gray-50"
            )}
          >
            {reader.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
