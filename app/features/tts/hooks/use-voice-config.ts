"use client";

import { useCallback } from "react";
import { useTTSContext } from "../context/tts-provider";
import { useGeneration } from "./use-generation";
import { usePlayback } from "./use-playback";

/**
 * Hook for managing voice and speed configuration.
 */
export function useVoiceConfig() {
  const { state, dispatch, currentSentence } = useTTSContext();
  const { invalidateAllAndRegenerate, invalidateByReaderAndRegenerate } = useGeneration();
  const { status: playbackStatus, stopAndPrepareForRegeneration } = usePlayback();

  const voiceConfig = state.voiceConfig;

  /**
   * Get the current regeneration starting point based on playback state.
   */
  const getRegenerationStartIndex = useCallback(() => {
    switch (playbackStatus) {
      case "playing":
      case "buffering":
        return state.playback.currentIndex;
      case "paused":
        return state.playback.currentIndex;
      case "idle":
      default:
        return 0;
    }
  }, [playbackStatus, state.playback.currentIndex]);

  /**
   * Set voice for a specific reader.
   * Invalidates audio for that reader. Only regenerates if playback is active.
   */
  const setVoice = useCallback(
    (readerId: string, voiceId: string) => {
      // Update the voice map
      dispatch({ type: "SET_VOICE", readerId, voiceId });

      // Invalidate existing audio for this reader
      dispatch({ type: "INVALIDATE_AUDIO_BY_READER", readerId });

      // Only regenerate if playback is active
      const isPlaybackActive = playbackStatus === "playing" || playbackStatus === "buffering" || playbackStatus === "paused";

      if (isPlaybackActive) {
        // Check if current sentence has this reader_id
        const currentHasReader = currentSentence?.reader_id === readerId;
        const startIndex = getRegenerationStartIndex();

        // If currently playing/buffering and current sentence is affected,
        // stop current audio and enter buffering
        if (
          currentHasReader &&
          (playbackStatus === "playing" || playbackStatus === "buffering")
        ) {
          stopAndPrepareForRegeneration(startIndex);
        }

        // Create new config with updated voice (React state update is async,
        // so we need to pass the new value directly)
        const newConfig = {
          ...voiceConfig,
          voiceMap: { ...voiceConfig.voiceMap, [readerId]: voiceId },
        };

        // Invalidate and regenerate with new config
        invalidateByReaderAndRegenerate(readerId, startIndex, newConfig);
      }
    },
    [
      dispatch,
      currentSentence,
      playbackStatus,
      voiceConfig,
      getRegenerationStartIndex,
      stopAndPrepareForRegeneration,
      invalidateByReaderAndRegenerate,
    ]
  );

  /**
   * Set playback speed.
   * Invalidates all audio. Only regenerates if playback is active.
   */
  const setSpeed = useCallback(
    (speed: number) => {
      // Update the speed
      dispatch({ type: "SET_SPEED", speed });

      // Invalidate all existing audio
      dispatch({ type: "INVALIDATE_ALL_AUDIO" });

      // Only regenerate if playback is active
      const isPlaybackActive = playbackStatus === "playing" || playbackStatus === "buffering" || playbackStatus === "paused";

      if (isPlaybackActive) {
        const startIndex = getRegenerationStartIndex();

        // If playing/buffering, stop current audio and enter buffering
        // This ensures the old audio stops and the playback guard is reset
        if (playbackStatus === "playing" || playbackStatus === "buffering") {
          stopAndPrepareForRegeneration(startIndex);
        }

        // Create new config with updated speed (React state update is async,
        // so we need to pass the new value directly)
        const newConfig = { ...voiceConfig, speed };

        // Invalidate all and regenerate with new config
        invalidateAllAndRegenerate(startIndex, newConfig);
      }
    },
    [dispatch, playbackStatus, voiceConfig, getRegenerationStartIndex, stopAndPrepareForRegeneration, invalidateAllAndRegenerate]
  );

  /**
   * Set the entire voice map at once.
   */
  const setVoiceMap = useCallback(
    (voiceMap: Record<string, string>) => {
      dispatch({ type: "SET_VOICE_MAP", voiceMap });
    },
    [dispatch]
  );

  /**
   * Get the voice for a specific reader.
   */
  const getVoice = useCallback(
    (readerId: string): string => {
      return voiceConfig.voiceMap[readerId] || "af_sky";
    },
    [voiceConfig.voiceMap]
  );

  return {
    voiceMap: voiceConfig.voiceMap,
    speed: voiceConfig.speed,
    setVoice,
    setSpeed,
    setVoiceMap,
    getVoice,
  };
}
