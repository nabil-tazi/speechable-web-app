import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { AudioVersionWithSegments } from "../../audio/types";
import type { Document, DocumentVersion } from "../types";
import { Clock, MicVocal, Download, MoreVertical } from "lucide-react";
import { formatDuration } from "../../audio/utils";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { getAudioUrl } from "@/app/utils/storage";
import WaveSurfer from "wavesurfer.js";
import { AudioPlayerControls } from "../../audio/components/audio-player-controls";
import { WordHighlightDisplay } from "../../audio/components/word-highlight";

interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

interface AudioSegment {
  id: string;
  audio_version_id: string;
  segment_number: number;
  section_title?: string;
  start_page?: number;
  end_page?: number;
  text_start_index?: number;
  text_end_index?: number;
  audio_path: string;
  audio_duration?: number;
  audio_file_size: number;
  word_timestamps?: WordTimestamp[];
  created_at: string;
}

interface UnifiedWordTimestamp extends WordTimestamp {
  segmentId: string;
  segmentTitle: string;
}

interface GroupedWord {
  text: string;
  start: number;
  end: number;
  segmentId: string;
  segmentTitle: string;
}

interface SectionToggleState {
  [segmentId: string]: boolean;
}

export function DocumentVersionContent({
  document,
  documentVersion,
  audioVersions,
}: {
  document: Document;
  documentVersion: DocumentVersion;
  audioVersions: AudioVersionWithSegments[];
}) {
  // Find audio versions for this document version
  const versionAudioVersions = useMemo(
    () =>
      audioVersions.filter(
        (av) => av.document_version_id === documentVersion.id
      ),
    [audioVersions, documentVersion.id]
  );

  // Get all segments from all audio versions, sorted by segment number
  const allSegments = useMemo(() => {
    const segments: AudioSegment[] = [];
    versionAudioVersions.forEach((audioVersion) => {
      segments.push(...audioVersion.segments);
    });
    return segments.sort((a, b) => a.segment_number - b.segment_number);
  }, [versionAudioVersions]);

  // State for section toggles
  const [sectionToggles, setSectionToggles] = useState<SectionToggleState>({});

  // Audio state
  const [isLoading, setIsLoading] = useState(false);
  const [waveformReady, setWaveformReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [browserDuration, setBrowserDuration] = useState(0);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [concatenatedBuffer, setConcatenatedBuffer] =
    useState<AudioBuffer | null>(null);
  const [concatenatedUrl, setConcatenatedUrl] = useState<string | null>(null);

  // Derived state that depends on toggles
  const [enabledSegmentIds, setEnabledSegmentIds] = useState<string[]>([]);
  const [enabledSegments, setEnabledSegments] = useState<AudioSegment[]>([]);
  const [totalDuration, setTotalDuration] = useState(0);

  // Refs
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize section toggles (all enabled by default)
  useEffect(() => {
    if (allSegments.length > 0 && Object.keys(sectionToggles).length === 0) {
      const initialToggles: SectionToggleState = {};
      allSegments.forEach((segment) => {
        initialToggles[segment.id] = true;
      });
      setSectionToggles(initialToggles);
    }
  }, [allSegments]);

  // Update enabled segments when toggles change
  useEffect(() => {
    if (Object.keys(sectionToggles).length === 0) {
      setEnabledSegmentIds([]);
      setEnabledSegments([]);
      return;
    }

    const enabledIds = allSegments
      .filter((segment) => sectionToggles[segment.id])
      .map((segment) => segment.id);

    const enabled = allSegments
      .filter((segment) => sectionToggles[segment.id])
      .sort((a, b) => a.segment_number - b.segment_number);

    const total = enabled.reduce(
      (acc, segment) => acc + (segment.audio_duration || 0),
      0
    );

    setEnabledSegmentIds(enabledIds);
    setEnabledSegments(enabled);
    setTotalDuration(total);
  }, [allSegments, sectionToggles]);

  // Calculate segment timeline - depends on enabled segments
  const segmentTimeline = useMemo(() => {
    let cumulativeTime = 0;
    return enabledSegments.map((segment) => {
      const startTime = cumulativeTime;
      const duration =
        segment?.word_timestamps?.[segment?.word_timestamps.length - 1].end ||
        0;
      const endTime = cumulativeTime + duration;
      cumulativeTime += duration;

      return {
        segmentId: segment.id,
        startTime,
        endTime,
        duration,
        segment,
      };
    });
  }, [enabledSegments]);

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

    unifiedWordTimestamps.forEach((wordTimestamp) => {
      const word = wordTimestamp.word;

      if (isPunctuation(word)) {
        if (currentGroup) {
          currentGroup.text += word;
          currentGroup.end = wordTimestamp.end;
        } else {
          currentGroup = {
            text: word,
            start: wordTimestamp.start,
            end: wordTimestamp.end,
            segmentId: wordTimestamp.segmentId,
            segmentTitle: wordTimestamp.segmentTitle,
          };
        }
      } else {
        if (currentGroup) {
          groups.push(currentGroup);
        }

        currentGroup = {
          text: word,
          start: wordTimestamp.start,
          end: wordTimestamp.end,
          segmentId: wordTimestamp.segmentId,
          segmentTitle: wordTimestamp.segmentTitle,
        };
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
  const audioBufferToBlob = async (buffer: AudioBuffer): Promise<Blob> => {
    const numberOfChannels = buffer.numberOfChannels;
    const length = buffer.length;
    const sampleRate = buffer.sampleRate;

    const arrayBuffer = new ArrayBuffer(44 + length * numberOfChannels * 2);
    const view = new DataView(arrayBuffer);

    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + length * numberOfChannels * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numberOfChannels * 2, true);
    view.setUint16(32, numberOfChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, length * numberOfChannels * 2, true);

    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = Math.max(
          -1,
          Math.min(1, buffer.getChannelData(channel)[i])
        );
        view.setInt16(
          offset,
          sample < 0 ? sample * 0x8000 : sample * 0x7fff,
          true
        );
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  };

  // Load and concatenate audio - only depends on the segment IDs array
  useEffect(() => {
    let mounted = true;

    const concatenateAudio = async () => {
      if (enabledSegmentIds.length === 0) {
        if (mounted) {
          setConcatenatedUrl(null);
          setIsLoading(false);
        }
        return;
      }

      if (mounted) {
        setIsLoading(true);
      }

      try {
        // Initialize AudioContext
        const ctx = new (window.AudioContext ||
          (window as any).webkitAudioContext)();

        if (mounted) {
          setAudioContext(ctx);
        }

        // Get segments by IDs to avoid dependency issues
        const segmentsToUse = allSegments
          .filter((segment) => enabledSegmentIds.includes(segment.id))
          .sort((a, b) => a.segment_number - b.segment_number);

        // Load all audio buffers
        const audioBuffers: AudioBuffer[] = [];
        let totalLength = 0;

        for (const segment of segmentsToUse) {
          if (!mounted) break;

          const audioUrl = await getAudioUrl(segment.audio_path);
          if (!audioUrl) continue;

          const response = await fetch(audioUrl);
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

          audioBuffers.push(audioBuffer);
          totalLength += audioBuffer.length;
        }

        if (!mounted || audioBuffers.length === 0) return;

        // Create concatenated buffer
        const numberOfChannels = audioBuffers[0].numberOfChannels;
        const sampleRate = audioBuffers[0].sampleRate;
        const concatenated = ctx.createBuffer(
          numberOfChannels,
          totalLength,
          sampleRate
        );

        // Copy data from all buffers
        let offset = 0;
        for (let channel = 0; channel < numberOfChannels; channel++) {
          const outputData = concatenated.getChannelData(channel);
          offset = 0;

          for (const buffer of audioBuffers) {
            const inputData = buffer.getChannelData(channel);
            outputData.set(inputData, offset);
            offset += buffer.length;
          }
        }

        if (mounted) {
          setConcatenatedBuffer(concatenated);
        }

        // Convert buffer to blob URL
        const blob = await audioBufferToBlob(concatenated);
        const url = URL.createObjectURL(blob);

        if (mounted) {
          setConcatenatedUrl(url);
        }
      } catch (error) {
        console.error("Error concatenating audio:", error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    concatenateAudio();

    return () => {
      mounted = false;
      if (concatenatedUrl) {
        URL.revokeObjectURL(concatenatedUrl);
      }
    };
  }, [enabledSegmentIds.join(","), allSegments]); // Use join to create stable dependency

  // Initialize WaveSurfer with concatenated audio
  useEffect(() => {
    if (!containerRef.current || !concatenatedUrl) return;

    if (wavesurferRef.current) {
      try {
        wavesurferRef.current.destroy();
      } catch (error) {
        console.warn("Error destroying previous wavesurfer instance:", error);
      }
    }

    try {
      const wavesurfer = WaveSurfer.create({
        container: containerRef.current,
        waveColor: "rgba(148, 163, 184, 0.6)",
        progressColor: "rgba(148, 163, 184, 0.6)",
        cursorColor: "transparent",
        barWidth: 1,
        barGap: 1,
        barRadius: 2,
        height: 40,
        normalize: true,
        interact: false,
        backend: "MediaElement",
        mediaControls: false,
        audioRate: 1,
        hideScrollbar: true,
      });

      wavesurferRef.current = wavesurfer;

      wavesurfer.on("ready", () => {
        setWaveformReady(true);
        setIsReady(true);
      });

      wavesurfer.on("error", (error: any) => {
        console.error("WaveSurfer error:", error);
      });

      wavesurfer.load(concatenatedUrl);
    } catch (error) {
      console.error("Error initializing WaveSurfer:", error);
    }
  }, [concatenatedUrl]);

  // Create audio element for playback
  useEffect(() => {
    if (!concatenatedUrl) return;

    const audio = new Audio(concatenatedUrl);
    audio.preload = "metadata";
    audioRef.current = audio;

    const updateTime = () => {
      if (!isDragging && audio) {
        setCurrentTime(audio.currentTime);
        setProgress((audio.currentTime / totalDuration) * 100);
      }
    };

    const handleLoadedMetadata = () => {
      setBrowserDuration(audio.duration);
      setIsReady(true);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      setProgress(0);
    };

    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audio.pause();
      audio.src = "";
    };
  }, [concatenatedUrl, totalDuration]);

  // Get effective duration
  const getEffectiveDuration = useCallback(() => {
    return totalDuration && totalDuration > 0 ? totalDuration : browserDuration;
  }, [totalDuration, browserDuration]);

  // Draw segment separators on waveform
  const drawSegmentSeparators = useCallback(() => {
    if (!containerRef.current || !waveformReady || totalDuration === 0) return;

    const container = containerRef.current;
    const existingSeparators = container.querySelectorAll(".segment-separator");
    existingSeparators.forEach((el) => el.remove());

    let cumulativeTime = 0;
    segmentTimeline.forEach((segmentInfo, index) => {
      if (index === 0) {
        cumulativeTime += segmentInfo.duration;
        return;
      }

      const position = (cumulativeTime / totalDuration) * 100;

      const separator = window.document.createElement("div");
      separator.className = "segment-separator";
      separator.style.cssText = `
        position: absolute;
        left: ${position}%;
        top: 0;
        bottom: 0;
        width: 2px;
        background: rgba(59, 130, 246, 0.5);
        pointer-events: none;
        z-index: 25;
      `;

      container.appendChild(separator);
      cumulativeTime += segmentInfo.duration;
    });
  }, [waveformReady, segmentTimeline, totalDuration]);

  // Playback controls
  const togglePlayback = useCallback(() => {
    if (!isReady || !audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch((error) => {
          console.error("Error playing audio:", error);
        });
    }
  }, [isPlaying, isReady]);

  const seekToTime = useCallback(
    (targetTime: number) => {
      if (!audioRef.current) return;

      const effectiveDuration = getEffectiveDuration();
      const clampedTime = Math.max(0, Math.min(targetTime, effectiveDuration));

      // Handle duration mapping
      if (
        totalDuration &&
        browserDuration > 0 &&
        Math.abs(browserDuration - totalDuration) >= 0.1
      ) {
        // Map our desired time to the actual audio file position
        const mappedTime = (clampedTime / totalDuration) * browserDuration;
        audioRef.current.currentTime = Math.max(
          0,
          Math.min(mappedTime, browserDuration)
        );
      } else {
        // Direct mapping when durations match
        audioRef.current.currentTime = clampedTime;
      }

      setCurrentTime(clampedTime);
      setProgress((clampedTime / effectiveDuration) * 100);
    },
    [totalDuration, browserDuration, getEffectiveDuration]
  );

  const skipBackward = useCallback(() => {
    const newTime = Math.max(0, currentTime - 10);
    seekToTime(newTime);
  }, [currentTime, seekToTime]);

  const skipForward = useCallback(() => {
    const newTime = Math.min(totalDuration, currentTime + 10);
    seekToTime(newTime);
  }, [currentTime, totalDuration, seekToTime]);

  // Progress bar handlers
  const handleProgressClick = useCallback(
    (e: React.MouseEvent) => {
      const container = e.currentTarget;
      const audio = audioRef.current;
      const effectiveDuration = getEffectiveDuration();

      console.log(audio);

      if (!container || !audio || effectiveDuration === 0 || !isReady) return;

      const rect = container.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percentage = Math.max(
        0,
        Math.min(100, (clickX / rect.width) * 100)
      );

      const newTime = (percentage / 100) * effectiveDuration;
      seekToTime(newTime);
    },
    [isReady, getEffectiveDuration, seekToTime]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true);
      handleProgressClick(e);
    },
    [handleProgressClick]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      handleProgressClick(e);
    },
    [isDragging, handleProgressClick]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWordClick = useCallback(
    (wordStartTime: number) => {
      seekToTime(wordStartTime);
    },
    [seekToTime]
  );

  // Handle section toggle
  const handleSectionToggle = useCallback(
    (segmentId: string, enabled: boolean) => {
      setSectionToggles((prev) => ({
        ...prev,
        [segmentId]: enabled,
      }));
    },
    []
  );

  // Handle download MP3
  function handleDownloadMP3() {}

  // Toggle all sections
  const handleToggleAll = useCallback(
    (enabled: boolean) => {
      const newToggles: SectionToggleState = {};
      allSegments.forEach((segment) => {
        newToggles[segment.id] = enabled;
      });
      setSectionToggles(newToggles);
    },
    [allSegments]
  );

  return (
    <div className="h-full flex flex-col overflow-hidden min-h-0 flex-1">
      {/* Full-width player at the top */}
      <div className="w-full border-b border-gray-200">
        {versionAudioVersions.length > 0 && enabledSegmentIds.length > 0 && (
          <AudioPlayerControls
            isLoading={isLoading}
            waveformReady={waveformReady}
            isPlaying={isPlaying}
            isReady={isReady}
            currentTime={currentTime}
            totalDuration={totalDuration}
            progress={progress}
            isDragging={isDragging}
            containerRef={containerRef}
            onTogglePlayback={togglePlayback}
            onSkipBackward={skipBackward}
            onSkipForward={skipForward}
            onProgressClick={handleProgressClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onDrawSegmentSeparators={drawSegmentSeparators}
          />
        )}
      </div>

      {/* Two columns below */}
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
                    {currentVersionVoices[0] && (
                      <Badge variant="secondary">
                        <MicVocal className="w-3 h-3 mr-1" />
                        {currentVersionVoices[0]}
                        {currentVersionVoices.length > 1 && (
                          <> +{currentVersionVoices.length - 1}</>
                        )}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" className="h-6 w-6 p-0">
                      <Download />
                    </Button>
                    <Separator orientation="vertical" />
                    <Button variant="ghost" className="h-6 w-6 p-0">
                      <MoreVertical />
                    </Button>
                  </div>
                </div>
              </div>
              <div className="border-t border-gray-200">
                {allSegments.map((segment) => (
                  <div
                    key={segment.id}
                    className="flex justify-between border-b border-gray-200 p-4 cursor-pointer hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-3">
                      <Label
                        htmlFor={segment.id}
                        className={`font-medium cursor-pointer ${
                          !sectionToggles[segment.id]
                            ? "text-gray-400 line-through"
                            : ""
                        }`}
                      >
                        {segment.section_title ||
                          `Section ${segment.segment_number}`}
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
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
            {enabledSegmentIds.length === 0 && (
              <div className="text-center py-6 text-gray-500">
                <p>
                  No sections selected. Enable sections above to create your
                  custom audio experience.
                </p>
              </div>
            )}
          </div>
        </div>
        {/* Right column - Word highlight display */}
        <div className="flex-1 bg-white overflow-hidden min-h-0">
          {versionAudioVersions.length > 0 && enabledSegmentIds.length > 0 ? (
            <WordHighlightDisplay
              documentTitle={document.title}
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
                  : "No sections selected for playback"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
