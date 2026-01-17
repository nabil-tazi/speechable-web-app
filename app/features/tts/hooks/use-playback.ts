"use client";

import { useCallback, useEffect, useRef } from "react";
import { useTTSContext } from "../context/tts-provider";
import { useGeneration } from "./use-generation";

/**
 * Hook for controlling audio playback.
 *
 * Key design decisions:
 * - Single point of audio creation: playSentenceAtIndex
 * - onended callback handles advancing to next sentence directly
 * - Only ONE effect: handles buffering → playing transition when audio becomes ready
 */
export function usePlayback() {
  const {
    state,
    dispatch,
    audioContextRef,
    currentSourceRef,
    analyserRef,
    currentSentence,
    isPlaybackOn,
    // These refs are shared via context across ALL components using usePlayback()
    // This ensures the guard works correctly even when multiple components call this hook
    isStartingPlaybackRef,
    pendingDecodeRef,
  } = useTTSContext();

  const { generateFrom, modelStatus, ttsMode } = useGeneration();

  // Refs to avoid stale closures in callbacks
  const playbackStatusRef = useRef(state.playback.status);
  const sentencesRef = useRef(state.sentences);
  const audioStateRef = useRef(state.audioState);

  // Keep refs in sync with state
  useEffect(() => {
    playbackStatusRef.current = state.playback.status;
  }, [state.playback.status]);

  useEffect(() => {
    sentencesRef.current = state.sentences;
  }, [state.sentences]);

  useEffect(() => {
    audioStateRef.current = state.audioState;
  }, [state.audioState]);

  /**
   * Get or create AudioContext and AnalyserNode.
   */
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    // Create analyser if needed (for gain visualization)
    if (!analyserRef.current && audioContextRef.current) {
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.connect(audioContextRef.current.destination);
    }
    return audioContextRef.current;
  }, [audioContextRef, analyserRef]);

  /**
   * Stop current audio playback and cancel any pending decode operations.
   */
  const stopCurrentAudio = useCallback(() => {
    // Cancel any pending decode operations
    if (pendingDecodeRef.current) {
      pendingDecodeRef.current.abort();
      pendingDecodeRef.current = null;
    }

    // Stop currently playing audio source
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.onended = null;
        currentSourceRef.current.stop();
      } catch {
        // Ignore errors from already-stopped sources
      }
      currentSourceRef.current = null;
    }
  }, [currentSourceRef]);

  /**
   * Play audio for a specific sentence by index.
   * This is the ONLY function that should create and start audio sources.
   */
  const playSentenceAtIndex = useCallback(
    async (sentenceIndex: number): Promise<boolean> => {
      const sentences = sentencesRef.current;
      const sentence = sentences[sentenceIndex];
      if (!sentence) {
        console.warn("[usePlayback] No sentence at index", sentenceIndex);
        return false;
      }

      const audioState = audioStateRef.current;
      const audio = audioState.get(sentence.id);
      if (!audio || audio.status !== "ready" || !audio.audioBlob) {
        console.log("[usePlayback] Audio not ready for sentence", sentenceIndex);
        return false;
      }

      // CRITICAL: Stop any current/pending audio FIRST, before any async operations
      // This ensures orphaned sources are stopped before we create new ones
      stopCurrentAudio();

      // Create abort controller for this decode operation
      const abortController = new AbortController();
      pendingDecodeRef.current = abortController;

      isStartingPlaybackRef.current = true;
      console.log("[usePlayback] Starting playback for sentence", sentenceIndex);

      const ctx = getAudioContext();

      // Resume context if suspended
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      // Check if aborted during resume
      if (abortController.signal.aborted) {
        console.log("[usePlayback] Playback aborted after resume for sentence", sentenceIndex);
        isStartingPlaybackRef.current = false;
        return false;
      }

      try {
        // Decode audio
        const arrayBuffer = await audio.audioBlob.arrayBuffer();

        // Check if aborted during arrayBuffer conversion
        if (abortController.signal.aborted) {
          console.log("[usePlayback] Playback aborted after arrayBuffer for sentence", sentenceIndex);
          isStartingPlaybackRef.current = false;
          return false;
        }

        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

        // Check if aborted during decoding
        if (abortController.signal.aborted) {
          console.log("[usePlayback] Playback aborted after decode for sentence", sentenceIndex);
          isStartingPlaybackRef.current = false;
          return false;
        }

        // Create source and store reference IMMEDIATELY (before starting)
        const source = ctx.createBufferSource();
        currentSourceRef.current = source; // Store BEFORE start to prevent orphans
        source.buffer = audioBuffer;
        // Connect through analyser for gain visualization
        if (analyserRef.current) {
          source.connect(analyserRef.current);
        } else {
          source.connect(ctx.destination);
        }

        // Handle when audio finishes - advance to next sentence
        // IMPORTANT: We NEVER call playSentenceAtIndex directly from here.
        // Instead, we always dispatch SET_BUFFERING and let the buffering effect
        // handle starting playback. This prevents race conditions between
        // this callback and the effect.
        source.onended = () => {
          console.log("[usePlayback] Audio ended for sentence", sentenceIndex);
          currentSourceRef.current = null;

          // Only advance if we're still in playing state (use ref!)
          if (playbackStatusRef.current === "playing") {
            const nextIndex = sentenceIndex + 1;
            const sentences = sentencesRef.current;

            if (nextIndex >= sentences.length) {
              // End of document - reset to idle
              console.log("[usePlayback] End of document, stopping");
              isStartingPlaybackRef.current = false;
              dispatch({ type: "STOP" });
              return;
            }

            // ALWAYS dispatch SET_BUFFERING for next sentence
            // The buffering effect will handle starting playback when audio is ready
            console.log("[usePlayback] Transitioning to next sentence:", nextIndex);
            isStartingPlaybackRef.current = false;
            dispatch({ type: "SET_BUFFERING", sentenceIndex: nextIndex });

            // Ensure generation is happening if audio isn't ready yet
            const nextSentence = sentences[nextIndex];
            const audioState = audioStateRef.current;
            const nextAudio = audioState.get(nextSentence.id);
            if (!nextAudio || nextAudio.status !== "ready") {
              generateFrom(nextIndex);
            }
          }
        };

        // Final abort check before starting
        if (abortController.signal.aborted) {
          console.log("[usePlayback] Playback aborted before start for sentence", sentenceIndex);
          currentSourceRef.current = null;
          isStartingPlaybackRef.current = false;
          return false;
        }

        // Start playback
        source.start();

        // Clear pending decode ref since we're now playing
        pendingDecodeRef.current = null;

        // Note: Queue extension now happens on generation complete, not playback start
        // This ensures continuous generation regardless of playback timing

        // Update state to playing
        dispatch({ type: "SET_PLAYING", sentenceIndex });
        return true;
      } catch (error) {
        // Check if this was an abort error
        if (abortController.signal.aborted) {
          console.log("[usePlayback] Playback aborted (caught) for sentence", sentenceIndex);
          isStartingPlaybackRef.current = false;
          return false;
        }
        console.error("[usePlayback] Failed to play audio:", error);
        isStartingPlaybackRef.current = false;
        // Skip to next sentence on error
        dispatch({ type: "SENTENCE_COMPLETE" });
        return false;
      }
    },
    [dispatch, getAudioContext, stopCurrentAudio, currentSourceRef, analyserRef, generateFrom]
  );

  /**
   * Play from a specific sentence index.
   */
  const playFromSentence = useCallback(
    (sentenceIndex: number) => {
      console.log("[usePlayback] playFromSentence called:", sentenceIndex);

      // For eco mode, require local model to be ready
      // For cloud modes (standard/expressive), we can proceed without local model
      if (ttsMode === "eco" && modelStatus !== "ready") {
        dispatch({ type: "SET_PENDING_ACTION", action: { type: "play", sentenceIndex } });
        dispatch({ type: "SET_BUFFERING", sentenceIndex });
        return;
      }

      // Stop current playback
      stopCurrentAudio();
      isStartingPlaybackRef.current = false; // Reset the guard

      // Check if the sentence is already generated
      const sentence = state.sentences[sentenceIndex];
      if (!sentence) return;

      const audio = state.audioState.get(sentence.id);
      const isReady = audio?.status === "ready" && audio.audioBlob;

      if (isReady) {
        // Audio ready - play immediately
        playSentenceAtIndex(sentenceIndex);
        // Start generating from next ungenerated sentence
        generateFrom(sentenceIndex + 1);
      } else {
        // Audio not ready - enter buffering and start generation
        dispatch({ type: "SET_BUFFERING", sentenceIndex });
        generateFrom(sentenceIndex);
      }
    },
    [ttsMode, modelStatus, state.sentences, state.audioState, dispatch, stopCurrentAudio, playSentenceAtIndex, generateFrom]
  );

  /**
   * Pause playback.
   */
  const pause = useCallback(() => {
    stopCurrentAudio();
    isStartingPlaybackRef.current = false;
    dispatch({ type: "PAUSE" });
  }, [stopCurrentAudio, dispatch]);

  /**
   * Stop current audio and prepare for regeneration (e.g., speed/voice change).
   * This stops playback and enters buffering mode without changing the current index.
   */
  const stopAndPrepareForRegeneration = useCallback(
    (sentenceIndex: number) => {
      stopCurrentAudio();
      isStartingPlaybackRef.current = false;
      dispatch({ type: "SET_BUFFERING", sentenceIndex });
    },
    [stopCurrentAudio, dispatch]
  );

  /**
   * Resume playback from paused state.
   */
  const resume = useCallback(() => {
    // Restart from current position
    playFromSentence(state.playback.currentIndex);
  }, [state.playback.currentIndex, playFromSentence]);

  /**
   * Stop playback completely.
   */
  const stop = useCallback(() => {
    stopCurrentAudio();
    isStartingPlaybackRef.current = false;
    dispatch({ type: "STOP" });
  }, [stopCurrentAudio, dispatch]);

  /**
   * Toggle play/pause.
   */
  const togglePlayback = useCallback(() => {
    if (isPlaybackOn) {
      pause();
    } else if (state.playback.status === "paused") {
      resume();
    } else {
      playFromSentence(state.playback.currentIndex);
    }
  }, [isPlaybackOn, state.playback.status, state.playback.currentIndex, pause, resume, playFromSentence]);

  /**
   * Skip to previous sentence.
   */
  const skipToPreviousSentence = useCallback(() => {
    const newIndex = Math.max(0, state.playback.currentIndex - 1);
    playFromSentence(newIndex);
  }, [state.playback.currentIndex, playFromSentence]);

  /**
   * Skip to next sentence.
   */
  const skipToNextSentence = useCallback(() => {
    const newIndex = Math.min(state.sentences.length - 1, state.playback.currentIndex + 1);
    playFromSentence(newIndex);
  }, [state.playback.currentIndex, state.sentences.length, playFromSentence]);

  // SINGLE EFFECT: When audio becomes ready and we're buffering, start playing
  useEffect(() => {
    if (state.playback.status !== "buffering") return;
    if (!currentSentence) return;
    if (isStartingPlaybackRef.current) return; // Already starting

    const audio = state.audioState.get(currentSentence.id);
    if (!audio || audio.status !== "ready" || !audio.audioBlob) return;

    // Validate that the audio was generated with the current config
    // This prevents playing stale audio after speed/voice changes
    const currentSpeed = state.voiceConfig.speed;
    const currentVoice = state.voiceConfig.voiceMap[currentSentence.reader_id] || "af_sky";

    if (audio.generatedSpeed !== currentSpeed || audio.generatedVoice !== currentVoice) {
      console.log("[usePlayback] Audio config mismatch, waiting for regeneration:", {
        audioSpeed: audio.generatedSpeed,
        currentSpeed,
        audioVoice: audio.generatedVoice,
        currentVoice,
      });
      return;
    }

    // Wait for next sentence to be ready too (for seamless playback)
    // Skip this check if we're at the last sentence
    const nextSentence = state.sentences[state.playback.currentIndex + 1];
    if (nextSentence) {
      const nextAudio = state.audioState.get(nextSentence.id);
      const nextVoice = state.voiceConfig.voiceMap[nextSentence.reader_id] || "af_sky";

      if (!nextAudio || nextAudio.status !== "ready" || !nextAudio.audioBlob) {
        console.log("[usePlayback] Waiting for next sentence to be ready for seamless playback");
        return;
      }

      // Also validate next sentence's config
      if (nextAudio.generatedSpeed !== currentSpeed || nextAudio.generatedVoice !== nextVoice) {
        console.log("[usePlayback] Next sentence config mismatch, waiting for regeneration");
        return;
      }
    }

    console.log("[usePlayback] Audio ready while buffering, starting playback for:", state.playback.currentIndex);
    playSentenceAtIndex(state.playback.currentIndex);
  }, [state.playback.status, state.audioState, state.voiceConfig, currentSentence, state.sentences, state.playback.currentIndex, playSentenceAtIndex]);

  // Effect: Handle pending action when model becomes ready
  useEffect(() => {
    if (modelStatus !== "ready") return;
    if (!state.pendingAction) return;

    const action = state.pendingAction;
    dispatch({ type: "CLEAR_PENDING_ACTION" });

    if (action.type === "play") {
      playFromSentence(action.sentenceIndex);
    }
  }, [modelStatus, state.pendingAction, dispatch, playFromSentence]);

  // Compute whether we're actually waiting for audio (not just in buffering state)
  // This is true when status is "buffering" AND either:
  // 1. Current sentence's audio isn't ready, OR
  // 2. Next sentence's audio isn't ready (we wait for 2 sentences for seamless playback)
  const currentAudio = currentSentence
    ? state.audioState.get(currentSentence.id)
    : null;
  const nextSentence = state.sentences[state.playback.currentIndex + 1];
  const nextAudio = nextSentence
    ? state.audioState.get(nextSentence.id)
    : null;

  const isCurrentReady = currentAudio?.status === "ready";
  const isNextReady = !nextSentence || nextAudio?.status === "ready";

  const isWaitingForAudio =
    state.playback.status === "buffering" &&
    (!isCurrentReady || !isNextReady);

  return {
    status: state.playback.status,
    currentIndex: state.playback.currentIndex,
    isPlaybackOn,
    isWaitingForAudio,
    playFromSentence,
    pause,
    resume,
    stop,
    togglePlayback,
    stopAndPrepareForRegeneration,
    skipToPreviousSentence,
    skipToNextSentence,
  };
}
