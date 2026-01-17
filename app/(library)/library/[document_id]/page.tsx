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
import { useAudioState, AudioProvider } from "@/app/features/audio/context";
import {
  updateDocumentLastOpenedAction,
  toggleDocumentStarredAction,
} from "@/app/features/documents/actions";
import { useSidebarData } from "@/app/features/sidebar/context";
import { DocumentVersionLoader } from "@/app/features/documents/components/document-version-loader";
import { CreateVersionDialog } from "@/app/features/documents/components/create-version-dialog";
import { generateWithAi } from "@/app/features/generate-with-ai";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
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
import { Plus, ChevronRight, Star, Pencil, Save, X, List, Focus } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  TTSProvider,
  TTSPlayer,
  EcoBadge,
  parseSegmentsFromProcessedText,
  parseSegmentsFromBlocks,
} from "@/app/features/tts";
import {
  EditorProvider,
  BlockEditor,
  SaveIndicator,
  convertProcessedTextToBlocks,
  useEditor,
  getDisabledBlockIds,
} from "@/app/features/block-editor";
import type { Block } from "@/app/features/documents/types";
import { usePlayback, useGeneration } from "@/app/features/tts";

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
function OutlineButton() {
  const { blocks, toggleBlockDisabled } = useEditor();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

    return { charCountByHeadingId: counts, totalCharCountByHeadingId: totalCounts };
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
    [headings, disabledIds]
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
    const isDisabledViaCascade = disabledIds.has(heading.id) && !heading.disabled;
    // Show char count from effective hovered heading (the one controlling the hover state)
    const charCount = effectiveHoveredId ? (charCountByHeadingId.get(effectiveHoveredId) || 0) : 0;
    const totalCharCount = effectiveHoveredId ? (totalCharCountByHeadingId.get(effectiveHoveredId) || 0) : 0;
    const isEffectiveHoveredDisabled = effectiveHoveredId ? disabledIds.has(effectiveHoveredId) : false;

    return (
      <div
        key={heading.id}
        className={cn(
          "rounded transition-colors",
          isHovered && "bg-accent"
        )}
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
                  depth >= 3 && "pl-16"
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
                        : "opacity-0 group-hover:opacity-100"
                  )}
                />
                <span
                  onClick={() => {
                    // Find the block element and scroll to it with offset for header
                    const blockElement = document.querySelector(`[data-block-id="${heading.id}"]`);
                    const scrollContainer = document.querySelector('[data-scroll-container="true"]');
                    if (blockElement && scrollContainer) {
                      const headerOffset = 80; // Account for fixed header
                      const elementTop = blockElement.getBoundingClientRect().top;
                      const containerTop = scrollContainer.getBoundingClientRect().top;
                      const scrollTop = scrollContainer.scrollTop + elementTop - containerTop - headerOffset;
                      scrollContainer.scrollTo({ top: scrollTop, behavior: "smooth" });
                    }
                  }}
                  className={cn(
                    "text-base truncate flex-1 cursor-pointer",
                    heading.type === "heading1" && "text-lg font-bold",
                    heading.type === "heading2" && "font-semibold",
                    heading.type === "heading3" && "font-normal",
                    heading.type === "heading4" && "text-sm font-normal",
                    disabledIds.has(heading.id) && "line-through text-muted-foreground"
                  )}
                >
                  {heading.content}
                </span>
                <Focus
                  onClick={() => {
                    const blockElement = document.querySelector(`[data-block-id="${heading.id}"]`);
                    const scrollContainer = document.querySelector('[data-scroll-container="true"]');
                    if (blockElement && scrollContainer) {
                      const headerOffset = 80;
                      const elementTop = blockElement.getBoundingClientRect().top;
                      const containerTop = scrollContainer.getBoundingClientRect().top;
                      const scrollTop = scrollContainer.scrollTop + elementTop - containerTop - headerOffset;
                      scrollContainer.scrollTo({ top: scrollTop, behavior: "smooth" });
                    }
                  }}
                  className="h-3.5 w-3.5 flex-shrink-0 opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity cursor-pointer"
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="left">
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
          <div>
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (headings.length === 0) return null;

  return (
    <HoverCard open={isOpen}>
      <HoverCardTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Document outline"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <List className="h-4 w-4" />
        </Button>
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="end"
        className="w-96 p-2"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div
          className="max-h-[70vh] overflow-y-auto"
          onMouseLeave={() => setHoveredId(null)}
        >
          {headingTree.map((node) => renderNode(node, 0))}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

// Editor Action Buttons - must be inside EditorProvider
function EditorActionButtons({
  isEditMode,
  setIsEditMode,
}: {
  isEditMode: boolean;
  setIsEditMode: (value: boolean) => void;
}) {
  const { save, discardChanges, isDirty } = useEditor();

  const handleSave = async () => {
    await save();
    setIsEditMode(false);
  };

  const handleDiscard = () => {
    discardChanges();
    setIsEditMode(false);
  };

  if (isEditMode) {
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
          variant="default"
          size="sm"
          onClick={handleSave}
          className="h-8"
        >
          <Save className="h-4 w-4 mr-1" />
          Save
        </Button>
      </>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsEditMode(true)}
        className="h-8 w-8"
        title="Edit document"
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <OutlineButton />
    </>
  );
}

// Bridge component: Computes segments from EditorProvider's blocks and provides to TTSProvider
// Must be inside EditorProvider, wraps children with TTSProvider
function TTSProviderWithBlocks({ children }: { children: React.ReactNode }) {
  const { blocks } = useEditor();

  const segments = useMemo(() => {
    if (blocks.length === 0) return [];
    return parseSegmentsFromBlocks(blocks);
  }, [blocks]);

  return <TTSProvider segments={segments}>{children}</TTSProvider>;
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
  const [isStarred, setIsStarred] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshRecent, refreshStarred } = useSidebarData();
  const lastOpenedUpdated = useRef(false);

  // Initialize starred state from document
  useEffect(() => {
    if (document?.is_starred !== undefined) {
      setIsStarred(document.is_starred);
    }
  }, [document?.is_starred]);

  // Sort versions by creation date (newest first)
  const sortedVersions = useMemo(() => {
    if (!document?.versions) return [];
    return [...document.versions].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
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

  // Get blocks from active version, or convert from processed_text
  // These are the initial blocks - EditorProvider will manage the live state
  const initialBlocks = useMemo(() => {
    if (!activeVersion) return [];
    // Use blocks if available, otherwise convert from processed_text
    if (activeVersion.blocks && activeVersion.blocks.length > 0) {
      return activeVersion.blocks;
    }
    return convertProcessedTextToBlocks(activeVersion.processed_text);
  }, [activeVersion]);

  // Function to update URL with version parameter
  const updateVersionInUrl = useCallback(
    (versionId: string) => {
      if (!document) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set("version", versionId);
      router.push(`/library/${document.id}?${params.toString()}`);
    },
    [document, searchParams, router]
  );

  // Auto-update URL with version parameter if not present
  useEffect(() => {
    const versionFromUrl = searchParams.get("version");
    const firstVersionId = sortedVersions[0]?.id;

    // If no version in URL but we have versions, add the first version to URL
    if (!versionFromUrl && firstVersionId && sortedVersions.length > 0) {
      updateVersionInUrl(firstVersionId);
    }
  }, [searchParams, sortedVersions, updateVersionInUrl]);

  // Handle version change from header
  const handleVersionChange = useCallback(
    (versionId: string) => {
      updateVersionInUrl(versionId);
    },
    [updateVersionInUrl]
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

  function handleGenerateVersion(
    processingLevel: 0 | 1 | 2 | 3,
    voiceArray: string[],
    _language: string
  ) {
    if (document && document.raw_text)
      generateWithAi({
        documentId: document.id,
        existingDocumentVersions: document.versions,
        rawInputText: document.raw_text,
        voicesArray: voiceArray,
        processingLevel,
      });
    else console.log("empty text");
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
        <TTSProviderWithBlocks>
          {/* Controller to stop playback when entering edit mode */}
          <EditModePlaybackController isEditMode={isEditMode} />

          <div className="bg-sidebar">
            {/* Breadcrumb Header - sticky at top */}
            <div className="sticky top-0 z-20">
              <div className="pl-6 pr-4 h-12 flex items-center justify-between bg-sidebar">
                <div className="flex items-center gap-2">
                  {/* Star Button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleToggleStar}
                    className="h-8 w-8"
                    title={isStarred ? "Remove from starred" : "Add to starred"}
                  >
                    <Star
                      className={`h-4 w-4 ${
                        isStarred ? "fill-yellow-400 text-yellow-400" : ""
                      }`}
                    />
                  </Button>

                  {/* Document Title */}
                  <span
                    className="text-sm font-normal text-foreground truncate max-w-72"
                    title={document.title}
                  >
                    {document.title}
                  </span>

                  {/* Separator */}
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />

                  {/* Version Selector (read mode) or Version Name Input (edit mode) */}
                  {isEditMode ? (
                    <VersionNameInput />
                  ) : (
                    sortedVersions.length > 0 && (
                      <VersionSelector
                        activeVersionId={activeVersionId}
                        versions={sortedVersions}
                        onVersionChange={handleVersionChange}
                        onCreateNew={() => setCreateVersionModalOpen(true)}
                      />
                    )
                  )}

                  {/* Save Indicator */}
                  <SaveIndicator />
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2">
                  {!isEditMode && <EcoBadge />}
                  <EditorActionButtons
                    isEditMode={isEditMode}
                    setIsEditMode={setIsEditMode}
                  />
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

          {/* TTS Player - slides out in edit mode */}
          <div
            className={cn(
              "fixed left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ease-in-out",
              isEditMode
                ? "bottom-0 translate-y-full opacity-0"
                : "bottom-6 translate-y-0 opacity-100"
            )}
          >
            <div className="bg-white border border-gray-200 shadow-lg rounded-2xl px-3 py-3">
              <TTSPlayer />
            </div>
          </div>
        </TTSProviderWithBlocks>
      </EditorProvider>

      <CreateVersionDialog
        document={document}
        handleGenerateVersion={handleGenerateVersion}
        onClose={handleCloseCreateVersionModal}
      />
      <DialogTrigger className="hidden" />
    </Dialog>
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
