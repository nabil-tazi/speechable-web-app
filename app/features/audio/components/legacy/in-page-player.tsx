import { getAudioUrl } from "@/app/utils/storage";
import React, { useState, useEffect, useRef } from "react";

interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

interface AudioSegment {
  audio_path: string;
  segment_number: number;
  section_title?: string;
  start_page?: number;
  end_page?: number;
  audio_duration?: number;
  word_timestamps?: WordTimestamp[];
}

export function InPagePlayer({ segment }: { segment: AudioSegment }) {
  const [audioUrl, setAudioUrl] = useState<string>();
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [lastSeekTime, setLastSeekTime] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Load audio
  useEffect(() => {
    getAudioUrl(segment.audio_path).then(setAudioUrl);
  }, [segment.audio_path]);

  // Map slider position to audio position proportionally
  const mapSliderToAudio = (sliderTime: number) => {
    if (!audioRef.current || !segment.word_timestamps?.length)
      return sliderTime;

    const timestampDuration = segment.word_timestamps.slice(-1)[0]?.end;
    const audioDuration = audioRef.current.duration;

    if (!timestampDuration || !audioDuration) return sliderTime;

    // Map proportionally: sliderTime/timestampDuration = audioTime/audioDuration
    return (sliderTime / timestampDuration) * audioDuration;
  };

  // Audio events - EXACTLY as original
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => {
      const timestampDuration = segment.word_timestamps?.slice(-1)[0]?.end;
      setDuration(timestampDuration || audio.duration);
    };
    const updatePlaying = () => setIsPlaying(!audio.paused);

    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("loadedmetadata", updateDuration);
    audio.addEventListener("play", updatePlaying);
    audio.addEventListener("pause", updatePlaying);
    audio.addEventListener("ended", updatePlaying);
    audio.addEventListener("seeked", updateTime);

    return () => {
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadedmetadata", updateDuration);
      audio.removeEventListener("play", updatePlaying);
      audio.removeEventListener("pause", updatePlaying);
      audio.removeEventListener("ended", updatePlaying);
      audio.removeEventListener("seeked", updateTime);
    };
  }, [audioUrl, segment.word_timestamps]);

  // Find current word - EXACTLY as original
  const currentWordIndex =
    segment.word_timestamps?.findIndex(
      (word) => currentTime >= word.start && currentTime <= word.end
    ) ?? -1;

  const togglePlay = async () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      // If we recently seeked, map the timestamp position to audio position
      if (lastSeekTime !== null) {
        const audioTime = mapSliderToAudio(lastSeekTime);
        audioRef.current.currentTime = audioTime;
        // Wait for the seek to complete
        await new Promise((resolve) => {
          const handleSeeked = () => {
            audioRef.current?.removeEventListener("seeked", handleSeeked);
            resolve(void 0);
          };
          audioRef.current?.addEventListener("seeked", handleSeeked);
        });
        setLastSeekTime(null);
      }
      audioRef.current.play();
    }
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (audioRef.current) {
      const newTime = Number(e.target.value);
      // Store the timestamp time for later scaling when play is pressed
      setLastSeekTime(newTime);
      // Immediately update UI
      setCurrentTime(newTime);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="border rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h3 className="font-medium">
          {segment.section_title || `Segment ${segment.segment_number}`}
        </h3>
        {segment.start_page && segment.end_page && (
          <span className="text-sm text-gray-500">
            Pages {segment.start_page}-{segment.end_page}
          </span>
        )}
      </div>

      {/* Audio Player */}
      {audioUrl && (
        <div className="space-y-3">
          <audio ref={audioRef} src={audioUrl} />

          {/* Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="w-10 h-10 rounded-full bg-blue-500 text-white flex items-center justify-center hover:bg-blue-600"
            >
              {isPlaying ? "⏸" : "▶"}
            </button>

            <input
              type="range"
              min="0"
              max={duration}
              value={currentTime}
              onChange={seek}
              className="flex-1"
            />

            <span className="text-sm text-gray-600 font-mono">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        </div>
      )}

      {/* Transcript */}
      {segment.word_timestamps && (
        <div className="bg-gray-50 rounded-lg p-4 leading-relaxed">
          {segment.word_timestamps.map((word, index) => (
            <span
              key={index}
              className={`${
                index === currentWordIndex
                  ? "bg-blue-200 text-blue-900 px-1 rounded"
                  : "text-gray-800"
              } transition-colors`}
            >
              {word.word}
              {index < segment.word_timestamps!.length - 1 && " "}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
