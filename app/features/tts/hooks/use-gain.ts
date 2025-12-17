"use client";

import { useState, useEffect } from "react";
import { useTTSContext } from "../context/tts-provider";

/**
 * Hook that provides real-time audio gain (amplitude) for visualization.
 * Uses the AnalyserNode to calculate RMS (root mean square) of the audio signal.
 * Updates at 60fps via requestAnimationFrame when playback is active.
 */
export function useGain(): number {
  const { analyserRef, state } = useTTSContext();
  const [gain, setGain] = useState(0);

  // Only run when actually playing (not buffering)
  // The analyser is created in playSentenceAtIndex before status becomes "playing"
  const isPlaying = state.playback.status === "playing";

  useEffect(() => {
    if (!isPlaying || !analyserRef.current) {
      setGain(0);
      return;
    }

    const analyser = analyserRef.current;
    const dataArray = new Uint8Array(analyser.fftSize);
    let rafId: number;

    const updateGain = () => {
      analyser.getByteTimeDomainData(dataArray);

      // Calculate RMS (root mean square) for amplitude
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        // Normalize from 0-255 to -1 to 1
        const normalized = (dataArray[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      setGain(rms);

      rafId = requestAnimationFrame(updateGain);
    };

    updateGain();
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, analyserRef]);

  return gain;
}
