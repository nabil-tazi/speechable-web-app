import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import type {
  AudioSegment,
  AudioVersionWithSegments,
  WordTimestamp,
} from "../../audio/types";
import type { Document, DocumentVersion } from "../types";
import type { AudioPlayerHook } from "../../audio/hooks/use-audio-player";
import {
  Clock,
  Download,
  ChevronLeft,
  ChevronRight,
  List,
  Plus,
  UsersRound,
  Mic2,
  UndoDot,
  RedoDot,
} from "lucide-react";
import { formatDuration } from "../../audio/utils";
import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import { WordHighlightDisplay } from "../../audio/components/word-highlight";
import { SectionSelector } from "./section-selector";
import { SpeedSelector } from "./speed-selector";
import { AudioPlayerControls } from "../../audio/components/audio-player-controls";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface GroupedWord {
  text: string;
  start: number;
  end: number;
  segmentId: string;
  segmentTitle: string;
  isTitle?: boolean;
  titleWordIndex?: number;
}

interface UnifiedWordTimestamp extends WordTimestamp {
  segmentId: string;
  segmentTitle: string;
}

const SkipForwardIcon = ({ className = "w-2 h-2" }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <path d="M16 12.667L5.777 19.482A.5.5 0 0 1 5 19.066V4.934a.5.5 0 0 1 .777-.416L16 11.333V5a1 1 0 1 1 2 0v14a1 1 0 1 1-2 0v-6.333Z" />
  </svg>
);

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const PauseIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);

interface DocumentVersionProps {
  id: string;
  version_name: string;
  created_at: string;
}

export function DocumentVersionContent({
  document,
  documentVersion,
  audioVersions,
  audioPlayer,
  documentVersions,
  activeVersionId,
  onVersionChange,
  onCreateNewVersion,
}: {
  document: Document;
  documentVersion: DocumentVersion;
  audioVersions: AudioVersionWithSegments[];
  audioPlayer?: AudioPlayerHook | null;
  documentVersions?: DocumentVersionProps[];
  activeVersionId?: string;
  onVersionChange?: (versionId: string) => void;
  onCreateNewVersion?: () => void;
}) {
  // Find audio versions for this document version
  const versionAudioVersions = useMemo(
    () =>
      audioVersions.filter(
        (av) => av.document_version_id === documentVersion.id
      ),
    [audioVersions, documentVersion.id]
  );

  // Use audio player data if available, otherwise fall back to local state
  const allSegments = audioPlayer?.allSegments || [];
  const sectionToggles = audioPlayer?.sectionToggles || {};
  const setSectionToggles = audioPlayer?.setSectionToggles || (() => {});
  const enabledSegmentIds = audioPlayer?.enabledSegmentIds || [];
  // const enabledSegments = audioPlayer?.enabledSegments || [];
  const segmentTimeline = audioPlayer?.segmentTimeline || [];
  const currentTime = audioPlayer?.currentTime || 0;
  const totalDuration = audioPlayer?.totalDuration || 0;
  const seekToTime = audioPlayer?.seekToTime || (() => {});
  const togglePlayback = audioPlayer?.togglePlayback || (() => {});
  const isPlaying = audioPlayer?.isPlaying || false;
  const concatenatedBuffer = audioPlayer?.concatenatedBuffer || null;
  const audioBufferToBlob = audioPlayer?.audioBufferToBlob || null;
  const skipBackward = audioPlayer?.skipBackward || (() => {});
  const skipForward = audioPlayer?.skipForward || (() => {});
  const playbackSpeed = audioPlayer?.playbackSpeed || 1;
  const setPlaybackSpeed = audioPlayer?.setPlaybackSpeed || (() => {});

  // Collapse state for tracks panel
  const [isTracksCollapsed, setIsTracksCollapsed] = useState(true);

  // Toggle tracks panel
  const toggleTracksPanel = useCallback(() => {
    setIsTracksCollapsed((prev) => !prev);
  }, []);

  function getSegmentProgress(segmentId: string) {
    const segment = segmentTimeline.find((s) => s.segmentId === segmentId);
    if (!segment || segment.startTime > currentTime) {
      return 0;
    }
    if (currentTime > segment.endTime) return 1;
    return (currentTime - segment.startTime) / segment.duration;
  }

  // Create unified word timestamps
  const unifiedWordTimestamps = useMemo(() => {
    const words: UnifiedWordTimestamp[] = [];

    segmentTimeline.forEach(({ segment, startTime }) => {
      if (segment.word_timestamps) {
        segment.word_timestamps.forEach((word) => {
          words.push({
            ...word,
            start: word.start + startTime,
            end: word.end + startTime,
            segmentId: segment.id,
            segmentTitle:
              segment.section_title || `Section ${segment.segment_number}`,
          });
        });
      }
    });

    return words;
  }, [segmentTimeline]);

  // Group words with punctuation
  const groupedWords = useMemo(() => {
    if (unifiedWordTimestamps.length === 0) return [];

    const groups: GroupedWord[] = [];
    let currentGroup: GroupedWord | null = null;

    const isPunctuation = (word: string) => {
      return /^[.!?,:;'"()[\]{}""''—–-]+$/.test(word.trim());
    };

    const isOpeningPunctuation = (word: string) => {
      return /^[([{""']+$/.test(word.trim());
    };

    const isClosingPunctuation = (word: string) => {
      return /^[)\]}.!?,:;""'—–-]+$/.test(word.trim());
    };

    unifiedWordTimestamps.forEach((wordTimestamp, index) => {
      const word = wordTimestamp.word;

      if (isPunctuation(word)) {
        if (isOpeningPunctuation(word)) {
          // Opening punctuation: merge with FOLLOWING word
          if (currentGroup) {
            // Push current group first
            groups.push(currentGroup);
          }

          // Start new group with opening punctuation
          currentGroup = {
            text: word,
            start: wordTimestamp.start,
            end: wordTimestamp.end,
            segmentId: wordTimestamp.segmentId,
            segmentTitle: wordTimestamp.segmentTitle,
            isTitle: wordTimestamp.isTitle,
            titleWordIndex: wordTimestamp.titleWordIndex,
          };
        } else {
          // Closing punctuation: merge with PRECEDING word (current behavior)
          if (currentGroup) {
            currentGroup.text += word;
            currentGroup.end = wordTimestamp.end;
            // Inherit title properties from the current group
          } else {
            currentGroup = {
              text: word,
              start: wordTimestamp.start,
              end: wordTimestamp.end,
              segmentId: wordTimestamp.segmentId,
              segmentTitle: wordTimestamp.segmentTitle,
              isTitle: wordTimestamp.isTitle,
              titleWordIndex: wordTimestamp.titleWordIndex,
            };
          }
        }
      } else {
        // Regular word
        if (currentGroup) {
          // If current group exists, merge this word with it (for opening punctuation case)
          // or push the current group and start new one
          if (isOpeningPunctuation(currentGroup.text)) {
            // Merge word with opening punctuation
            currentGroup.text += word;
            currentGroup.end = wordTimestamp.end;
            // Use the word's title properties (more important than punctuation's)
            currentGroup.isTitle = wordTimestamp.isTitle;
            currentGroup.titleWordIndex = wordTimestamp.titleWordIndex;
          } else {
            // Push current group and start new one
            groups.push(currentGroup);
            currentGroup = {
              text: word,
              start: wordTimestamp.start,
              end: wordTimestamp.end,
              segmentId: wordTimestamp.segmentId,
              segmentTitle: wordTimestamp.segmentTitle,
              isTitle: wordTimestamp.isTitle,
              titleWordIndex: wordTimestamp.titleWordIndex,
            };
          }
        } else {
          // Start new group with word
          currentGroup = {
            text: word,
            start: wordTimestamp.start,
            end: wordTimestamp.end,
            segmentId: wordTimestamp.segmentId,
            segmentTitle: wordTimestamp.segmentTitle,
            isTitle: wordTimestamp.isTitle,
            titleWordIndex: wordTimestamp.titleWordIndex,
          };
        }
      }
    });

    if (currentGroup) {
      groups.push(currentGroup);
    }

    return groups;
  }, [unifiedWordTimestamps]);

  const currentVersionVoices = useMemo(() => {
    if (!versionAudioVersions[0]) return [];
    return [
      ...new Set(versionAudioVersions[0].segments.map((s) => s.voice_name)),
    ];
  }, [versionAudioVersions]);

  const handleWordClick = useCallback(
    (wordStartTime: number) => {
      seekToTime(wordStartTime);
    },
    [seekToTime]
  );

  // Handle section toggle
  const handleSectionToggle = useCallback(
    (segmentId: string, enabled: boolean) => {
      if (isPlaying) {
        togglePlayback();
      }
      setSectionToggles((prev) => ({
        ...prev,
        [segmentId]: enabled,
      }));
    },
    [isPlaying, togglePlayback, setSectionToggles]
  );

  // Toggle all sections
  const handleToggleAll = useCallback(
    (enabled: boolean) => {
      const newToggles: { [segmentId: string]: boolean } = {};
      allSegments.forEach((segment) => {
        newToggles[segment.id] = enabled;
      });
      setSectionToggles(newToggles);
    },
    [allSegments, setSectionToggles]
  );

  // Handle download
  const handleDownload = useCallback(async () => {
    if (!concatenatedBuffer || !audioBufferToBlob) return;

    try {
      // Convert AudioBuffer to WAV Blob
      const wavBlob = await audioBufferToBlob(concatenatedBuffer);

      // Create download URL
      const downloadUrl = URL.createObjectURL(wavBlob);

      // Create and trigger download
      const link = window.document.createElement("a");
      link.href = downloadUrl;
      link.download = `${document.title} - ${documentVersion.version_name}.wav`;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);

      // Clean up
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error("Error downloading audio:", error);
    }
  }, [
    concatenatedBuffer,
    audioBufferToBlob,
    document.title,
    documentVersion.version_name,
  ]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Two columns taking most of the space */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        {/* Left column - Tracks list */}
        <div
          className={`h-full border-r border-gray-200 overflow-y-auto transition-all duration-300 ease-in-out relative ${
            isTracksCollapsed
              ? "w-0 min-w-0 border-r-0 overflow-hidden"
              : "w-90 min-w-90"
          }`}
        >
          {/* Toggle button on border - only show when panel is visible */}
          {/* {!isTracksCollapsed && (
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleTracksPanel}
              className="absolute top-1/2 -translate-y-1/2 -right-3 z-50 h-6 w-6 p-0 bg-white border border-gray-200 rounded-full shadow-sm hover:shadow-md"
              title="Collapse tracks"
            >
              <ChevronLeft className="w-3 h-3" />
            </Button>
          )} */}
          <div className="min-w-[360px]">
            <div className="flex flex-col gap-4">
              <div>
                <div className="p-4">
                  <div className="flex justify-between">
                    <div className="flex items-center gap-1">
                      <Label className="font-semibold mr-2">Tracks</Label>
                      <Badge variant="secondary">
                        <Clock className="w-3 h-3 mr-1" />
                        {formatDuration(totalDuration)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <SectionSelector
                        allSegments={allSegments}
                        sectionToggles={sectionToggles}
                        onSectionToggle={handleSectionToggle}
                        onToggleAll={handleToggleAll}
                      />
                    </div>
                  </div>
                </div>
                <div className="border-t border-gray-200">
                  {allSegments.map((segment) => (
                    <div
                      key={segment.id}
                      className="group relative flex justify-between border-b border-gray-200 p-4"
                    >
                      {/* section progress */}
                      <div
                        className="absolute bottom-0 top-0 left-0 h-full bg-gray-100"
                        style={{
                          width: `${getSegmentProgress(segment.id) * 100}%`,
                        }}
                      />
                      <div className="flex items-center gap-3 z-1">
                        <Label
                          htmlFor={segment.id}
                          className={`font-medium cursor-pointer leading-6 ${
                            !sectionToggles[segment.id]
                              ? "text-gray-400 line-through"
                              : ""
                          }`}
                        >
                          {segment.section_title ||
                            `Section ${segment.segment_number}`}
                        </Label>
                        {sectionToggles[segment.id] && (
                          <Button
                            variant="secondary"
                            size="icon"
                            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 hover:bg-gray-200 rounded flex items-center justify-center shadow-none cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              // Find the segment in timeline and seek to its start time
                              const segmentInfo = segmentTimeline.find(
                                (s) => s.segmentId === segment.id
                              );
                              if (segmentInfo) {
                                seekToTime(segmentInfo.startTime);
                                // if (!isPlaying) togglePlayback();
                              }
                            }}
                            title={`Skip to ${
                              segment.section_title ||
                              `Section ${segment.segment_number}`
                            }`}
                          >
                            <SkipForwardIcon className="!w-3 !h-3" />
                          </Button>
                        )}
                      </div>
                      <div className="flex items-center gap-2 z-1">
                        <div
                          className={`text-sm  ${
                            !sectionToggles[segment.id]
                              ? "text-gray-400 line-through"
                              : ""
                          }`}
                        >
                          {formatDuration(segment.audio_duration || 0)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {/* {audioPlayer &&
              !audioPlayer.isLoading &&
              allSegments.length > 0 &&
              enabledSegmentIds.length === 0 && (
                <div className="text-center py-6 text-gray-500">
                  <p>
                    No sections selected. Enable sections above to create your
                    custom audio experience.
                  </p>
                </div>
              )} */}
        </div>
        {/* Right column - Word highlight display */}
        <div
          className="flex-1 bg-white overflow-y-auto overflow-x-hidden min-h-0 px-12"
        >

          {versionAudioVersions.length > 0 && enabledSegmentIds.length > 0 ? (
            <div className="max-w-[800px] mx-auto">
              <div className="flex flex-col gap-2 flex-shrink-0 pb-8 pt-16">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <Toggle
                      pressed={!isTracksCollapsed}
                      onPressedChange={(pressed) =>
                        setIsTracksCollapsed(!pressed)
                      }
                      aria-label="Toggle tracks panel"
                    >
                      <List className="h-4 w-4" />
                    </Toggle>
                    <h2 className="text-2xl font-semibold">
                      {document.title}
                    </h2>
                  </div>
                  <div className="flex items-center gap-1">
                    {documentVersions && documentVersions.length > 0 && (
                      <Select
                        value={activeVersionId}
                        onValueChange={onVersionChange}
                      >
                        <SelectTrigger className="text-gray-800">
                          <SelectValue placeholder="Select version" />
                        </SelectTrigger>
                        <SelectContent>
                          {documentVersions.map((version) => (
                            <SelectItem
                              key={version.id}
                              value={version.id}
                              className="cursor-pointer"
                            >
                              {version.version_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {onCreateNewVersion && (
                      <div className="relative">
                        <Button
                          variant="outline"
                          className="relative"
                          onClick={onCreateNewVersion}
                        >
                          <Plus />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              {audioPlayer && (
                <div className="sticky top-0 z-10 bg-white border-b border-gray-200 mb-8">
                  {audioPlayer.isLoading ? (
                    <div className="bg-white">
                      <div className="w-full h-14.25 flex items-center">
                        <div className="flex items-center gap-2 px-4">
                          {/* Skip backward skeleton */}
                          <div className="h-6 w-6 bg-gray-200 rounded animate-pulse" />
                          {/* Play button skeleton */}
                          <div className="h-8 w-8 bg-gray-200 rounded-full animate-pulse" />
                          {/* Skip forward skeleton */}
                          <div className="h-6 w-6 bg-gray-200 rounded animate-pulse" />
                          {/* Speed selector skeleton */}
                          <div className="h-6 w-12 bg-gray-200 rounded animate-pulse ml-1" />
                        </div>
                        {/* Waveform skeleton */}
                        <div className="relative w-full px-4">
                          <div className="w-full h-10 bg-gray-200 rounded animate-pulse" />
                        </div>
                        {/* Time display skeleton */}
                        <div className="px-4 flex gap-2">
                          <div className="h-4 w-12 bg-gray-200 rounded animate-pulse" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full">
                      <AudioPlayerControls
                        audioPlayer={audioPlayer}
                        onDownload={concatenatedBuffer && audioBufferToBlob ? handleDownload : undefined}
                        downloadTitle={`Download ${document.title} - ${documentVersion.version_name}.wav`}
                      />
                    </div>
                  )}
                </div>
              )}

              <WordHighlightDisplay
                documentTitle={document.title}
                author={document.author}
                voices={currentVersionVoices}
                versionName={documentVersion.version_name}
                groupedWords={groupedWords}
                segmentTimeline={segmentTimeline}
                currentTime={currentTime}
                onWordClick={handleWordClick}
                documentVersions={documentVersions}
                activeVersionId={activeVersionId}
                onVersionChange={onVersionChange}
                onCreateNewVersion={onCreateNewVersion}
              />
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500">
                {versionAudioVersions.length === 0
                  ? "No audio versions available for this document version."
                  : ""}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
