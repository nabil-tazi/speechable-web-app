import { getAudioUrl } from "@/app/utils/storage";
import React, { useState, useEffect, useRef } from "react";
import { WordTimestamp, AudioSegment } from "@/app/features/audio/types";

export function InPagePlayerDrifting({ segment }: { segment: AudioSegment }) {
  const [audioUrl, setAudioUrl] = useState<string>();
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Load audio
  useEffect(() => {
    getAudioUrl(segment.audio_path).then(setAudioUrl);
  }, [segment.audio_path]);

  // Map audio position back to slider position for display
  const mapAudioToSlider = (audioTime: number) => {
    if (!audioRef.current || !segment.word_timestamps?.length) return audioTime;

    const timestampDuration = segment.word_timestamps.slice(-1)[0]?.end;
    const audioDuration = audioRef.current.duration;

    if (!timestampDuration || !audioDuration) return audioTime;

    // Reverse mapping: audioTime/audioDuration = sliderTime/timestampDuration
    return (audioTime / audioDuration) * timestampDuration;
  };

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

  // Audio events - now properly mapping audio time to slider time
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => {
      // Only update if we're not currently seeking
      if (!isSeeking) {
        const sliderTime = mapAudioToSlider(audio.currentTime);
        setCurrentTime(sliderTime);
      }
    };

    const updateDuration = () => {
      const timestampDuration = segment.word_timestamps?.slice(-1)[0]?.end;
      setDuration(timestampDuration || audio.duration);
    };

    const updatePlaying = () => setIsPlaying(!audio.paused);

    const handleSeeked = () => {
      // After seeking is complete, resume normal time updates
      setIsSeeking(false);
      const sliderTime = mapAudioToSlider(audio.currentTime);
      setCurrentTime(sliderTime);
    };

    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("loadedmetadata", updateDuration);
    audio.addEventListener("play", updatePlaying);
    audio.addEventListener("pause", updatePlaying);
    audio.addEventListener("ended", updatePlaying);
    audio.addEventListener("seeked", handleSeeked);

    return () => {
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadedmetadata", updateDuration);
      audio.removeEventListener("play", updatePlaying);
      audio.removeEventListener("pause", updatePlaying);
      audio.removeEventListener("ended", updatePlaying);
      audio.removeEventListener("seeked", handleSeeked);
    };
  }, [audioUrl, segment.word_timestamps, isSeeking]);

  // Find current word using slider time (not audio time)
  const currentWordIndex =
    segment.word_timestamps?.findIndex(
      (word) => currentTime >= word.start && currentTime <= word.end
    ) ?? -1;

  const togglePlay = async () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      try {
        await audioRef.current.play();
      } catch (error) {
        console.error("Failed to play audio:", error);
      }
    }
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (audioRef.current) {
      const sliderTime = Number(e.target.value);

      // Set seeking flag to prevent time updates during seek
      setIsSeeking(true);

      // Update visual state immediately
      setCurrentTime(sliderTime);

      // Map and set the audio position
      const audioTime = mapSliderToAudio(sliderTime);
      audioRef.current.currentTime = audioTime;
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
