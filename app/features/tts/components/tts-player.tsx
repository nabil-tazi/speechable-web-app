"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Volume2, UndoDot, RedoDot, Download } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SpeedSelector } from "@/app/features/documents/components/speed-selector";
import { usePlayback } from "../hooks/use-playback";
import { useSentences } from "../hooks/use-sentences";
import { useVoiceConfig } from "../hooks/use-voice-config";
import { useGeneration } from "../hooks/use-generation";
import { useGain } from "../hooks/use-gain";

// Custom icons to match audio player style
const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const PauseIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);

// Helper function to convert AudioBuffer to WAV blob with proper headers
function audioBufferToWav(buffer: AudioBuffer): Blob {
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

  // WAV header
  writeString(0, "RIFF");
  view.setUint32(4, 36 + length * numberOfChannels * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numberOfChannels * 2, true);
  view.setUint16(32, numberOfChannels * 2, true);
  view.setUint16(34, 16, true); // 16-bit
  writeString(36, "data");
  view.setUint32(40, length * numberOfChannels * 2, true);

  // Write samples
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
}

export function TTSPlayer() {
  const {
    status,
    isPlaybackOn,
    isWaitingForAudio,
    togglePlayback,
    skipToPreviousSentence,
    skipToNextSentence,
    currentIndex,
    playFromSentence,
  } = usePlayback();
  const {
    totalCount,
    sentences,
    audioState,
    allReady,
    readyCount,
    hoveredIndex,
    setHoveredIndex,
  } = useSentences();
  const { speed, setSpeed } = useVoiceConfig();
  const { modelStatus, modelDownloadProgress, isDownloading } = useGeneration();
  const gain = useGain();

  const isModelLoading =
    modelStatus === "loading" || modelStatus === "uninitialized";

  // Scale for animated circle (matches audio player: 1.0 to 1.6 range)
  const scale = 1 + Math.min(gain * 3, 0.6);

  // Show loading spinner when waiting for audio (not model loading)
  const showLoader = isWaitingForAudio;

  // Only show modal when actual downloads are happening (not cached loads)
  const showDownloadModal = isModelLoading && isDownloading;

  // Progress for generation (0 to 1)
  const generationProgress = totalCount > 0 ? readyCount / totalCount : 0;
  const circumference = 2 * Math.PI * 10; // radius = 10

  // Wave visualization - measure container width
  const waveContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const container = waveContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Calculate pixel widths for selectors (proportional)
  const selectorWidths = useMemo(() => {
    if (containerWidth === 0 || sentences.length === 0) return [];
    const totalChars = sentences.reduce((sum, s) => sum + s.text.length, 0);

    // Calculate initial widths
    const widths = sentences.map((sentence) => {
      const proportion = sentence.text.length / totalChars;
      return Math.max(1, Math.floor(proportion * containerWidth));
    });

    // Distribute remaining pixels to largest selectors
    let remaining = containerWidth - widths.reduce((sum, w) => sum + w, 0);
    while (remaining > 0) {
      let maxIdx = 0;
      for (let i = 1; i < widths.length; i++) {
        if (widths[i] > widths[maxIdx]) maxIdx = i;
      }
      widths[maxIdx] += 1;
      remaining -= 1;
    }

    return widths;
  }, [containerWidth, sentences]);

  // Calculate cumulative start positions for each selector
  const selectorStartPositions = useMemo(() => {
    const positions: number[] = [];
    let sum = 0;
    for (const w of selectorWidths) {
      positions.push(sum);
      sum += w;
    }
    return positions;
  }, [selectorWidths]);

  // Generate waveform heights - one bar per pixel, no gaps
  const selectorWaveforms = useMemo(() => {
    if (selectorWidths.length === 0) return [];

    const totalWidth = selectorWidths.reduce((sum, w) => sum + w, 0);

    // Generate bar heights for every pixel position
    const allBarHeights = Array.from(
      { length: totalWidth },
      () => 20 + Math.random() * 80
    );

    // Assign bars to each selector based on its width
    return selectorWidths.map((width, i) => {
      const start = selectorStartPositions[i];
      return allBarHeights.slice(start, start + width);
    });
  }, [selectorWidths, selectorStartPositions]);

  // Download handler - decodes, concatenates, and re-encodes WAV audio
  const handleDownload = useCallback(async () => {
    if (!allReady) return;

    try {
      // Create AudioContext for decoding
      const ctx = new AudioContext();

      // Decode all blobs to AudioBuffers
      const audioBuffers: AudioBuffer[] = [];
      for (const sentence of sentences) {
        const audio = audioState.get(sentence.id);
        if (audio?.audioBlob) {
          const arrayBuffer = await audio.audioBlob.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          audioBuffers.push(audioBuffer);
        }
      }

      if (audioBuffers.length === 0) {
        ctx.close();
        return;
      }

      // Calculate total length and get format from first buffer
      const sampleRate = audioBuffers[0].sampleRate;
      const numberOfChannels = audioBuffers[0].numberOfChannels;
      const totalLength = audioBuffers.reduce(
        (sum, buf) => sum + buf.length,
        0
      );

      // Create concatenated buffer
      const concatenated = ctx.createBuffer(
        numberOfChannels,
        totalLength,
        sampleRate
      );

      // Copy samples from each buffer
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const outputData = concatenated.getChannelData(channel);
        let offset = 0;
        for (const buffer of audioBuffers) {
          const inputData = buffer.getChannelData(channel);
          outputData.set(inputData, offset);
          offset += buffer.length;
        }
      }

      // Convert to WAV blob with proper headers
      const wavBlob = audioBufferToWav(concatenated);

      // Create download URL and trigger download
      const downloadUrl = URL.createObjectURL(wavBlob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = "tts-audio.wav";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up
      URL.revokeObjectURL(downloadUrl);
      ctx.close();
    } catch (error) {
      console.error("[TTSPlayer] Error downloading audio:", error);
    }
  }, [allReady, sentences, audioState]);

  console.log("[TTSPlayer] Modal state:", {
    isModelLoading,
    isDownloading,
    showDownloadModal,
    modelStatus,
  });

  return (
    <>
      {/* Model Download Modal */}
      <Dialog open={showDownloadModal}>
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-md outline-none"
        >
          <DialogHeader className="text-center sm:text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Volume2 className="h-6 w-6 text-primary" />
            </div>
            <DialogTitle>Preparing Text-to-Speech</DialogTitle>
            <DialogDescription className="text-center">
              Loading the voice model for the first time. This only happens once
              — future visits will be instant.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Progress
              value={(modelDownloadProgress ?? 0) * 100}
              className="h-2 [&>div]:transition-none"
            />
            <p className="text-center text-sm text-muted-foreground">
              {modelDownloadProgress !== undefined && modelDownloadProgress > 0
                ? `${Math.round(modelDownloadProgress * 100)}%`
                : "Initializing..."}
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex items-center gap-4 p-0 bg-background rounded-lg">
        {/* Playback Controls */}
        <div className="flex items-center gap-2">
          {/* Skip backward */}
          <Button
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={skipToPreviousSentence}
            disabled={totalCount === 0 || isModelLoading}
          >
            <UndoDot className="w-4 h-4" />
          </Button>

          {/* Play/Pause - circular style with animated gain circle */}
          <Button
            variant="secondary"
            size="icon"
            onClick={togglePlayback}
            disabled={totalCount === 0 || isModelLoading}
            className="relative p-0 bg-gray-200 hover:bg-gray-300 rounded-full"
          >
            <span
              className="absolute inset-0 rounded-full bg-gray-200"
              style={{
                transform: `scale(${scale})`,
                transition: "transform 0.15s linear",
              }}
            />
            <span className="relative z-10">
              {showLoader ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : isPlaybackOn ? (
                <PauseIcon />
              ) : (
                <PlayIcon />
              )}
            </span>
          </Button>

          {/* Skip forward */}
          <Button
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={skipToNextSentence}
            disabled={totalCount === 0 || isModelLoading}
          >
            <RedoDot className="w-4 h-4" />
          </Button>

          {/* Speed Selector */}
          <SpeedSelector currentSpeed={speed} onSpeedChange={setSpeed} />
        </div>

        {/* Wave Visualization with Sentence Selectors */}
        <div ref={waveContainerRef} className="flex-1 h-16 flex items-center">
          {sentences.map((sentence, i) => {
            const width = selectorWidths[i] || 1;
            const heights = selectorWaveforms[i] || [];
            const isCurrent = i === currentIndex && isPlaybackOn;
            const isBuffering = i === currentIndex && status === "buffering";
            const isHovered = hoveredIndex === i;

            return (
              <div
                key={sentence.id}
                onClick={() => playFromSentence(i)}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                style={{ width: `${width}px` }}
                className={`
                  h-16 cursor-pointer transition-colors flex items-center justify-center flex-shrink-0
                  ${isBuffering ? "bg-gray-200 animate-pulse" : ""}
                  ${isCurrent && !isBuffering ? "bg-gray-200" : ""}
                  ${
                    isHovered && !isCurrent && !isBuffering ? "bg-gray-100" : ""
                  }
                `}
              >
                <div className="h-8 flex items-center">
                  {heights.map((height, j) => {
                    const globalIndex = (selectorStartPositions[i] || 0) + j;
                    const isTransparent = globalIndex % 2 === 1;
                    const isReady = audioState.get(sentence.id)?.status === "ready";
                    const barHeight = isReady ? `${height}%` : "2px";
                    return (
                      <div
                        key={j}
                        className={`w-[1px] flex-shrink-0 transition-all duration-500 ease-out ${isTransparent ? "bg-transparent" : "bg-gray-300"}`}
                        style={{ height: barHeight }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Download Button with Progress Ring */}
        <div className="relative h-8 w-8 flex-shrink-0">
          {/* Progress Ring SVG - hidden when complete */}
          {!allReady && (
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 24 24">
              {/* Background circle (light gray track) */}
              <circle
                cx="12"
                cy="12"
                r="10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-gray-200"
              />
              {/* Progress circle (medium gray) */}
              <circle
                cx="12"
                cy="12"
                r="10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                className="text-muted-foreground/50 transition-all duration-300"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - generationProgress)}
              />
            </svg>
          )}

          {/* Download Button with Tooltip */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="absolute inset-0">
                <Button
                  variant="ghost"
                  onClick={handleDownload}
                  disabled={!allReady}
                  className="h-8 w-8 p-0"
                >
                  <Download className="w-4 h-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {allReady
                ? "Grab your audio!"
                : `Cooking up your audio... ${Math.round(
                    generationProgress * 100
                  )}%`}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </>
  );
}
