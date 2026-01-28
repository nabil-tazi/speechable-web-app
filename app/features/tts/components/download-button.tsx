"use client";

import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSentences } from "../hooks/use-sentences";

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

export function DownloadButton() {
  const { sentences, audioState, allReady } = useSentences();

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
      console.error("[DownloadButton] Error downloading audio:", error);
    }
  }, [allReady, sentences, audioState]);

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            onClick={handleDownload}
            disabled={!allReady}
            className="h-8 w-8 p-0"
          >
            <Download className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {allReady
            ? "Download audio"
            : "Audio not ready yet"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
