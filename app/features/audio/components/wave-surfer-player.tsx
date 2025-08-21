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

interface GroupedWord {
  text: string;
  start: number;
  end: number;
}

// Custom icons as React components for better styling
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

const VolumeIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
  </svg>
);

export function WaveSurferPlayer({ segment }: { segment: AudioSegment }) {
  // WaveSurfer states (visualization only)
  const [audioUrl, setAudioUrl] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [waveformReady, setWaveformReady] = useState(false);

  // Custom player states
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [progress, setProgress] = useState(0);
  const [browserDuration, setBrowserDuration] = useState(0);
  const [duration, setDuration] = useState(segment.audio_duration || 0);
  const [volume, setVolume] = useState(0.8);
  const [isDragging, setIsDragging] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [offset, setOffset] = useState(0);

  // Refs
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressContainerRef = useRef<HTMLDivElement>(null);
  const highlightedWordRef = useRef<HTMLSpanElement>(null);

  // Group words with punctuation
  const groupedWords = useMemo(() => {
    if (!segment.word_timestamps) return [];

    const groups: GroupedWord[] = [];
    let currentGroup: GroupedWord | null = null;

    const isPunctuation = (word: string) => {
      return /^[.!?,:;'"()[\]{}""''—–-]+$/.test(word.trim());
    };

    segment.word_timestamps.forEach((wordTimestamp) => {
      const word = wordTimestamp.word;

      if (isPunctuation(word)) {
        // If it's punctuation, add it to the current group if one exists
        if (currentGroup) {
          currentGroup.text += word;
          currentGroup.end = wordTimestamp.end;
        } else {
          // If no current group, create a new one with just punctuation
          currentGroup = {
            text: word,
            start: wordTimestamp.start,
            end: wordTimestamp.end,
          };
        }
      } else {
        // If current group exists, finish it and start a new one
        if (currentGroup) {
          groups.push(currentGroup);
        }

        // Start new group with this word
        currentGroup = {
          text: word,
          start: wordTimestamp.start,
          end: wordTimestamp.end,
        };
      }
    });

    // Don't forget the last group
    if (currentGroup) {
      groups.push(currentGroup);
    }

    return groups;
  }, [segment.word_timestamps]);

  // Helper function to get the effective duration to use for calculations
  const getEffectiveDuration = useCallback(() => {
    return segment.audio_duration && segment.audio_duration > 0
      ? segment.audio_duration
      : browserDuration;
  }, [segment.audio_duration, browserDuration]);

  // Load audio URL
  useEffect(() => {
    setIsLoading(true);
    getAudioUrl(segment.audio_path).then((url) => {
      setAudioUrl(url);
      setIsLoading(false);
    });
  }, [segment.audio_path]);

  // Update duration when segment changes
  useEffect(() => {
    if (segment.audio_duration) {
      setDuration(segment.audio_duration);
    }
  }, [segment.audio_duration]);

  // Initialize WaveSurfer (visualization only)
  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;

    // Clean up previous instance
    // if (wavesurferRef.current) {
    //   try {
    //     wavesurferRef.current.destroy();
    //   } catch (error) {
    //     console.warn("Error destroying previous wavesurfer instance:", error);
    //   }
    // }

    try {
      // Initialize WaveSurfer for visualization only - NO AUDIO HANDLING
      const wavesurfer = WaveSurfer.create({
        container: containerRef.current,
        waveColor: "rgba(148, 163, 184, 0.6)", // slate-400 with opacity
        progressColor: "rgba(148, 163, 184, 0.6)", // Same color - no progress change
        cursorColor: "transparent",
        barWidth: 3,
        barGap: 1,
        barRadius: 2,
        height: 80,
        normalize: true,
        interact: false, // No interaction with WaveSurfer
        backend: "MediaElement",
        mediaControls: false,
        audioRate: 1,
        hideScrollbar: true,
      });

      wavesurferRef.current = wavesurfer;

      // ONLY listen to waveform generation events - NO AUDIO EVENTS
      wavesurfer.on("ready", () => {
        setWaveformReady(true);
        setLoadingProgress(100);
      });

      wavesurfer.on("loading", (progress: number) => {
        setLoadingProgress(progress);
      });

      wavesurfer.on("error", (error: any) => {
        console.error("WaveSurfer error:", error);
      });

      // Load audio ONLY for waveform generation
      wavesurfer.load(audioUrl);
    } catch (error) {
      console.error("Error initializing WaveSurfer:", error);
    }

    // return () => {
    //   if (wavesurferRef.current) {
    //     try {
    //       wavesurferRef.current.destroy();
    //     } catch (error) {
    //       console.warn("Error destroying wavesurfer on cleanup:", error);
    //     }
    //   }
    // };
  }, [audioUrl]);

  // Find current highlighted word group
  const currentWordIndex = groupedWords.findIndex(
    (wordGroup) =>
      currentTime >= wordGroup.start && currentTime <= wordGroup.end
  );

  // Auto-scroll to make highlighted word visible
  useEffect(() => {
    if (highlightedWordRef.current && currentWordIndex >= 0) {
      // Use a small timeout to ensure the DOM is updated
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

  // Custom audio player event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    const updateTime = () => {
      if (!isDragging) {
        const browserTime = audio.currentTime;
        const effectiveDuration = getEffectiveDuration();

        // Use browser time directly for display
        setCurrentTime(browserTime + offset);

        // Calculate progress based on browser time vs effective duration
        if (effectiveDuration > 0) {
          setProgress(((browserTime + offset) / effectiveDuration) * 100);
        }

        // Stop if we've reached the end of our effective duration
        if (effectiveDuration > 0 && browserTime >= effectiveDuration) {
          audio.pause();
          setIsPlaying(false);
          setCurrentTime(effectiveDuration);
          setProgress(100);
        }
      }
    };

    const handleLoadedMetadata = () => {
      setBrowserDuration(audio.duration);
      // Use segment duration if available, otherwise fall back to browser duration
      if (!segment.audio_duration && audio.duration > 0) {
        setDuration(audio.duration);
      }
      setIsReady(true);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      setProgress(0);
    };

    const handleCanPlay = () => {
      setIsReady(true);
    };

    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("canplay", handleCanPlay);

    return () => {
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("canplay", handleCanPlay);
    };
  }, [
    isDragging,
    segment.audio_duration,
    audioUrl,
    getEffectiveDuration,
    offset,
  ]);

  // Update volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Custom player controls
  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isReady) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch((error) => {
        console.error("Error playing audio:", error);
      });
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, isReady]);

  const skipBackward = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isReady) return;

    const effectiveDuration = getEffectiveDuration();
    const newTime = Math.max(0, currentTime - 10);

    // If we have different durations, we need to map this to the browser's timeline
    if (
      segment.audio_duration &&
      browserDuration > 0 &&
      Math.abs(browserDuration - segment.audio_duration) >= 0.1
    ) {
      // Map our desired time to the actual audio file position
      const mappedTime = (newTime / segment.audio_duration) * browserDuration;
      audio.currentTime = Math.max(0, Math.min(mappedTime, browserDuration));
      setOffset(newTime - audio.currentTime);
    } else {
      // Direct mapping when durations match
      audio.currentTime = Math.max(0, Math.min(newTime, effectiveDuration));
      setOffset(0);
    }

    setCurrentTime(newTime);
    setProgress((newTime / effectiveDuration) * 100);
  }, [
    currentTime,
    isReady,
    getEffectiveDuration,
    browserDuration,
    segment.audio_duration,
  ]);

  const skipForward = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isReady) return;

    const effectiveDuration = getEffectiveDuration();
    const newTime = Math.min(effectiveDuration, currentTime + 10);

    // If we have different durations, we need to map this to the browser's timeline
    if (
      segment.audio_duration &&
      browserDuration > 0 &&
      Math.abs(browserDuration - segment.audio_duration) >= 0.1
    ) {
      // Map our desired time to the actual audio file position
      const mappedTime = (newTime / segment.audio_duration) * browserDuration;
      audio.currentTime = Math.max(0, Math.min(mappedTime, browserDuration));
      setOffset(newTime - audio.currentTime);
    } else {
      // Direct mapping when durations match
      audio.currentTime = Math.max(0, Math.min(newTime, effectiveDuration));
      setOffset(0);
    }

    setCurrentTime(newTime);
    setProgress((newTime / effectiveDuration) * 100);
  }, [
    currentTime,
    isReady,
    getEffectiveDuration,
    browserDuration,
    segment.audio_duration,
  ]);

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

      // If we have different durations, we need to map this to the browser's timeline
      if (
        segment.audio_duration &&
        browserDuration > 0 &&
        Math.abs(browserDuration - segment.audio_duration) >= 0.1
      ) {
        // Map our desired time to the actual audio file position
        const mappedTime = (newTime / segment.audio_duration) * browserDuration;
        audio.currentTime = Math.max(0, Math.min(mappedTime, browserDuration));
      } else {
        // Direct mapping when durations match
        audio.currentTime = Math.max(0, Math.min(newTime, effectiveDuration));
      }

      setOffset(newTime - audio.currentTime);
      setCurrentTime(newTime);
      setProgress(percentage);
    },
    [isReady, getEffectiveDuration, browserDuration, segment.audio_duration]
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

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVolume = Number(e.target.value);
      setVolume(newVolume);
    },
    []
  );

  const handleWordClick = useCallback(
    (wordStartTime: number) => {
      const audio = audioRef.current;
      const effectiveDuration = getEffectiveDuration();

      if (!audio || !isReady || effectiveDuration === 0) return;

      // Calculate the new time, ensuring it's within bounds
      const newTime = Math.max(0, Math.min(wordStartTime, effectiveDuration));

      // If we have different durations, we need to map this to the browser's timeline
      if (
        segment.audio_duration &&
        browserDuration > 0 &&
        Math.abs(browserDuration - segment.audio_duration) >= 0.1
      ) {
        // Map our desired time to the actual audio file position
        const mappedTime = (newTime / segment.audio_duration) * browserDuration;
        audio.currentTime = Math.max(0, Math.min(mappedTime, browserDuration));
        setOffset(newTime - audio.currentTime);
      } else {
        // Direct mapping when durations match
        audio.currentTime = Math.max(0, Math.min(newTime, effectiveDuration));
        setOffset(0);
      }

      setCurrentTime(newTime);
      setProgress((newTime / effectiveDuration) * 100);
    },
    [isReady, getEffectiveDuration, browserDuration, segment.audio_duration]
  );

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const effectiveDuration = getEffectiveDuration();

  return (
    <div className="bg-white overflow-hidden">
      {/* Hidden audio element for actual playback */}
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      {/* Main Player */}
      <div className="space-y-3">
        {/* Waveform Visualization with Custom Player Overlay */}
        <div className="relative">
          {(isLoading || !waveformReady) && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 rounded-lg z-10">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-2" />
                <div className="text-sm text-gray-600">loading...</div>
              </div>
            </div>
          )}

          {/* WaveSurfer Container - Visualization Only */}
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
            {formatTime(effectiveDuration)}
          </span>

          {/* Enhanced Custom Player Overlay */}
          {effectiveDuration > 0 && isReady && waveformReady && (
            <div className="absolute top-4 left-4 right-4 bottom-4 pointer-events-none z-20">
              <div className="relative h-full">
                {/* Clickable area for seeking */}
                <div
                  ref={progressContainerRef}
                  className="absolute inset-0 cursor-pointer pointer-events-auto z-10"
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                >
                  {/* Progress indicator with enhanced styling */}
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
        <div className="flex items-center justify-center">
          {/* Left controls */}
          {/* <div className="flex items-center space-x-2">
            <span className="text-lg font-medium text-gray-800">
              {formatTime(currentTime)}
            </span>
            <span className="text-gray-400">/</span>
            <span className="text-lg text-gray-600">
              {formatTime(effectiveDuration)}
            </span>
          </div> */}

          {/* Center - Time display */}

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

          {/* Right controls - Volume */}
          {/* <div className="flex items-center space-x-3">
            <VolumeIcon />
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={handleVolumeChange}
              className="w-20 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
            />
            <span className="text-xs text-gray-500 font-mono w-8">
              {Math.round(volume * 100)}%
            </span>
          </div> */}
        </div>

        {/* Word timestamps with grouped punctuation */}
        {groupedWords.length > 0 && (
          <div className="bg-gray-50 rounded-lg p-4 leading-relaxed h-32 overflow-y-auto">
            {groupedWords.map((wordGroup, index) => (
              <span
                key={index}
                ref={index === currentWordIndex ? highlightedWordRef : null}
                className={`${
                  index === currentWordIndex
                    ? "bg-blue-200  px-1 rounded"
                    : "text-gray-800 hover:bg-gray-200 "
                } transition-all cursor-pointer px-1 py-0.5 rounded inline-block`}
                onClick={() => handleWordClick(wordGroup.start)}
                title={`Jump to ${formatTime(wordGroup.start)}`}
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
