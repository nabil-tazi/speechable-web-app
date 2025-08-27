import React, { useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { UndoDot, RedoDot } from "lucide-react";

interface AudioPlayerControlsProps {
  isLoading: boolean;
  waveformReady: boolean;
  isPlaying: boolean;
  isReady: boolean;
  currentTime: number;
  totalDuration: number;
  progress: number;
  isDragging: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onTogglePlayback: () => void;
  onSkipBackward: () => void;
  onSkipForward: () => void;
  onProgressClick: (e: React.MouseEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
  onDrawSegmentSeparators: () => void;
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

export function AudioPlayerControls({
  isLoading,
  waveformReady,
  isPlaying,
  isReady,
  currentTime,
  totalDuration,
  progress,
  isDragging,
  containerRef,
  onTogglePlayback,
  onSkipBackward,
  onSkipForward,
  onProgressClick,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onDrawSegmentSeparators,
}: AudioPlayerControlsProps) {
  const progressContainerRef = useRef<HTMLDivElement>(null);

  // Call drawSegmentSeparators when waveform is ready
  React.useEffect(() => {
    if (waveformReady) {
      onDrawSegmentSeparators();
    }
  }, [waveformReady, onDrawSegmentSeparators]);

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

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
              onClick={onSkipBackward}
            >
              <UndoDot className="w-4 h-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="p-0 hover:bg-gray-200"
              onClick={onTogglePlayback}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </Button>
            <Button
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={onSkipForward}
            >
              <RedoDot className="w-4 h-4" />
            </Button>
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
                    onMouseDown={onMouseDown}
                    onMouseMove={onMouseMove}
                    onMouseUp={onMouseUp}
                    onMouseLeave={onMouseUp}
                  >
                    <div
                      className="absolute top-0 bottom-0 w-px bg-gray-400 z-30 transition-all duration-100 ease-out"
                      style={{
                        left: `${Math.max(0, Math.min(100, progress))}%`,
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
