import { getAudioUrl } from "@/app/utils/storage";
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import WaveSurfer from "wavesurfer.js";
import { UndoDot, RedoDot } from "lucide-react";

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

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const PauseIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);

export function UnifiedAudioPlayer({
  segments,
  enabledSegmentIds,
}: {
  segments: AudioSegment[];
  enabledSegmentIds: string[];
}) {
  // Filter enabled segments
  const enabledSegments = useMemo(() => {
    return segments
      .filter((segment) => enabledSegmentIds.includes(segment.id))
      .sort((a, b) => a.segment_number - b.segment_number);
  }, [segments, enabledSegmentIds]);

  // State
  const [isLoading, setIsLoading] = useState(false);
  const [waveformReady, setWaveformReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [progress, setProgress] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [browserDuration, setBrowserDuration] = useState(0);

  // Audio concatenation state
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [concatenatedBuffer, setConcatenatedBuffer] =
    useState<AudioBuffer | null>(null);
  const [concatenatedUrl, setConcatenatedUrl] = useState<string | null>(null);

  // Refs
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressContainerRef = useRef<HTMLDivElement>(null);
  const highlightedWordRef = useRef<HTMLSpanElement>(null);

  // Calculate segment timeline for unified timestamps
  const segmentTimeline = useMemo(() => {
    let cumulativeTime = 0;
    return enabledSegments.map((segment) => {
      const startTime = cumulativeTime;
      const duration = segment.audio_duration || 0;
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

  // Calculate total duration
  useEffect(() => {
    const total = enabledSegments.reduce(
      (acc, segment) => acc + (segment.audio_duration || 0),
      0
    );
    setTotalDuration(total);
  }, [enabledSegments]);

  // Load and concatenate audio
  useEffect(() => {
    const concatenateAudio = async () => {
      if (enabledSegments.length === 0) {
        setConcatenatedUrl(null);
        return;
      }

      setIsLoading(true);

      try {
        // Initialize AudioContext
        const ctx = new (window.AudioContext ||
          (window as any).webkitAudioContext)();
        setAudioContext(ctx);

        // Load all audio buffers
        const audioBuffers: AudioBuffer[] = [];
        let totalLength = 0;

        for (const segment of enabledSegments) {
          const audioUrl = await getAudioUrl(segment.audio_path);
          if (!audioUrl) continue;

          const response = await fetch(audioUrl);
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

          audioBuffers.push(audioBuffer);
          totalLength += audioBuffer.length;
        }

        if (audioBuffers.length === 0) return;

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

        setConcatenatedBuffer(concatenated);

        // Convert buffer to blob URL
        const blob = await audioBufferToBlob(concatenated);
        const url = URL.createObjectURL(blob);
        setConcatenatedUrl(url);
      } catch (error) {
        console.error("Error concatenating audio:", error);
      } finally {
        setIsLoading(false);
      }
    };

    concatenateAudio();

    return () => {
      if (concatenatedUrl) {
        URL.revokeObjectURL(concatenatedUrl);
      }
    };
  }, [enabledSegments]);

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
        barWidth: 3,
        barGap: 1,
        barRadius: 2,
        height: 80,
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
        drawSegmentSeparators();
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
    if (concatenatedUrl) {
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
        console.log("PAUSING BREAKING");
        audio.removeEventListener("timeupdate", updateTime);
        audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
        audio.removeEventListener("ended", handleEnded);
        audio.pause();
        audio.src = "";
      };
    }
  }, [concatenatedUrl, totalDuration]);

  // Get effective duration (similar to original component)
  const getEffectiveDuration = useCallback(() => {
    return totalDuration && totalDuration > 0 ? totalDuration : browserDuration;
  }, [totalDuration, browserDuration]);

  // Draw segment separators on waveform
  const drawSegmentSeparators = useCallback(() => {
    if (!containerRef.current || !waveformReady) return;

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

      const separator = document.createElement("div");
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
    console.log(!isReady || !audioRef.current);

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

      // Handle duration mapping like the original component
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

  // Progress bar handlers (fixed version)
  const handleProgressClick = useCallback(
    (e: React.MouseEvent) => {
      const container = progressContainerRef.current;
      const audio = audioRef.current;
      const effectiveDuration = getEffectiveDuration();

      if (!container || !audio || effectiveDuration === 0 || !isReady) return;

      const rect = container.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percentage = Math.max(
        0,
        Math.min(100, (clickX / rect.width) * 100)
      );

      // Calculate the new time based on the percentage of our effective duration
      const newTime = (percentage / 100) * effectiveDuration;

      console.log(newTime);

      // Use seekToTime which handles the duration mapping
      seekToTime(newTime);
    },
    [isReady, getEffectiveDuration, seekToTime]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      console.log("Mouse down - setting dragging to true");
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
    console.log("Mouse up - setting dragging to false");

    setIsDragging(false);
  }, []);

  const handleWordClick = useCallback(
    (wordStartTime: number) => {
      seekToTime(wordStartTime);
    },
    [seekToTime]
  );

  // Find current word
  const currentWordIndex = groupedWords.findIndex(
    (wordGroup) =>
      currentTime >= wordGroup.start && currentTime <= wordGroup.end
  );

  // Find current segment
  const currentSegmentInfo = useMemo(() => {
    return segmentTimeline.find(
      ({ startTime, endTime }) =>
        currentTime >= startTime && currentTime < endTime
    );
  }, [currentTime, segmentTimeline]);

  // Auto-scroll to highlighted word
  useEffect(() => {
    if (highlightedWordRef.current && currentWordIndex >= 0) {
      setTimeout(() => {
        if (highlightedWordRef.current) {
          highlightedWordRef.current.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
            inline: "nearest",
          });
        }
      }, 50);
    }
  }, [currentWordIndex]);

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (enabledSegments.length === 0) {
    return (
      <div className="bg-white rounded-lg border p-8 text-center">
        <p className="text-gray-500">No sections selected for playback</p>
      </div>
    );
  }

  return (
    <div className="bg-white overflow-hidden">
      <div className="space-y-3">
        {/* Waveform Visualization */}
        <div className="relative">
          {(isLoading || !waveformReady) && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 rounded-lg z-10">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-2" />
                <div className="text-sm text-gray-600">
                  Loading unified audio...
                </div>
              </div>
            </div>
          )}

          <div
            ref={containerRef}
            className={`w-full bg-gray-50 rounded-lg p-4 pb-8 relative ${
              isLoading || !waveformReady ? "opacity-0" : "opacity-100"
            } transition-opacity duration-500`}
            style={{ minHeight: "112px" }}
          />

          <span className="absolute left-4 bottom-2 text-sm font-medium text-gray-800">
            {formatTime(currentTime)}
          </span>
          <span className="absolute right-4 bottom-2 text-sm font-medium text-gray-800">
            {formatTime(totalDuration)}
          </span>

          {/* Progress indicator overlay */}
          {totalDuration > 0 && isReady && waveformReady && !isLoading && (
            <div className="absolute top-4 left-4 right-4 bottom-4 pointer-events-none z-20">
              <div className="relative h-full">
                <div
                  ref={progressContainerRef}
                  className="absolute inset-0 cursor-pointer pointer-events-auto z-10"
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                >
                  <div
                    className="absolute top-0 bottom-4 w-px bg-blue-500 z-30 transition-all duration-100 ease-out"
                    style={{
                      left: `${Math.max(0, Math.min(100, progress))}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between">
          {/* Current section display */}
          {currentSegmentInfo && isPlaying ? (
            <div className="flex items-center gap-2 text-sm text-gray-600 bg-blue-50 rounded-lg p-2">
              <PlayIcon />
              <span className="font-medium">
                {currentSegmentInfo.segment.section_title ||
                  `Section ${currentSegmentInfo.segment.segment_number}`}
              </span>
            </div>
          ) : (
            <div></div>
          )}
          <div className="flex items-center space-x-3">
            <button
              onClick={skipBackward}
              className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors disabled:opacity-50"
              disabled={!isReady || !waveformReady}
              title="Skip back 10 seconds"
            >
              <UndoDot className="w-4 h-4" />
            </button>

            <button
              onClick={togglePlayback}
              className="p-3 rounded-full bg-blue-500 hover:bg-blue-600 text-white transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:transform-none shadow-lg"
              disabled={!isReady || !waveformReady}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>

            <button
              onClick={skipForward}
              className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors disabled:opacity-50"
              disabled={!isReady || !waveformReady}
              title="Skip forward 10 seconds"
            >
              <RedoDot className="w-4 h-4" />
            </button>
          </div>
          <div></div>
        </div>

        {/* Word timestamps */}
        {groupedWords.length > 0 && (
          <div className="bg-gray-50 rounded-lg p-4 leading-relaxed h-32 overflow-y-auto">
            {groupedWords.map((wordGroup, index) => (
              <span
                key={index}
                ref={index === currentWordIndex ? highlightedWordRef : null}
                className={`${
                  index === currentWordIndex
                    ? "bg-blue-200 px-1 rounded"
                    : "text-gray-800 hover:bg-gray-200"
                } transition-all cursor-pointer px-1 py-0.5 rounded inline-block`}
                onClick={() => handleWordClick(wordGroup.start)}
                title={`Jump to ${formatTime(wordGroup.start)} - ${
                  wordGroup.segmentTitle
                }`}
              >
                {wordGroup.text}
                {index < groupedWords.length - 1 && " "}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
