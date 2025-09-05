import React, { useRef } from "react";
import { Button } from "@/components/ui/button";
import { UndoDot, RedoDot } from "lucide-react";
import { SpeedSelector } from "../../documents/components/speed-selector";
import type { AudioPlayerHook } from "../hooks/use-audio-player";

interface AudioPlayerControlsProps {
  audioPlayer: AudioPlayerHook;
}

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

export function AudioPlayerControls({ audioPlayer }: AudioPlayerControlsProps) {
  const {
    isLoading,
    waveformReady,
    isPlaying,
    isReady,
    currentTime,
    totalDuration,
    progress,
    containerRef,
    gain,
    playbackSpeed,
    togglePlayback,
    skipBackward,
    skipForward,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    setPlaybackSpeed,
  } = audioPlayer;
  const progressContainerRef = useRef<HTMLDivElement>(null);

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const scale = 1 + Math.min(gain * 3, 0.6); // up to +30%

  return (
    <div className="bg-white">
      <div className="relative">
        {(isLoading || !waveformReady) && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg z-10">
            <div className="text-center">
              <div className="inline-block animate-spin h-4 w-4 border-b-2 border-blue-500 mb-2" />
            </div>
          </div>
        )}
        <div className="w-full h-14.25 flex items-center">
          <div className="flex items-center gap-2 px-4">
            <Button
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={skipBackward}
            >
              <UndoDot className="w-4 h-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="relative p-0 bg-gray-200 hover:bg-gray-300 rounded-full"
              onClick={() => {
                if (isReady && !isLoading) togglePlayback();
              }}
              // style={{
              //   transform: `scale(${scale})`,
              //   transition: "transform 0.05s linear", // smooth but responsive
              // }}
            >
              <span
                className="absolute inset-0 rounded-full bg-gray-200" //bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600"
                style={{
                  transform: `scale(${scale})`,
                  transition: "transform 0.15s linear",
                }}
              />

              <span className="relative z-10">
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </span>
            </Button>
            <Button
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={skipForward}
            >
              <RedoDot className="w-4 h-4" />
            </Button>
            <SpeedSelector
              currentSpeed={playbackSpeed}
              onSpeedChange={setPlaybackSpeed}
              disabled={!isReady}
              isLoading={false}
            />
          </div>
          <div className="relative w-full h-full">
            {/* WaveForm */}
            <div
              ref={containerRef}
              className={`w-full h-full pt-1 relative translate-y-1 ${
                isLoading || !waveformReady ? "opacity-0" : "opacity-100"
              } transition-opacity duration-500`}
            />
            {/* Progress indicator overlay */}
            {totalDuration > 0 && isReady && waveformReady && !isLoading && (
              <div className="absolute h-full top-0 left-0 right-0 bottom-0 pointer-events-none z-20">
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
                      className={`absolute top-0 bottom-0 right-0 z-30 border-l border-gray-300 cursor-pointer`}
                      style={{
                        width: `${Math.max(0, Math.min(100, 100 - progress))}%`,
                        backgroundColor: "rgba(255,255,255,0.7)",
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="px-4 flex gap-2 text-sm font-medium text-gray-800">
            <span>{formatTime(currentTime)}</span>
            <span>/</span>
            <span>{formatTime(totalDuration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
