import { getAudioUrl } from "@/app/utils/storage";
import React, { useState, useRef, useEffect, useCallback } from "react";

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

interface CustomAudioPlayerProps {
  segment: AudioSegment;
  className?: string;
}

// Custom icons as React components
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

export function CustomAudioPlayer({
  segment,
  className = "",
}: CustomAudioPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string>();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [progress, setProgress] = useState(0);
  const [browserDuration, setBrowserDuration] = useState(0);
  const [duration, setDuration] = useState(segment.audio_duration || 0);
  const [volume, setVolume] = useState(0.8);
  const [isDragging, setIsDragging] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [offset, setOffset] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const progressContainerRef = useRef<HTMLDivElement>(null);

  // Helper function to get the effective duration to use for calculations
  const getEffectiveDuration = useCallback(() => {
    // Always use the known duration for UI display if available
    return segment.audio_duration && segment.audio_duration > 0
      ? segment.audio_duration
      : browserDuration;
  }, [segment.audio_duration, browserDuration]);

  // Helper function to convert UI position (0-1) to actual audio time
  const positionToAudioTime = useCallback(
    (position: number) => {
      // Position is 0-1, representing position in our known duration
      // Map this to the actual audio file duration
      if (!browserDuration || browserDuration <= 0) return 0;
      return position * browserDuration;
    },
    [browserDuration]
  );

  // Helper function to convert actual audio time to UI position (0-1)
  const audioTimeToPosition = useCallback(
    (audioTime: number) => {
      // Convert browser audio time to position in our timeline
      if (!browserDuration || browserDuration <= 0) return 0;
      return audioTime / browserDuration;
    },
    [browserDuration]
  );

  // Load audio URL
  useEffect(() => {
    setIsLoading(true);
    // If you have getAudioUrl function, use it here
    getAudioUrl(segment.audio_path).then((url) => {
      setAudioUrl(url);
      setIsLoading(false);
    });

    // For now, use the path directly
    setAudioUrl(segment.audio_path);
    setIsLoading(false);
  }, [segment.audio_path]);

  // Update duration when segment changes
  useEffect(() => {
    if (segment.audio_duration) {
      setDuration(segment.audio_duration);
    }
  }, [segment.audio_duration]);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    const updateTime = () => {
      if (!isDragging) {
        const browserTime = audio.currentTime;
        const effectiveDuration = getEffectiveDuration();

        console.log("setting time");
        console.log(browserTime);

        // Use browser time directly for display - no scaling!
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
  }, [isDragging, segment.audio_duration, audioUrl, getEffectiveDuration]);

  // Update volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Playback controls
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

    // Calculate new time based on ACTUAL audio position, not display time
    const currentAudioTime = audio.currentTime;
    const newAudioTime = Math.max(0, currentAudioTime - 10);

    // Set the new audio position
    audio.currentTime = Math.min(newAudioTime, browserDuration);

    // Calculate what the UI should display for this audio position
    let newDisplayTime;
    if (
      segment.audio_duration &&
      browserDuration > 0 &&
      Math.abs(browserDuration - segment.audio_duration) >= 0.1
    ) {
      // Map audio time back to UI time
      newDisplayTime =
        (audio.currentTime / browserDuration) * segment.audio_duration;
    } else {
      newDisplayTime = audio.currentTime;
    }

    // Set offset to maintain the relationship
    setOffset(newDisplayTime - audio.currentTime);

    setCurrentTime(newDisplayTime);
    setProgress((newDisplayTime / effectiveDuration) * 100);
  }, [isReady, getEffectiveDuration, browserDuration, segment.audio_duration]);

  const skipForward = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isReady) return;

    const newTime = currentTime + 10;

    if (
      segment.audio_duration &&
      browserDuration > 0 &&
      Math.abs(browserDuration - segment.audio_duration) >= 0.1
    ) {
      // Map audio time back to UI time
      const mappedTime = (newTime / segment.audio_duration) * browserDuration;
      audio.currentTime = Math.max(0, Math.min(mappedTime, browserDuration));
    } else {
      audio.currentTime = Math.max(0, Math.min(newTime, effectiveDuration));
    }

    console.log("SETTING OFFSET: ", newTime - audio.currentTime);

    setOffset(newTime - audio.currentTime);
    setCurrentTime(newTime);

    // const effectiveDuration = getEffectiveDuration();

    // const scaled10s

    // // Calculate new time based on ACTUAL audio position, not display time
    // const currentAudioTime = audio.currentTime;
    // const newAudioTime = Math.min(browserDuration, currentAudioTime + 10);

    // console.log("OFFSET", offset);
    // console.log("currentAudioTime", currentAudioTime);
    // console.log("newAudioTime +10s", newAudioTime);

    // // Set the new audio position
    // audio.currentTime = Math.min(newAudioTime, browserDuration);

    // // Calculate what the UI should display for this audio position
    // let newDisplayTime;
    // if (
    //   segment.audio_duration &&
    //   browserDuration > 0 &&
    //   Math.abs(browserDuration - segment.audio_duration) >= 0.1
    // ) {
    //   // Map audio time back to UI time
    //   newDisplayTime =
    //     (audio.currentTime / browserDuration) * segment.audio_duration;
    // } else {
    //   newDisplayTime = audio.currentTime;
    // }

    // Set offset to maintain the relationship
    // setOffset(newDisplayTime - audio.currentTime);

    // setCurrentTime(newAudioTime);
    // setProgress((newAudioTime / effectiveDuration) * 100);
  }, [isReady, getEffectiveDuration, browserDuration, segment.audio_duration]);

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

      console.log("newTime", newTime);

      // If we have different durations, we need to map this to the browser's timeline
      if (
        segment.audio_duration &&
        browserDuration > 0 &&
        Math.abs(browserDuration - segment.audio_duration) >= 0.1
      ) {
        // Map our desired time to the actual audio file position
        const mappedTime = (newTime / segment.audio_duration) * browserDuration;
        audio.currentTime = Math.max(0, Math.min(mappedTime, browserDuration));
        // audio.currentTime = Math.max(0, Math.min(newTime, effectiveDuration));

        console.log(audio.currentTime);
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

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const effectiveDuration = getEffectiveDuration();

  return (
    <div
      className={`bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden ${className}`}
    >
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      {/* Header */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-gray-200">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">
              {segment.section_title ||
                `Audio Segment ${segment.segment_number}`}
            </h3>
            {segment.start_page && segment.end_page && (
              <p className="text-sm text-gray-600 mt-1">
                Pages {segment.start_page}-{segment.end_page}
              </p>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isReady ? "bg-green-400 animate-pulse" : "bg-yellow-400"
              }`}
            />
            <span className="text-xs text-gray-500 font-medium">
              {isReady ? "READY" : isLoading ? "LOADING" : "WAITING"}
            </span>
          </div>
        </div>
      </div>

      {/* Main Player */}
      <div className="p-6 space-y-6">
        {/* Progress Container */}
        <div className="relative">
          <div className="flex justify-between text-xs text-gray-500 mb-2">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(effectiveDuration)}</span>
          </div>

          <div
            ref={progressContainerRef}
            className="w-full h-3 bg-gray-200 rounded-full cursor-pointer relative"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-100"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
            <div
              className="absolute top-1/2 w-4 h-4 bg-blue-500 rounded-full transform -translate-y-1/2 -translate-x-1/2 cursor-pointer shadow-md"
              style={{ left: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between">
          {/* Left controls */}
          <div className="flex items-center space-x-3">
            <button
              onClick={skipBackward}
              className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors disabled:opacity-50"
              disabled={!isReady}
              title="Skip back 10 seconds"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
              </svg>
            </button>

            <button
              onClick={togglePlayback}
              className="p-3 rounded-full bg-blue-500 hover:bg-blue-600 text-white transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:transform-none shadow-lg"
              disabled={!isReady}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>

            <button
              onClick={skipForward}
              className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors disabled:opacity-50"
              disabled={!isReady}
              title="Skip forward 10 seconds"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z" />
              </svg>
            </button>
          </div>

          {/* Center - Time display */}
          <div className="flex items-center space-x-2">
            <span className="text-lg font-medium text-gray-800">
              {formatTime(currentTime)}
            </span>
            <span className="text-gray-400">/</span>
            <span className="text-lg text-gray-600">
              {formatTime(effectiveDuration)}
            </span>
          </div>

          {/* Right controls - Volume */}
          <div className="flex items-center space-x-3">
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
          </div>
        </div>

        {/* Debug info */}
        <div className="text-xs text-gray-500 space-y-1 bg-gray-50 p-3 rounded-lg">
          <div className="flex justify-between">
            <span>Known Duration:</span>
            <span className="font-mono">
              {segment.audio_duration
                ? formatTime(segment.audio_duration)
                : "N/A"}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Browser Duration:</span>
            <span className="font-mono">
              {browserDuration ? formatTime(browserDuration) : "Loading..."}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Effective Duration:</span>
            <span className="font-mono">{formatTime(effectiveDuration)}</span>
          </div>
          <div className="flex justify-between">
            <span>Duration Match:</span>
            <span
              className={`font-medium ${
                segment.audio_duration &&
                browserDuration &&
                Math.abs(browserDuration - segment.audio_duration) < 0.1
                  ? "text-green-600"
                  : "text-amber-600"
              }`}
            >
              {segment.audio_duration && browserDuration
                ? Math.abs(browserDuration - segment.audio_duration) < 0.1
                  ? "✓ Matched"
                  : "⚠ Scaling Active"
                : "- Pending"}
            </span>
          </div>
        </div>
      </div>

      {/* Custom CSS for slider */}
      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          height: 16px;
          width: 16px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        .slider::-moz-range-thumb {
          height: 16px;
          width: 16px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
      `}</style>
    </div>
  );
}
