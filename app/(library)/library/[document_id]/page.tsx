"use client";

import React, {
  useMemo,
  use,
  useEffect,
  useCallback,
  useState,
  useRef,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useAudioState,
  AudioProvider,
  useRefreshVersions,
} from "@/app/features/audio/context";
import {
  updateDocumentLastOpenedAction,
  toggleDocumentStarredAction,
  deleteDocumentVersionAction,
  updateDocumentVersionNameAction,
} from "@/app/features/documents/actions";
import { useSidebarData } from "@/app/features/sidebar/context";
import { useProcessingVersions } from "@/app/features/documents/context/processing-context";
import { DocumentVersionLoader } from "@/app/features/documents/components/document-version-loader";
import { CreateVersionDialog } from "@/app/features/documents/components/create-version-dialog";
import { MAX_VERSIONS_PER_DOCUMENT } from "@/app/features/pdf/types";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Bookmark,
  SquarePen,
  Save,
  X,
  List,
  Focus,
  FileText,
  EllipsisVertical,
  Trash2,
  Check,
  Info,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TTSProvider,
  TTSPlayer,
  EcoBadge,
  parseSegmentsFromProcessedText,
  parseSegmentsFromBlocks,
} from "@/app/features/tts";
import { assignDefaultVoices } from "@/app/features/tts/lib/assign-default-voices";
import {
  EditorProvider,
  BlockEditor,
  SaveIndicator,
  convertProcessedTextToBlocks,
  useEditor,
  getDisabledBlockIds,
} from "@/app/features/block-editor";
import type { Block } from "@/app/features/documents/types";
import { usePlayback, useGeneration, DownloadButton } from "@/app/features/tts";
import { HeaderUserMenu } from "@/components/header-user-menu";
import CreditDisplay from "@/app/features/credits/components/credit-display";

// Version Name Input - must be inside EditorProvider
function VersionNameInput() {
  const { versionName, setVersionName } = useEditor();

  return (
    <Input
      type="text"
      value={versionName}
      onChange={(e) => setVersionName(e.target.value)}
      className="h-7 w-[150px] text-sm font-normal px-2"
      placeholder="Version name"
    />
  );
}

// Version Selector - uses context for current version name (in case it was edited)
function VersionSelector({
  activeVersionId,
  versions,
  onVersionChange,
  onCreateNew,
}: {
  activeVersionId: string;
  versions: { id: string; version_name: string }[];
  onVersionChange: (versionId: string) => void;
  onCreateNew: () => void;
}) {
  const { versionName } = useEditor();

  return (
    <Select
      value={activeVersionId}
      onValueChange={(value) => {
        if (value === "__create_new__") {
          onCreateNew();
        } else {
          onVersionChange(value);
        }
      }}
    >
      <SelectTrigger className="h-7 border-0 bg-transparent hover:bg-gray-100 rounded px-2 gap-1 shadow-none ring-0 outline-none focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none text-sm font-normal text-foreground [&_svg]:text-foreground [&_svg]:opacity-100">
        <SelectValue placeholder="Select version" />
      </SelectTrigger>
      <SelectContent>
        {versions.map((version) => (
          <SelectItem
            key={version.id}
            value={version.id}
            className="cursor-pointer"
          >
            {/* Use context versionName for active version (in case it was edited) */}
            {version.id === activeVersionId
              ? versionName
              : version.version_name}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value="__create_new__" className="cursor-pointer">
          <Plus className="h-4 w-4" />
          Create new version
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

// Outline heading node for tree structure
interface HeadingNode {
  heading: Block;
  children: HeadingNode[];
}

// Outline Button - shows document headings on hover, click to toggle disabled
function OutlineButton({
  className,
  popoverSide = "bottom",
  popoverAlign = "start",
}: {
  className?: string;
  popoverSide?: "bottom" | "right" | "left" | "top";
  popoverAlign?: "start" | "center" | "end";
} = {}) {
  const { blocks, toggleBlockDisabled } = useEditor();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Convert character count to audio duration (1h = 55000 characters)
  const formatDuration = useCallback((chars: number) => {
    const totalSeconds = Math.round((chars / 55000) * 3600);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }, []);

  const sortedBlocks = useMemo(() => {
    return [...blocks].sort((a, b) => a.order - b.order);
  }, [blocks]);

  const headings = useMemo(() => {
    return sortedBlocks.filter((block) => block.type.startsWith("heading"));
  }, [sortedBlocks]);

  // Get all disabled block IDs (includes cascaded children)
  const disabledIds = useMemo(() => getDisabledBlockIds(blocks), [blocks]);

  // Calculate character counts for each heading's section
  const { charCountByHeadingId, totalCharCountByHeadingId } = useMemo(() => {
    const counts = new Map<string, number>();
    const totalCounts = new Map<string, number>();

    const getLevel = (type: string) => {
      if (type === "heading1") return 1;
      if (type === "heading2") return 2;
      if (type === "heading3") return 3;
      return 4;
    };

    for (const heading of headings) {
      const headingIndex = sortedBlocks.findIndex((b) => b.id === heading.id);
      const headingLevel = getLevel(heading.type);
      let charCount = 0;
      let totalCharCount = 0;

      // Count characters from all blocks until next same/higher level heading
      for (let i = headingIndex + 1; i < sortedBlocks.length; i++) {
        const block = sortedBlocks[i];
        const blockLevel = getLevel(block.type);

        // Stop at same or higher level heading
        if (block.type.startsWith("heading") && blockLevel <= headingLevel) {
          break;
        }

        // Total count includes all content
        totalCharCount += block.content.length;

        // Active count excludes disabled content
        if (!disabledIds.has(block.id)) {
          charCount += block.content.length;
        }
      }

      counts.set(heading.id, charCount);
      totalCounts.set(heading.id, totalCharCount);
    }

    return {
      charCountByHeadingId: counts,
      totalCharCountByHeadingId: totalCounts,
    };
  }, [headings, sortedBlocks, disabledIds]);

  // Get heading level number from type
  const getLevel = (type: string) => {
    if (type === "heading1") return 1;
    if (type === "heading2") return 2;
    if (type === "heading3") return 3;
    return 4;
  };

  // Build tree structure from flat headings list
  const headingTree = useMemo(() => {
    const tree: HeadingNode[] = [];
    const stack: { node: HeadingNode; level: number }[] = [];

    for (const heading of headings) {
      const level = getLevel(heading.type);
      const node: HeadingNode = { heading, children: [] };

      // Pop stack until we find a parent with lower level
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        tree.push(node);
      } else {
        stack[stack.length - 1].node.children.push(node);
      }

      stack.push({ node, level });
    }

    return tree;
  }, [headings]);

  // Find the root disabled heading that caused this heading to be disabled
  const getDisablingParentId = useCallback(
    (headingId: string): string | null => {
      const headingIndex = headings.findIndex((h) => h.id === headingId);
      if (headingIndex === -1) return null;

      const heading = headings[headingIndex];

      // If this heading is directly disabled, it's its own root
      if (heading.disabled) return headingId;

      // If not in disabled section, no parent
      if (!disabledIds.has(headingId)) return null;

      // Find the parent heading that disabled this one
      const headingLevel = getLevel(heading.type);
      for (let i = headingIndex - 1; i >= 0; i--) {
        const prevHeading = headings[i];
        const prevLevel = getLevel(prevHeading.type);
        if (prevLevel < headingLevel && prevHeading.disabled) {
          return prevHeading.id;
        }
      }
      return null;
    },
    [headings, disabledIds],
  );

  // Get the effective hover ID (may be redirected to parent if in disabled section)
  const effectiveHoveredId = useMemo(() => {
    if (!hoveredId) return null;
    const parentId = getDisablingParentId(hoveredId);
    // If hovering a cascaded-disabled heading, redirect to the parent
    if (parentId && parentId !== hoveredId) {
      return parentId;
    }
    return hoveredId;
  }, [hoveredId, getDisablingParentId]);

  // Render a heading node and its children recursively
  const renderNode = (node: HeadingNode, depth: number = 0) => {
    const { heading, children } = node;
    const isHovered = effectiveHoveredId === heading.id;
    const hasChildren = children.length > 0;
    // Check if this heading is disabled via cascade (not directly)
    const isDisabledViaCascade =
      disabledIds.has(heading.id) && !heading.disabled;
    // Show char count from effective hovered heading (the one controlling the hover state)
    const charCount = effectiveHoveredId
      ? charCountByHeadingId.get(effectiveHoveredId) || 0
      : 0;
    const totalCharCount = effectiveHoveredId
      ? totalCharCountByHeadingId.get(effectiveHoveredId) || 0
      : 0;
    const isEffectiveHoveredDisabled = effectiveHoveredId
      ? disabledIds.has(effectiveHoveredId)
      : false;

    return (
      <div
        key={heading.id}
        className={cn("rounded transition-colors", isHovered && "bg-accent")}
      >
        {/* Heading row - hover detection happens here */}
        <TooltipProvider delayDuration={300}>
          <Tooltip open={isHovered}>
            <TooltipTrigger asChild>
              <div
                onMouseEnter={() => setHoveredId(heading.id)}
                className={cn(
                  "group flex items-center gap-2 py-1.5 px-2",
                  depth === 1 && "pl-6",
                  depth === 2 && "pl-12",
                  depth >= 3 && "pl-16",
                )}
              >
                <Checkbox
                  checked={!heading.disabled}
                  onCheckedChange={() => toggleBlockDisabled(heading.id)}
                  className={cn(
                    "transition-opacity cursor-pointer",
                    // Hide checkbox for cascade-disabled headings
                    isDisabledViaCascade
                      ? "opacity-0 pointer-events-none"
                      : isHovered
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100",
                  )}
                />
                <span
                  onClick={() => {
                    // Find the block element and scroll to it with offset for header
                    const blockElement = document.querySelector(
                      `[data-block-id="${heading.id}"]`,
                    );
                    const scrollContainer = document.querySelector(
                      '[data-scroll-container="true"]',
                    );
                    if (blockElement && scrollContainer) {
                      const headerOffset = 80; // Account for fixed header
                      const elementTop =
                        blockElement.getBoundingClientRect().top;
                      const containerTop =
                        scrollContainer.getBoundingClientRect().top;
                      const scrollTop =
                        scrollContainer.scrollTop +
                        elementTop -
                        containerTop -
                        headerOffset;
                      scrollContainer.scrollTo({
                        top: scrollTop,
                        behavior: "smooth",
                      });
                    }
                  }}
                  className={cn(
                    "text-base truncate flex-1 cursor-pointer",
                    heading.type === "heading1" && "text-lg font-bold",
                    heading.type === "heading2" && "font-semibold",
                    heading.type === "heading3" && "font-normal",
                    heading.type === "heading4" && "text-sm font-normal",
                    disabledIds.has(heading.id) &&
                      "line-through text-muted-foreground",
                  )}
                >
                  {heading.content}
                </span>
                <Focus
                  onClick={() => {
                    const blockElement = document.querySelector(
                      `[data-block-id="${heading.id}"]`,
                    );
                    const scrollContainer = document.querySelector(
                      '[data-scroll-container="true"]',
                    );
                    if (blockElement && scrollContainer) {
                      const headerOffset = 80;
                      const elementTop =
                        blockElement.getBoundingClientRect().top;
                      const containerTop =
                        scrollContainer.getBoundingClientRect().top;
                      const scrollTop =
                        scrollContainer.scrollTop +
                        elementTop -
                        containerTop -
                        headerOffset;
                      scrollContainer.scrollTo({
                        top: scrollTop,
                        behavior: "smooth",
                      });
                    }
                  }}
                  className="h-3.5 w-3.5 flex-shrink-0 opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity cursor-pointer"
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isEffectiveHoveredDisabled ? (
                <p className="line-through text-muted-foreground">
                  {formatDuration(totalCharCount)}
                </p>
              ) : (
                <p>{formatDuration(charCount)}</p>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Children */}
        {hasChildren && (
          <div>{children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  const hasOutline = headings.length > 0;

  if (!hasOutline) {
    return (
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="icon"
                disabled
                className={cn("h-8 w-8", className)}
              >
                <List className="h-4 w-4" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">
            Current version has no outline
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8 hover:bg-gray-200",
                  isOpen && "bg-gray-200 text-gray-900 hover:bg-gray-300",
                  className,
                )}
              >
                <List className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          {!isOpen && <TooltipContent side="right">Outline</TooltipContent>}
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        side={popoverSide}
        align={popoverAlign}
        className="w-96 p-2"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="flex items-center justify-between mb-1 pl-2">
          <span className="text-sm font-medium">Outline</span>
          <button
            onClick={() => setIsOpen(false)}
            className="h-6 w-6 rounded-sm flex items-center justify-center hover:bg-gray-100 transition-colors"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
        <div
          className="max-h-[70vh] overflow-y-auto"
          onMouseLeave={() => setHoveredId(null)}
        >
          {headingTree.map((node) => renderNode(node, 0))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Edit Mode Buttons - Save/Discard, must be inside EditorProvider
function EditModeButtons({
  setIsEditMode,
}: {
  setIsEditMode: (value: boolean) => void;
}) {
  const { save, discardChanges } = useEditor();

  const handleSave = async () => {
    await save();
    setIsEditMode(false);
  };

  const handleDiscard = () => {
    discardChanges();
    setIsEditMode(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleDiscard}
        className="h-8 text-gray-500 hover:text-gray-700"
      >
        <X className="h-4 w-4 mr-1" />
        Discard
      </Button>
      <Button
        size="sm"
        onClick={handleSave}
        className="h-8 bg-brand-primary-dark hover:bg-brand-primary-dark/90"
      >
        <Save className="h-4 w-4 mr-1" />
        Save
      </Button>
    </>
  );
}

// Exit Edit Mode Confirmation Dialog - must be inside EditorProvider
function ExitEditModeDialog({
  open,
  onOpenChange,
  setIsEditMode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setIsEditMode: (value: boolean) => void;
}) {
  const { save, discardChanges } = useEditor();

  const handleSave = async () => {
    await save();
    setIsEditMode(false);
    onOpenChange(false);
  };

  const handleDiscard = () => {
    discardChanges();
    setIsEditMode(false);
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved changes. What would you like to do?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row items-center gap-2 sm:justify-between">
          <AlertDialogCancel className="mt-0">Keep editing</AlertDialogCancel>
          <div className="flex gap-2">
            <AlertDialogAction
              onClick={handleDiscard}
              className="bg-white text-gray-900 border border-gray-200 hover:bg-gray-50"
            >
              <X className="h-4 w-4 mr-1.5" />
              Discard
            </AlertDialogAction>
            <AlertDialogAction onClick={handleSave}>
              <Check className="h-4 w-4 mr-1.5" />
              Save
            </AlertDialogAction>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Edit Button - must be inside EditorProvider to access isDirty
function EditToggleButton({
  isEditMode,
  setIsEditMode,
  onRequestExit,
  className: extraClassName,
}: {
  isEditMode: boolean;
  setIsEditMode: (value: boolean) => void;
  onRequestExit: () => void;
  className?: string;
}) {
  const { isDirty } = useEditor();

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (isEditMode) {
                if (isDirty) {
                  onRequestExit();
                } else {
                  setIsEditMode(false);
                }
              } else {
                setIsEditMode(true);
              }
            }}
            className={cn(
              "h-8 w-8 hover:bg-gray-200",
              isEditMode && "bg-gray-200 text-gray-900 hover:bg-gray-300",
              extraClassName,
            )}
          >
            <SquarePen className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {isEditMode ? "Exit edit mode" : "Edit"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Animated scrolling text for long titles (infinite ticker)
function ScrollingText({
  text,
  className,
  onHoverOnly = false,
  isActive = false,
}: {
  text: string;
  className?: string;
  onHoverOnly?: boolean;
  isActive?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [textWidth, setTextWidth] = useState(0);

  useEffect(() => {
    const checkOverflow = () => {
      if (containerRef.current && textRef.current) {
        const container = containerRef.current.offsetWidth;
        const textW = textRef.current.scrollWidth;
        setTextWidth(textW);
        setIsOverflowing(textW > container);
      }
    };

    checkOverflow();
    window.addEventListener("resize", checkOverflow);
    return () => window.removeEventListener("resize", checkOverflow);
  }, [text]);

  // Calculate animation duration based on text length
  const gap = 48; // gap between repeated text
  const animationDuration = Math.max(5, (textWidth + gap) / 50);

  // Determine animation class: active forces animation, onHoverOnly uses hover trigger
  const shouldAnimate = isOverflowing && (isActive || !onHoverOnly);
  const useHoverAnimation = isOverflowing && onHoverOnly && !isActive;

  return (
    <div
      ref={containerRef}
      className={cn(
        "overflow-hidden",
        useHoverAnimation && "marquee-hover-container",
        className,
      )}
      title={text}
    >
      <div
        className={cn(
          "inline-flex whitespace-nowrap",
          shouldAnimate && "marquee-ticker",
          useHoverAnimation && "marquee-ticker-hover",
        )}
        style={
          isOverflowing
            ? ({
                "--marquee-duration": `${animationDuration}s`,
                "--marquee-distance": `-${textWidth + gap}px`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <span ref={textRef}>{text}</span>
        {isOverflowing && <span className="ml-12">{text}</span>}
      </div>
    </div>
  );
}

// Helper to format duration from character count
function formatDurationFromChars(chars: number): string {
  // 1h = 55000 characters
  const totalSeconds = Math.round((chars / 55000) * 3600);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes} min`;
  } else {
    return "< 1 min";
  }
}

// Version tabs with horizontal scroll and arrows
function VersionTabsWithScroll({
  versions,
  activeVersionId,
  onVersionChange,
  onCreateNew,
}: {
  versions: {
    id: string;
    version_name: string;
    blocks?: { content: string; disabled?: boolean }[];
  }[];
  activeVersionId: string;
  onVersionChange: (versionId: string) => void;
  onCreateNew: () => void;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const checkScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;
    const hasOverflow = scrollWidth > clientWidth;

    setIsOverflowing(hasOverflow);
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
  }, []);

  useEffect(() => {
    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
  }, [checkScroll, versions]);

  const scroll = (direction: "left" | "right") => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const scrollAmount = 150;
    container.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  return (
    <div className="-mx-4 -mb-4 mt-4.5 pb-1 pt-0.75 px-1 pr-2 bg-gray-100 rounded-b-sm border-t">
      <div className="flex items-center gap-2">
        {/* Scrollable tabs container with overlay arrows */}
        <div className="relative flex-1 min-w-0">
          {/* Left scroll arrow - overlay */}
          {canScrollLeft && (
            <button
              onClick={() => scroll("left")}
              className="absolute left-0 top-0 bottom-0 z-10 w-10 flex items-center justify-start pl-1 bg-gradient-to-r from-muted via-muted/80 to-transparent"
            >
              <ChevronLeft className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors" />
            </button>
          )}

          {/* Scrollable container */}
          <div
            ref={scrollContainerRef}
            onScroll={checkScroll}
            className="overflow-x-auto"
          >
            <Tabs value={activeVersionId} onValueChange={onVersionChange}>
              <TabsList className="h-auto p-1 inline-flex w-max">
                {versions.map((version) => {
                  const charCount =
                    version.blocks?.reduce(
                      (acc, block) =>
                        acc + (block.disabled ? 0 : block.content.length),
                      0,
                    ) || 0;
                  const duration = formatDurationFromChars(charCount);

                  return (
                    <TabsTrigger
                      key={version.id}
                      value={version.id}
                      className="flex-col items-start gap-0 h-auto py-1.5 px-3 flex-shrink-0"
                    >
                      <span className="text-sm font-medium">
                        {version.version_name}
                      </span>
                      <span className="text-xs opacity-70 leading-tight">
                        {duration}
                      </span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          </div>

          {/* Right scroll arrow - overlay */}
          {canScrollRight && (
            <button
              onClick={() => scroll("right")}
              className="absolute right-0 top-0 bottom-0 z-10 w-10 flex items-center justify-end pr-1 bg-gradient-to-l from-muted via-muted/80 to-transparent"
            >
              <ChevronRight className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors" />
            </button>
          )}
        </div>

        {/* New version button - minimal when overflowing */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onCreateNew}
                className={cn(
                  "flex-shrink-0 bg-brand-primary-dark text-white flex items-center justify-center hover:opacity-90 transition-all",
                  isOverflowing
                    ? "h-8 w-8 rounded-full"
                    : "h-8 px-3 rounded-full gap-1.5 text-sm font-medium",
                )}
              >
                <Plus className="h-4 w-4" />
                {!isOverflowing && <span>New version</span>}
              </button>
            </TooltipTrigger>
            {isOverflowing && (
              <TooltipContent>
                <p>New version</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

// Version Selector Popover - shows version name with dropdown for version switching
function VersionSelectorPopover({
  document,
  versions,
  activeVersionId,
  activeVersionName,
  onVersionChange,
  onCreateNew,
  trigger,
  hideVersionTabs,
}: {
  document: {
    title: string;
    author?: string;
    thumbnail_path?: string;
    page_count?: number;
    file_type: string;
  };
  versions: {
    id: string;
    version_name: string;
    blocks?: { content: string; disabled?: boolean }[];
  }[];
  activeVersionId: string;
  activeVersionName: string;
  onVersionChange: (versionId: string) => void;
  onCreateNew: () => void;
  trigger?: React.ReactNode;
  hideVersionTabs?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [thumbnailError, setThumbnailError] = useState(false);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Preload thumbnail on mount
  useEffect(() => {
    if (document.thumbnail_path) {
      const img = new Image();
      img.src = document.thumbnail_path;
    }
  }, [document.thumbnail_path]);

  const handleMouseEnter = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setIsOpen(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 150);
  }, []);

  const fileTypeLabel = document.file_type?.toUpperCase() || "PDF";
  const showThumbnail = document.thumbnail_path && !thumbnailError;

  return (
    <HoverCard open={isOpen}>
      <HoverCardTrigger asChild>
        {trigger ? (
          <button
            className="flex items-center justify-center rounded-full p-1.5 hover:bg-gray-200 transition-colors"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {trigger}
          </button>
        ) : (
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-gray-200 transition-colors"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <span className="text-sm text-gray-700">{activeVersionName}</span>
            <ChevronDown className="h-4 w-4 text-gray-700" />
          </button>
        )}
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="center"
        className="w-[480px] max-w-[calc(100vw-2rem)] p-4"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="flex flex-col">
          {/* Top section: Document info + Thumbnail */}
          <div className="flex gap-4">
            {/* Left side: Title, Author, Metadata */}
            <div className="flex-1 min-w-0">
              <h3
                className="text-lg font-bold line-clamp-3 leading-tight"
                title={document.title}
              >
                {document.title}
              </h3>
              <p
                className="text-sm text-muted-foreground truncate mt-1"
                title={document.author || "Unknown author"}
              >
                {document.author || "Unknown author"}
              </p>
              {/* Metadata: page count and file type */}
              <p className="text-xs text-muted-foreground mt-1">
                {document.page_count &&
                  `${document.page_count} page${
                    document.page_count !== 1 ? "s" : ""
                  } · `}
                {fileTypeLabel}
              </p>
            </div>

            {/* Right side: Thumbnail */}
            <div className="relative flex-shrink-0">
              {showThumbnail ? (
                <div className="w-28 h-36 rounded-md shadow-[0px_2px_4px_0px_rgba(0,0,0,0.12)] bg-muted overflow-hidden">
                  <img
                    src={document.thumbnail_path}
                    alt="Document thumbnail"
                    className="w-full h-full object-cover object-top"
                    onError={() => setThumbnailError(true)}
                  />
                </div>
              ) : (
                <div className="w-28 h-36 rounded-md bg-muted flex items-center justify-center">
                  <FileText className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
            </div>
          </div>

          {/* Bottom section: Versions */}
          {!hideVersionTabs && (
            <VersionTabsWithScroll
              versions={versions}
              activeVersionId={activeVersionId}
              onVersionChange={onVersionChange}
              onCreateNew={onCreateNew}
            />
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

// Error boundary to catch render errors in child components
class RenderErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      "[RenderErrorBoundary] Caught error:",
      error,
      info.componentStack,
    );
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8">
          <h2 className="text-lg font-semibold text-gray-900">
            Something went wrong
          </h2>
          <p className="text-sm text-red-600 font-mono max-w-lg text-center">
            {this.state.error.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="text-blue-600 hover:text-blue-800"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Bridge component: Computes segments from EditorProvider's blocks and provides to TTSProvider
// Must be inside EditorProvider, wraps children with TTSProvider
function TTSProviderWithBlocks({
  children,
  languageCode = "en",
}: {
  children: React.ReactNode;
  languageCode?: string;
}) {
  const { blocks } = useEditor();

  const segments = useMemo(() => {
    if (blocks.length === 0) return [];
    return parseSegmentsFromBlocks(blocks);
  }, [blocks]);

  // Extract unique reader IDs and assign default voices
  const initialVoiceMap = useMemo(() => {
    const readerIds = [...new Set(segments.map((s) => s.reader_id))];
    return assignDefaultVoices(readerIds, languageCode);
  }, [segments, languageCode]);

  return (
    <TTSProvider
      segments={segments}
      languageCode={languageCode}
      initialVoiceMap={initialVoiceMap}
    >
      {children}
    </TTSProvider>
  );
}

// Effect component to stop playback when entering edit mode
// Must be inside both EditorProvider and TTSProvider
function EditModePlaybackController({ isEditMode }: { isEditMode: boolean }) {
  const { stop } = usePlayback();
  const { clearQueue } = useGeneration();

  useEffect(() => {
    if (isEditMode) {
      // Stop playback and clear generation queue when entering edit mode
      stop();
      clearQueue();
    }
  }, [isEditMode, stop, clearQueue]);

  return null;
}

// Document Text View Component
function DocumentTextView() {
  const { loading, error, document } = useAudioState();
  const [isCreateVersionModalOpen, setCreateVersionModalOpen] = useState(false);
  const [createVersionKey, setCreateVersionKey] = useState(0);
  const [isStarred, setIsStarred] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [showBackConfirmation, setShowBackConfirmation] = useState(false);
  const [deleteVersionConfirmOpen, setDeleteVersionConfirmOpen] =
    useState(false);
  const [renameVersionOpen, setRenameVersionOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshRecent, refreshStarred } = useSidebarData();
  const { processingVersions } = useProcessingVersions();
  const refreshVersions = useRefreshVersions();
  const lastOpenedUpdated = useRef(false);

  // Initialize starred state from document
  useEffect(() => {
    if (document?.is_starred !== undefined) {
      setIsStarred(document.is_starred);
    }
  }, [document?.is_starred]);

  // Refresh document data when a processing version for this document completes
  const completedVersionIds = useRef(new Set<string>());
  useEffect(() => {
    if (!document) return;
    const completed = processingVersions.filter(
      (v) => v.documentId === document.id && v.status === "completed",
    );
    const newlyCompleted = completed.filter(
      (v) => !completedVersionIds.current.has(v.versionId),
    );
    if (newlyCompleted.length > 0) {
      newlyCompleted.forEach((v) =>
        completedVersionIds.current.add(v.versionId),
      );
      refreshVersions();
    }
  }, [processingVersions, document, refreshVersions]);

  // Sort versions by creation date (newest first)
  const sortedVersions = useMemo(() => {
    if (!document?.versions) return [];
    return [...document.versions]
      .filter((v) => v.status === "completed")
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
  }, [document?.versions]);

  // Get the active version ID from URL or default to first version
  const activeVersionId = useMemo(() => {
    const versionFromUrl = searchParams.get("version");
    if (versionFromUrl && sortedVersions.find((v) => v.id === versionFromUrl)) {
      return versionFromUrl;
    }
    return sortedVersions[0]?.id || "";
  }, [searchParams, sortedVersions]);

  // Get the active version from sorted versions
  const activeVersion = sortedVersions.find((v) => v.id === activeVersionId);
  const hasReachedVersionLimit = sortedVersions.length >= MAX_VERSIONS_PER_DOCUMENT;

  // Get blocks from active version, or convert from processed_text
  // These are the initial blocks - EditorProvider will manage the live state
  const initialBlocks = useMemo(() => {
    if (!activeVersion) return [];
    return activeVersion.blocks || [];
  }, [activeVersion]);

  // Function to update URL with version parameter
  // useReplace: true for automatic redirects (doesn't create history entry), false for user actions
  const updateVersionInUrl = useCallback(
    (versionId: string, useReplace: boolean = false) => {
      if (!document) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set("version", versionId);
      const url = `/library/${document.id}?${params.toString()}`;
      if (useReplace) {
        router.replace(url);
      } else {
        router.push(url);
      }
    },
    [document, searchParams, router],
  );

  // Auto-update URL with version parameter if not present
  // Uses replace to avoid creating extra history entries
  const hasRedirected = useRef(false);
  useEffect(() => {
    const versionFromUrl = searchParams.get("version");
    const firstVersionId = sortedVersions[0]?.id;

    // If no version in URL but we have versions, add the first version to URL
    if (
      !versionFromUrl &&
      firstVersionId &&
      sortedVersions.length > 0 &&
      !hasRedirected.current
    ) {
      hasRedirected.current = true;
      updateVersionInUrl(firstVersionId, true); // Use replace for automatic redirect
    }
  }, [searchParams, sortedVersions, updateVersionInUrl]);

  // Handle version change from header
  const handleVersionChange = useCallback(
    (versionId: string) => {
      updateVersionInUrl(versionId);
    },
    [updateVersionInUrl],
  );

  // Handle version deletion
  const handleDeleteVersion = useCallback(
    async (versionId: string) => {
      const { error } = await deleteDocumentVersionAction(versionId);
      if (error) {
        console.error("Failed to delete version:", error);
        return;
      }
      setIsEditMode(false);
      await refreshVersions();
      // Navigate to the first remaining version that isn't the deleted one
      const remaining = sortedVersions.filter((v) => v.id !== versionId);
      if (remaining.length > 0) {
        updateVersionInUrl(remaining[0].id, true);
      }
    },
    [refreshVersions, sortedVersions, updateVersionInUrl],
  );

  // Handle version rename
  const handleRenameVersion = useCallback(
    async (newName: string) => {
      if (!newName.trim()) return;
      const { error } = await updateDocumentVersionNameAction(
        activeVersionId,
        newName.trim(),
      );
      if (error) {
        console.error("Failed to rename version:", error);
        return;
      }
      await refreshVersions();
      setRenameVersionOpen(false);
    },
    [activeVersionId, refreshVersions],
  );

  // Update last_opened timestamp when document is loaded
  useEffect(() => {
    if (document?.id && !lastOpenedUpdated.current) {
      lastOpenedUpdated.current = true;
      updateDocumentLastOpenedAction(document.id).then(() => {
        refreshRecent();
      });
    }
  }, [document?.id, refreshRecent]);

  // Early returns after all hooks are called
  if (loading) {
    return <DocumentVersionLoader />;
  }

  if (error || !document) {
    return (
      <div className="w-full flex justify-center p-4">
        <div className="max-w-7xl w-full">
          <div className="text-center py-12">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Document not found
            </h2>
            <p className="text-gray-500 mb-4">
              The document you're looking for doesn't exist or has been removed.
            </p>
            <button
              onClick={() => router.push("/library")}
              className="text-blue-600 hover:text-blue-800"
            >
              Back to Library
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!activeVersion) {
    return (
      <div className="w-full flex justify-center p-4">
        <div className="max-w-7xl w-full">
          <div className="text-center py-12">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              No versions available
            </h2>
            <p className="text-gray-500 mb-4">
              This document doesn't have any versions yet.
            </p>
            <button
              onClick={() => router.push(`/library/${document.id}`)}
              className="text-blue-600 hover:text-blue-800"
            >
              Back to Document
            </button>
          </div>
        </div>
      </div>
    );
  }

  function handleCloseCreateVersionModal() {
    setCreateVersionModalOpen(false);
  }

  async function handleToggleStar() {
    if (!document) return;
    const previousState = isStarred;
    setIsStarred(!isStarred); // Optimistic update
    const { data, error } = await toggleDocumentStarredAction(document.id);
    if (error) {
      setIsStarred(previousState); // Revert on error
    } else if (data) {
      setIsStarred(data.is_starred); // Sync with server response
      refreshStarred(); // Update sidebar
    }
  }

  return (
    <RenderErrorBoundary>
      <Dialog
        open={isCreateVersionModalOpen}
        onOpenChange={setCreateVersionModalOpen}
      >
        <EditorProvider
          documentVersionId={activeVersionId}
          initialBlocks={initialBlocks}
          initialVersionName={activeVersion?.version_name || ""}
          autoSave={!isEditMode}
        >
          <TTSProviderWithBlocks languageCode={activeVersion?.language || document.language || "en"}>
            {/* Controller to stop playback when entering edit mode */}
            <EditModePlaybackController isEditMode={isEditMode} />

            <div className="bg-sidebar">
              {/* Breadcrumb Header - sticky at top */}
              <div className="sticky top-0 z-20">
                <div className="pl-2 pr-4 h-12 flex items-center bg-sidebar">
                  {/* Left section */}
                  <div className="flex items-center gap-1 flex-1">
                    {/* Back to Library Button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (isEditMode) {
                          setShowBackConfirmation(true);
                        } else {
                          router.push("/library");
                        }
                      }}
                      className="h-8 w-8 hover:bg-gray-200"
                      title="Back to library"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>

                    {/* Vertical Separator */}
                    <Separator orientation="vertical" className="h-5 mx-1" />

                    {/* Document Title */}
                    <span
                      className="text-sm font-medium truncate max-w-[300px]"
                      title={document.title}
                    >
                      {document.title}
                    </span>
                    {/* Info icon - triggers document info popover */}
                    <VersionSelectorPopover
                      document={document}
                      versions={sortedVersions}
                      activeVersionId={activeVersionId}
                      activeVersionName={activeVersion?.version_name || ""}
                      onVersionChange={handleVersionChange}
                      onCreateNew={() => {
                        setCreateVersionKey((k) => k + 1);
                        setCreateVersionModalOpen(true);
                      }}
                      hideVersionTabs
                      trigger={
                        <Info className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground transition-colors" />
                      }
                    />

                    {/* Save Indicator */}
                    <SaveIndicator />
                  </div>

                  {/* Center section - Edit Button + Version Selector */}
                  <div className="flex-shrink-0 flex items-center gap-1">
                    {isEditMode ? (
                      /* Edit mode: Show version name */
                      <span className="text-sm text-gray-700">
                        {activeVersion?.version_name}
                      </span>
                    ) : (
                      /* Read mode: Version dropdown */
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-gray-200 transition-colors">
                            <span className="text-sm text-gray-700 truncate max-w-[150px]">
                              {activeVersion?.version_name || ""}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatDurationFromChars(
                                activeVersion?.blocks?.reduce(
                                  (acc, block) =>
                                    acc +
                                    (block.disabled ? 0 : block.content.length),
                                  0,
                                ) || 0,
                              )}
                            </span>
                            <ChevronDown className="h-4 w-4 text-gray-700" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="center"
                          className="max-h-72 overflow-y-auto"
                        >
                          {sortedVersions.map((version) => {
                            const charCount =
                              version.blocks?.reduce(
                                (acc, block) =>
                                  acc +
                                  (block.disabled ? 0 : block.content.length),
                                0,
                              ) || 0;
                            const duration = formatDurationFromChars(charCount);
                            return (
                              <DropdownMenuItem
                                key={version.id}
                                onClick={() => handleVersionChange(version.id)}
                                className={cn(
                                  "flex items-center justify-between gap-4",
                                  version.id === activeVersionId && "bg-accent",
                                )}
                              >
                                <span className="text-sm truncate max-w-[150px]">
                                  {version.version_name}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {duration}
                                </span>
                              </DropdownMenuItem>
                            );
                          })}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => {
                              setCreateVersionKey((k) => k + 1);
                              setCreateVersionModalOpen(true);
                            }}
                            disabled={hasReachedVersionLimit}
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            {hasReachedVersionLimit
                              ? "Version limit reached"
                              : "New version"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>

                  {/* Right section */}
                  <div className="flex items-center gap-3 flex-1 justify-end">
                    {/* Edit mode: Save/Discard buttons */}
                    {isEditMode && (
                      <EditModeButtons setIsEditMode={setIsEditMode} />
                    )}

                    {/* Read mode: EcoBadge */}
                    {!isEditMode && <EcoBadge />}

                    {/* Credits display */}
                    <CreditDisplay />

                    {/* User menu */}
                    <HeaderUserMenu />
                  </div>
                </div>
                {/* Gradient fade */}
                <div className="h-4 bg-gradient-to-b from-sidebar to-transparent" />
              </div>

              {/* Block Editor */}
              <BlockEditor
                isEditMode={isEditMode}
                isConversation={activeVersion?.processing_type === "3"}
              />
            </div>

            {/* Fixed left side menu - vertically centered */}
            <div className="fixed left-4 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-3">
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      onClick={() => {
                        setCreateVersionKey((k) => k + 1);
                        setCreateVersionModalOpen(true);
                      }}
                      disabled={hasReachedVersionLimit}
                      className="h-9 w-9 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-md transition-transform hover:scale-110 disabled:opacity-50 disabled:hover:scale-100"
                    >
                      <Plus className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {hasReachedVersionLimit
                      ? `Version limit reached (${MAX_VERSIONS_PER_DOCUMENT} max)`
                      : "New version"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div className="flex flex-col bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
                <OutlineButton
                  className="rounded-none border-0 shadow-none h-9 w-9 hover:bg-gray-100"
                  popoverSide="right"
                  popoverAlign="center"
                />
                <Separator />
                <EditToggleButton
                  isEditMode={isEditMode}
                  setIsEditMode={setIsEditMode}
                  onRequestExit={() => setShowBackConfirmation(true)}
                  className="rounded-none h-9 w-9 hover:bg-gray-100"
                />
                <Separator />
                <div className="flex items-center justify-center h-9 w-9">
                  <DownloadButton />
                </div>
                <Separator />
                <DropdownMenu>
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="rounded-none h-9 w-9 hover:bg-gray-100"
                          >
                            <EllipsisVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="right">More</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <DropdownMenuContent
                    align="start"
                    side="right"
                    className="max-w-[300px]"
                  >
                    <DropdownMenuItem
                      onClick={() => {
                        setRenameValue(activeVersion?.version_name || "");
                        setRenameVersionOpen(true);
                      }}
                    >
                      <SquarePen className="h-4 w-4 mr-2" />
                      Rename
                    </DropdownMenuItem>
                    {sortedVersions.length >= 2 && (
                      <DropdownMenuItem
                        onClick={() => setDeleteVersionConfirmOpen(true)}
                        className="text-red-600 focus:text-red-600"
                      >
                        <Trash2 className="h-4 w-4 mr-2 flex-shrink-0" />
                        <span className="truncate">
                          Delete {activeVersion?.version_name}
                        </span>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* TTS Player - slides out in edit mode */}
            <div
              className={cn(
                "fixed left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ease-in-out",
                isEditMode
                  ? "bottom-0 translate-y-full opacity-0"
                  : "bottom-6 translate-y-0 opacity-100",
              )}
            >
              <div className="bg-white border border-gray-200 shadow-lg rounded-2xl px-3 py-3">
                <TTSPlayer />
              </div>
            </div>
          </TTSProviderWithBlocks>

          {/* Exit edit mode confirmation dialog - must be inside EditorProvider */}
          <ExitEditModeDialog
            open={showBackConfirmation}
            onOpenChange={setShowBackConfirmation}
            setIsEditMode={setIsEditMode}
          />
        </EditorProvider>

        <AlertDialog
          open={renameVersionOpen}
          onOpenChange={setRenameVersionOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Rename version</AlertDialogTitle>
              <AlertDialogDescription>
                Enter a new name for this version.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameVersion(renameValue);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleRenameVersion(renameValue)}
                disabled={!renameValue.trim()}
              >
                Save
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={deleteVersionConfirmOpen}
          onOpenChange={setDeleteVersionConfirmOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete version</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this version?
                <br />
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleDeleteVersion(activeVersionId)}
                className="bg-red-600 hover:bg-red-700"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <CreateVersionDialog
          key={createVersionKey}
          document={document}
          existingVersions={document.versions}
          onClose={handleCloseCreateVersionModal}
        />
        <DialogTrigger className="hidden" />
      </Dialog>
    </RenderErrorBoundary>
  );
}

// Main Document Text Page Component
export default function DocumentTextPage({
  params,
}: {
  params: Promise<{ document_id: string }>;
}) {
  // Unwrap the params Promise
  const resolvedParams = use(params);

  return (
    <AudioProvider documentId={resolvedParams.document_id}>
      <DocumentTextView />
    </AudioProvider>
  );
}
