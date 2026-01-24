"use client";

import { useCallback, useEffect, useRef } from "react";
import { useTTSContext } from "../context/tts-provider";
import { useCredits } from "@/app/features/users/context";
import type { WorkerIncomingMessage, VoiceConfig, QueueItem } from "../types";
import type { TTSMode, VoiceQuality } from "../context/tts-reducer";

interface CloudGenerationResult {
  audio: Blob;
  duration: number;
  creditsUsed?: number;
  creditsRemaining?: number;
}

/**
 * Generate audio via cloud API (DeepInfra).
 */
async function generateViaCloud(
  item: QueueItem,
  mode: "standard" | "expressive",
  chatterboxParams?: { cfg: number; exaggeration: number }
): Promise<CloudGenerationResult> {
  const endpoint =
    mode === "standard" ? "/api/deepinfra-kokoro" : "/api/deepinfra-chatterbox";

  console.log("[generateViaCloud] Starting request to", endpoint, "for text:", item.text.substring(0, 50));

  // Add timeout to prevent infinite hanging
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  // Build request body
  const body: Record<string, unknown> = {
    input: item.text,
    voice: item.voice,
    response_format: "mp3",
  };

  // Add chatterbox-specific params for expressive mode
  if (mode === "expressive" && chatterboxParams) {
    body.cfg = chatterboxParams.cfg;
    body.exaggeration = chatterboxParams.exaggeration;
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (fetchError) {
    clearTimeout(timeoutId);
    if (fetchError instanceof Error && fetchError.name === "AbortError") {
      throw new Error("Request timed out after 30 seconds");
    }
    throw fetchError;
  }

  clearTimeout(timeoutId);

  console.log("[generateViaCloud] Response status:", response.status);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    console.error("[generateViaCloud] API error:", error);
    throw new Error(error.error || `API error: ${response.status}`);
  }

  // Extract credit info from headers
  const creditsUsed = parseFloat(response.headers.get("X-Credits-Used") || "0");
  const creditsRemaining = parseFloat(response.headers.get("X-Credits-Remaining") || "0");

  const audioBlob = await response.blob();
  console.log("[generateViaCloud] Received audio blob:", audioBlob.size, "bytes, credits used:", creditsUsed);

  // Estimate duration from blob size (rough estimate for mp3)
  // More accurate would be to decode and check, but this is faster
  const estimatedDuration = audioBlob.size / (16000 * 2); // Very rough estimate

  return {
    audio: audioBlob,
    duration: estimatedDuration,
    creditsUsed: creditsUsed > 0 ? creditsUsed : undefined,
    creditsRemaining: creditsRemaining > 0 ? creditsRemaining : undefined,
  };
}

/**
 * Hook for managing audio generation via the Web Worker.
 */
export function useGeneration() {
  const { state, dispatch, workerRef, generationQueueRef } = useTTSContext();
  const { updateCredits } = useCredits();

  // Track the currently processing sentence and its epoch
  const processingIdRef = useRef<string | null>(null);
  const processingEpochRef = useRef<number>(0);

  // Keep voiceConfig in a ref to avoid stale closures in callbacks (e.g., onended)
  const voiceConfigRef = useRef(state.voiceConfig);
  voiceConfigRef.current = state.voiceConfig;

  // Keep ttsMode in a ref for use in callbacks
  const ttsModeRef = useRef(state.ttsMode);
  ttsModeRef.current = state.ttsMode;

  /**
   * Process the next item in the queue.
   * Respects the lookahead limit - won't generate more than +1 ahead of playback.
   * Routes to local worker (eco) or cloud API (standard/expressive) based on ttsMode.
   */
  const processNext = useCallback(() => {
    // Don't start if already processing
    if (processingIdRef.current !== null) {
      console.log("[useGeneration] Already processing:", processingIdRef.current);
      return;
    }

    // For eco mode, require model to be ready; for cloud modes, we can proceed
    const ttsMode = state.ttsMode;
    if (ttsMode === "eco" && state.modelStatus !== "ready") {
      console.log("[useGeneration] Model not ready (eco mode)");
      return;
    }

    const queue = generationQueueRef.current;
    const next = queue.getNext();
    if (!next) {
      console.log("[useGeneration] Queue empty");
      return;
    }

    // Check if this sentence is too far ahead of playback
    // Only allow generating current playback position + 2 lookahead
    const currentPlaybackIndex = state.playback.currentIndex;
    if (next.globalIndex > currentPlaybackIndex + 2) {
      console.log(
        "[useGeneration] Delaying generation - sentence",
        next.globalIndex,
        "is ahead of playback",
        currentPlaybackIndex
      );
      queue.cancelProcessing();
      return;
    }

    console.log("[useGeneration] Processing next:", next.sentenceId, "mode:", ttsMode);
    processingIdRef.current = next.sentenceId;
    processingEpochRef.current = queue.getEpoch(); // Track epoch for this generation
    dispatch({ type: "GENERATION_START", sentenceId: next.sentenceId });

    if (ttsMode === "eco") {
      // Use local Kokoro worker
      const message: WorkerIncomingMessage = {
        type: "generate",
        request: {
          sentenceId: next.sentenceId,
          text: next.text,
          voice: next.voice,
          speed: next.speed,
        },
      };
      workerRef.current?.postMessage(message);
    } else {
      // Use cloud API
      const chatterboxParams = {
        cfg: state.chatterboxCfg,
        exaggeration: state.chatterboxExaggeration,
      };
      generateViaCloud(next, ttsMode as "standard" | "expressive", chatterboxParams)
        .then(({ audio, duration, creditsRemaining }) => {
          console.log("[useGeneration] Cloud generation complete for:", next.sentenceId);
          dispatch({
            type: "GENERATION_COMPLETE",
            sentenceId: next.sentenceId,
            audio,
            duration,
            speed: next.speed,
            voice: next.voice,
          });

          // Update credits display if we got credit info back
          if (typeof creditsRemaining === "number") {
            updateCredits(creditsRemaining);
          }
        })
        .catch((error) => {
          console.error("[useGeneration] Cloud generation error:", error);
          dispatch({
            type: "GENERATION_ERROR",
            sentenceId: next.sentenceId,
            error: error.message,
          });
        });
    }
  }, [state.modelStatus, state.ttsMode, state.playback.currentIndex, state.chatterboxCfg, state.chatterboxExaggeration, dispatch, workerRef, generationQueueRef]);

  /**
   * Start generation from a specific sentence index.
   * Uses voiceConfigRef to ensure we always use the latest config, even in stale callbacks.
   */
  const generateFrom = useCallback(
    (fromIndex: number) => {
      console.log("[useGeneration] generateFrom:", fromIndex);
      const queue = generationQueueRef.current;
      // Use ref to get latest voiceConfig (avoids stale closure in onended callbacks)
      // Lookahead of 2 ensures next sentence is ready when current finishes
      queue.buildQueue(state.sentences, fromIndex, voiceConfigRef.current, 2);
      processNext();
    },
    [state.sentences, generationQueueRef, processNext]
  );

  /**
   * Invalidate all audio and regenerate from a specific index.
   * @param fromIndex - The index to start regeneration from
   * @param voiceConfigOverride - Optional voice config to use instead of state (for async state update handling)
   */
  const invalidateAllAndRegenerate = useCallback(
    (fromIndex: number, voiceConfigOverride?: VoiceConfig) => {
      const queue = generationQueueRef.current;
      queue.invalidateAll();
      dispatch({ type: "INVALIDATE_ALL_AUDIO" });
      // Reset processing state since we're starting fresh
      processingIdRef.current = null;
      // Use override if provided (handles async state update timing)
      const configToUse = voiceConfigOverride ?? state.voiceConfig;
      queue.buildQueue(state.sentences, fromIndex, configToUse, 2);
      processNext();
    },
    [state.sentences, state.voiceConfig, dispatch, generationQueueRef, processNext]
  );

  /**
   * Invalidate audio for a specific reader and regenerate.
   * @param readerId - The reader ID whose audio should be invalidated
   * @param fromIndex - The index to start regeneration from
   * @param voiceConfigOverride - Optional voice config to use instead of state (for async state update handling)
   */
  const invalidateByReaderAndRegenerate = useCallback(
    (readerId: string, fromIndex: number, voiceConfigOverride?: VoiceConfig) => {
      const queue = generationQueueRef.current;
      queue.invalidateByReaderId(state.sentences, readerId);
      dispatch({ type: "INVALIDATE_AUDIO_BY_READER", readerId });
      // Reset processing if the current one was for this reader
      processingIdRef.current = null;
      // Use override if provided (handles async state update timing)
      const configToUse = voiceConfigOverride ?? state.voiceConfig;
      queue.buildQueue(state.sentences, fromIndex, configToUse, 2);
      processNext();
    },
    [state.sentences, state.voiceConfig, dispatch, generationQueueRef, processNext]
  );

  /**
   * Extend the queue with the next sentence(s) and process.
   * Used for lazy loading - call this when a sentence starts playing
   * to maintain the lookahead without rebuilding the entire queue.
   *
   * @param afterIndex - The index of the sentence that just started playing
   */
  const extendQueueAndProcess = useCallback(
    (afterIndex: number) => {
      const queue = generationQueueRef.current;
      const wasExtended = queue.extendQueue(
        state.sentences,
        afterIndex,
        voiceConfigRef.current
      );
      if (wasExtended) {
        console.log("[useGeneration] Extended queue after sentence", afterIndex);
        processNext();
      }
    },
    [state.sentences, generationQueueRef, processNext]
  );

  /**
   * Clear the generation queue.
   */
  const clearQueue = useCallback(() => {
    generationQueueRef.current.clear();
    processingIdRef.current = null;
    workerRef.current?.postMessage({ type: "cancelAll" } as WorkerIncomingMessage);
  }, [generationQueueRef, workerRef]);

  /**
   * Set the TTS generation mode.
   */
  const setTTSMode = useCallback(
    (mode: TTSMode) => {
      dispatch({ type: "SET_TTS_MODE", mode });
    },
    [dispatch]
  );

  /**
   * Set Chatterbox cfg parameter.
   */
  const setChatterboxCfg = useCallback(
    (cfg: number) => {
      dispatch({ type: "SET_CHATTERBOX_CFG", cfg });
    },
    [dispatch]
  );

  /**
   * Set Chatterbox exaggeration parameter.
   */
  const setChatterboxExaggeration = useCallback(
    (exaggeration: number) => {
      dispatch({ type: "SET_CHATTERBOX_EXAGGERATION", exaggeration });
    },
    [dispatch]
  );

  /**
   * Set eco mode disabled state.
   */
  const setEcoDisabled = useCallback(
    (disabled: boolean) => {
      dispatch({ type: "SET_ECO_DISABLED", disabled });
    },
    [dispatch]
  );

  /**
   * Set voice quality preference.
   */
  const setVoiceQuality = useCallback(
    (quality: VoiceQuality) => {
      dispatch({ type: "SET_VOICE_QUALITY", quality });
    },
    [dispatch]
  );

  // Effect: When the currently processing sentence completes, process next
  useEffect(() => {
    const currentlyProcessing = processingIdRef.current;
    if (!currentlyProcessing) return;

    const audio = state.audioState.get(currentlyProcessing);
    if (!audio) return;

    // Check if the currently processing sentence has completed
    if (audio.status === "ready" || audio.status === "error") {
      console.log("[useGeneration] Generation complete for:", currentlyProcessing, "status:", audio.status);

      // Mark complete in queue, passing the epoch to ignore stale results
      const sentence = state.sentences.find((s) => s.id === currentlyProcessing);
      if (sentence) {
        const wasAccepted = generationQueueRef.current.completeProcessing(
          sentence.globalIndex,
          audio.status === "ready",
          processingEpochRef.current
        );

        // If the result was from a stale epoch, don't clear processing or call processNext
        // The new epoch's processing will handle itself
        if (!wasAccepted) {
          processingIdRef.current = null;
          return;
        }
      }

      // Clear processing flag
      processingIdRef.current = null;

      // Extend queue on generation complete (not on playback start)
      // This ensures we keep generating ahead regardless of playback timing
      const queue = generationQueueRef.current;
      const currentPlaybackIndex = state.playback.currentIndex;

      // Find how far ahead we should generate (playback + 2)
      const targetIndex = currentPlaybackIndex + 2;

      // Extend queue if needed
      for (let i = currentPlaybackIndex; i <= targetIndex && i < state.sentences.length; i++) {
        queue.extendQueue(state.sentences, i, voiceConfigRef.current, 1);
      }

      // Use setTimeout to avoid potential issues with state updates
      setTimeout(() => {
        processNext();
      }, 0);
    }
  }, [state.audioState, state.sentences, state.playback.currentIndex, generationQueueRef, processNext]);

  // Effect: Start processing when model becomes ready
  useEffect(() => {
    if (state.modelStatus === "ready" && processingIdRef.current === null) {
      // Check if there's anything in the queue
      const queue = generationQueueRef.current;
      if (queue.hasPending()) {
        processNext();
      }
    }
  }, [state.modelStatus, generationQueueRef, processNext]);

  // Effect: Start processing when switching to cloud mode (standard/expressive)
  // Cloud modes don't require the local model to be ready
  useEffect(() => {
    if (state.ttsMode !== "eco" && processingIdRef.current === null) {
      const queue = generationQueueRef.current;
      if (queue.hasPending()) {
        console.log("[useGeneration] Cloud mode active, processing pending queue");
        processNext();
      }
    }
  }, [state.ttsMode, generationQueueRef, processNext]);

  // Effect: Reset processingIdRef when sentences change (e.g., after edit)
  // Any in-flight processing is for old sentences and should be abandoned
  useEffect(() => {
    processingIdRef.current = null;
  }, [state.sentences]);

  return {
    modelStatus: state.modelStatus,
    modelError: state.modelError,
    modelDownloadProgress: state.modelDownloadProgress,
    isDownloading: state.isDownloading,
    capabilityStatus: state.capabilityStatus,
    capabilityResult: state.capabilityResult,
    ttsMode: state.ttsMode,
    voiceQuality: state.voiceQuality,
    ecoDisabled: state.ecoDisabled,
    cloudHealth: state.cloudHealth,
    chatterboxCfg: state.chatterboxCfg,
    chatterboxExaggeration: state.chatterboxExaggeration,
    setTTSMode,
    setVoiceQuality,
    setEcoDisabled,
    setChatterboxCfg,
    setChatterboxExaggeration,
    generateFrom,
    invalidateAllAndRegenerate,
    invalidateByReaderAndRegenerate,
    extendQueueAndProcess,
    clearQueue,
    isGenerated: (globalIndex: number) =>
      generationQueueRef.current.isGenerated(globalIndex),
  };
}
