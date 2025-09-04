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
import { Clock, Download } from "lucide-react";
import { formatDuration } from "../../audio/utils";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { getAudioUrl } from "@/app/utils/storage";
import WaveSurfer from "wavesurfer.js";
import { AudioPlayerControls } from "../../audio/components/audio-player-controls";
import { WordHighlightDisplay } from "../../audio/components/word-highlight";
import { SectionSelector } from "./section-selector";
import { SpeedSelector } from "./speed-selector";

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

interface SectionToggleState {
  [segmentId: string]: boolean;
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
  const [isDownloading, setIsDownloading] = useState(false);
  // const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
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

  const [gain, setGain] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  useEffect(() => {
    if (!concatenatedBuffer) return;

    let rafId: number;
    const updateGain = () => {
      const g = getGainAtTime(concatenatedBuffer, currentTime, 2048);
      setGain(g);
      rafId = requestAnimationFrame(updateGain);
    };
    updateGain();

    return () => cancelAnimationFrame(rafId);
  }, [concatenatedBuffer, currentTime]);

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
      const duration = Math.max(
        segment?.word_timestamps?.[segment?.word_timestamps.length - 1].end ||
          0,
        segment?.audio_duration || 0
      );
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

  function getSegmentProgress(segmentId: string) {
    const segment = segmentTimeline.find((s) => s.segmentId === segmentId);
    // console.log(segment?.duration);

    if (!segment || segment.startTime > currentTime) {
      return 0;
    }
    if (currentTime > segment.endTime) return 1;
    // console.log((currentTime - segment.startTime) / segment.duration);
    return (currentTime - segment.startTime) / segment.duration;
  }

  function getGainAtTime(buffer: AudioBuffer, time: number, windowSize = 1024) {
    const sampleRate = buffer.sampleRate;
    const channelData = buffer.getChannelData(0); // first channel (mono or left)

    // Index in samples
    const centerIndex = Math.floor(time * sampleRate);

    // Pick a small window around that point (e.g. ±512 samples)
    const start = Math.max(0, centerIndex - windowSize / 2);
    const end = Math.min(channelData.length, centerIndex + windowSize / 2);

    let sumSquares = 0;
    for (let i = start; i < end; i++) {
      const sample = channelData[i];
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / (end - start));
    return rms; // 0.0–1.0 (roughly), higher = louder
  }

  const handleSpeedChange = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, []);

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

        // if (mounted) {
        //   setAudioContext(ctx);
        // }

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
        waveColor: "rgba(75, 85, 99, 0.9)",
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
  // Replace your existing audio element useEffect with this version
  useEffect(() => {
    if (!concatenatedUrl) return;

    const audio = new Audio(concatenatedUrl);
    audio.preload = "metadata";
    audioRef.current = audio;

    let animationFrameId: number;
    let isAnimating = false;

    // Smooth time updates using requestAnimationFrame
    const smoothUpdateTime = () => {
      if (!isDragging && audio && !audio.paused) {
        setCurrentTime(audio.currentTime);
        setProgress((audio.currentTime / totalDuration) * 100);
      }

      if (isAnimating) {
        animationFrameId = requestAnimationFrame(smoothUpdateTime);
      }
    };

    // Fallback time update (for when requestAnimationFrame isn't running)
    const updateTime = () => {
      if (!isDragging && audio && !isAnimating) {
        setCurrentTime(audio.currentTime);
        setProgress((audio.currentTime / totalDuration) * 100);
      }
    };

    const handlePlay = () => {
      isAnimating = true;
      smoothUpdateTime(); // Start smooth updates
    };

    const handlePause = () => {
      isAnimating = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };

    const handleLoadedMetadata = () => {
      setBrowserDuration(audio.duration);
      setIsReady(true);
    };

    const handleEnded = () => {
      isAnimating = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      setIsPlaying(false);
      setCurrentTime(0);
      setProgress(0);
    };

    // Event listeners
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("timeupdate", updateTime); // Fallback
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);

    return () => {
      isAnimating = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }

      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
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
  // const drawSegmentSeparators = useCallback(() => {
  //   if (!containerRef.current || !waveformReady || totalDuration === 0) return;

  //   const container = containerRef.current;
  //   const existingSeparators = container.querySelectorAll(".segment-separator");
  //   existingSeparators.forEach((el) => el.remove());

  //   let cumulativeTime = 0;
  //   segmentTimeline.forEach((segmentInfo, index) => {
  //     if (index === 0) {
  //       cumulativeTime += segmentInfo.duration;
  //       return;
  //     }

  //     const position = (cumulativeTime / totalDuration) * 100;

  //     const separator = window.document.createElement("div");
  //     separator.className = "segment-separator";
  //     separator.style.cssText = `
  //       position: absolute;
  //       left: ${position}%;
  //       top: 0;
  //       bottom: 0;
  //       width: 2px;
  //       background: rgba(59, 130, 246, 0.5);
  //       pointer-events: none;
  //       z-index: 25;
  //     `;

  //     container.appendChild(separator);
  //     cumulativeTime += segmentInfo.duration;
  //   });
  // }, [waveformReady, segmentTimeline, totalDuration]);

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
      if (isPlaying) {
        togglePlayback();
      }
      setSectionToggles((prev) => ({
        ...prev,
        [segmentId]: enabled,
      }));
    },
    []
  );

  // Handle download MP3
  const handleDownloadMP3 = useCallback(async () => {
    if (!concatenatedUrl) {
      console.error("No audio available to download");
      return;
    }
    setIsDownloading(true);

    try {
      // Create filename based on document and version
      const filename = `${document.title.replace(
        /[^a-z0-9]/gi,
        "_"
      )}_${documentVersion.version_name.replace(/[^a-z0-9]/gi, "_")}.mp3`;

      // Fetch the audio blob
      const response = await fetch(concatenatedUrl);
      const blob = await response.blob();

      // Create download link
      const downloadUrl = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;

      // Trigger download
      window.document.body.appendChild(link);
      link.click();

      // Clean up
      window.document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error("Error downloading MP3:", error);
    } finally {
      setIsDownloading(false);
    }
  }, [concatenatedUrl, document.title, documentVersion.version_name]);

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
        {versionAudioVersions.length > 0 && (
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
            gain={gain}
            onTogglePlayback={togglePlayback}
            onSkipBackward={skipBackward}
            onSkipForward={skipForward}
            onProgressClick={handleProgressClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            // onDrawSegmentSeparators={drawSegmentSeparators}
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
                    <SpeedSelector
                      currentSpeed={playbackSpeed} // You'll need to add this state
                      onSpeedChange={handleSpeedChange} // You'll need to implement this handler
                      disabled={
                        !concatenatedUrl || enabledSegmentIds.length === 0
                      }
                      isLoading={isDownloading || isLoading}
                    />
                    <Separator orientation="vertical" />
                    <Button
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={handleDownloadMP3}
                      disabled={
                        !concatenatedUrl ||
                        enabledSegmentIds.length === 0 ||
                        isDownloading ||
                        isLoading
                      }
                      title={isDownloading ? "Downloading..." : "Download MP3"}
                    >
                      {isDownloading || isLoading ? (
                        <div className="animate-spin h-3 w-3 border border-gray-900 border-t-transparent rounded-full" />
                      ) : (
                        <Download />
                      )}
                    </Button>
                    <Separator orientation="vertical" />
                    {/* <Button variant="ghost" className="h-6 w-6 p-0">
                      <MoreVertical />
                    </Button> */}
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
                  : "No sections selected for playback"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
