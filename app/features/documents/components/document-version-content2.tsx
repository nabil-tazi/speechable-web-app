import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type {
  AudioSegment,
  AudioVersionWithSegments,
  WordTimestamp,
} from "../../audio/types";
import type { Document, DocumentVersion } from "../types";
import type { AudioPlayerHook } from "../../audio/hooks/use-audio-player";
import { Clock } from "lucide-react";
import { formatDuration } from "../../audio/utils";
import { useMemo, useCallback } from "react";
import { WordHighlightDisplay } from "../../audio/components/word-highlight";
import { SectionSelector } from "./section-selector";

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

export function DocumentVersionContent({
  document,
  documentVersion,
  audioVersions,
  audioPlayer,
}: {
  document: Document;
  documentVersion: DocumentVersion;
  audioVersions: AudioVersionWithSegments[];
  audioPlayer?: AudioPlayerHook | null;
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
  // const setPlaybackSpeed = audioPlayer?.setPlaybackSpeed || (() => {});

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

  // Convert AudioBuffer to WAV Blob
  // const audioBufferToBlob = async (buffer: AudioBuffer): Promise<Blob> => {
  //   const numberOfChannels = buffer.numberOfChannels;
  //   const length = buffer.length;
  //   const sampleRate = buffer.sampleRate;

  //   const arrayBuffer = new ArrayBuffer(44 + length * numberOfChannels * 2);
  //   const view = new DataView(arrayBuffer);

  //   const writeString = (offset: number, string: string) => {
  //     for (let i = 0; i < string.length; i++) {
  //       view.setUint8(offset + i, string.charCodeAt(i));
  //     }
  //   };

  //   writeString(0, "RIFF");
  //   view.setUint32(4, 36 + length * numberOfChannels * 2, true);
  //   writeString(8, "WAVE");
  //   writeString(12, "fmt ");
  //   view.setUint32(16, 16, true);
  //   view.setUint16(20, 1, true);
  //   view.setUint16(22, numberOfChannels, true);
  //   view.setUint32(24, sampleRate, true);
  //   view.setUint32(28, sampleRate * numberOfChannels * 2, true);
  //   view.setUint16(32, numberOfChannels * 2, true);
  //   view.setUint16(34, 16, true);
  //   writeString(36, "data");
  //   view.setUint32(40, length * numberOfChannels * 2, true);

  //   let offset = 44;
  //   for (let i = 0; i < length; i++) {
  //     for (let channel = 0; channel < numberOfChannels; channel++) {
  //       const sample = Math.max(
  //         -1,
  //         Math.min(1, buffer.getChannelData(channel)[i])
  //       );
  //       view.setInt16(
  //         offset,
  //         sample < 0 ? sample * 0x8000 : sample * 0x7fff,
  //         true
  //       );
  //       offset += 2;
  //     }
  //   }

  //   return new Blob([arrayBuffer], { type: "audio/wav" });
  // };

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

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Two columns taking most of the space */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left column - Tracks list */}
        <div className="w-90 min-w-90 h-full border-r border-gray-200 overflow-y-auto overflow-x-hidden">
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
                    {/* {currentVersionVoices[0] && (
                      <Badge variant="secondary">
                        <MicVocal className="w-3 h-3 mr-1" />
                        {currentVersionVoices[0]}
                        {currentVersionVoices.length > 1 && (
                          <> +{currentVersionVoices.length - 1}</>
                        )}
                      </Badge>
                    )} */}
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
        </div>
        {/* Right column - Word highlight display */}
        <div className="flex-1 bg-white overflow-hidden min-h-0">
          {versionAudioVersions.length > 0 && enabledSegmentIds.length > 0 ? (
            <WordHighlightDisplay
              documentTitle={document.title}
              author={document.author}
              voices={currentVersionVoices}
              versionName={documentVersion.version_name}
              groupedWords={groupedWords}
              segmentTimeline={segmentTimeline}
              currentTime={currentTime}
              onWordClick={handleWordClick}
            />
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
