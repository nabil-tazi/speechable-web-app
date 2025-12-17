"use client";

import { useCallback, useEffect, useRef } from "react";
import { useTTSContext } from "../context/tts-provider";
import type { WorkerIncomingMessage, VoiceConfig } from "../types";

/**
 * Hook for managing audio generation via the Web Worker.
 */
export function useGeneration() {
  const { state, dispatch, workerRef, generationQueueRef } = useTTSContext();

  // Track the currently processing sentence and its epoch
  const processingIdRef = useRef<string | null>(null);
  const processingEpochRef = useRef<number>(0);

  // Keep voiceConfig in a ref to avoid stale closures in callbacks (e.g., onended)
  const voiceConfigRef = useRef(state.voiceConfig);
  voiceConfigRef.current = state.voiceConfig;

  /**
   * Process the next item in the queue.
   */
  const processNext = useCallback(() => {
    // Don't start if already processing
    if (processingIdRef.current !== null) {
      console.log("[useGeneration] Already processing:", processingIdRef.current);
      return;
    }
    if (state.modelStatus !== "ready") {
      console.log("[useGeneration] Model not ready");
      return;
    }

    const queue = generationQueueRef.current;
    const next = queue.getNext();
    if (!next) {
      console.log("[useGeneration] Queue empty");
      return;
    }

    console.log("[useGeneration] Processing next:", next.sentenceId);
    processingIdRef.current = next.sentenceId;
    processingEpochRef.current = queue.getEpoch(); // Track epoch for this generation
    dispatch({ type: "GENERATION_START", sentenceId: next.sentenceId });

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
  }, [state.modelStatus, dispatch, workerRef, generationQueueRef]);

  /**
   * Start generation from a specific sentence index.
   * Uses voiceConfigRef to ensure we always use the latest config, even in stale callbacks.
   */
  const generateFrom = useCallback(
    (fromIndex: number) => {
      console.log("[useGeneration] generateFrom:", fromIndex);
      const queue = generationQueueRef.current;
      // Use ref to get latest voiceConfig (avoids stale closure in onended callbacks)
      queue.buildQueue(state.sentences, fromIndex, voiceConfigRef.current);
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
      queue.buildQueue(state.sentences, fromIndex, configToUse);
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
      queue.buildQueue(state.sentences, fromIndex, configToUse);
      processNext();
    },
    [state.sentences, state.voiceConfig, dispatch, generationQueueRef, processNext]
  );

  /**
   * Clear the generation queue.
   */
  const clearQueue = useCallback(() => {
    generationQueueRef.current.clear();
    processingIdRef.current = null;
    workerRef.current?.postMessage({ type: "cancelAll" } as WorkerIncomingMessage);
  }, [generationQueueRef, workerRef]);

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

      // Clear processing flag and process next
      processingIdRef.current = null;

      // Use setTimeout to avoid potential issues with state updates
      setTimeout(() => {
        processNext();
      }, 0);
    }
  }, [state.audioState, state.sentences, generationQueueRef, processNext]);

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

  // Effect: Auto-start generation when model is ready and sentences are loaded
  useEffect(() => {
    if (
      state.modelStatus === "ready" &&
      state.sentences.length > 0 &&
      !generationQueueRef.current.hasPending() &&
      processingIdRef.current === null
    ) {
      // Check if any sentences still need generation
      const hasUngenerated = state.sentences.some(
        (s) => state.audioState.get(s.id)?.status !== "ready"
      );
      if (hasUngenerated) {
        generateFrom(0);
      }
    }
  }, [state.modelStatus, state.sentences, state.audioState, generateFrom, generationQueueRef]);

  return {
    modelStatus: state.modelStatus,
    modelError: state.modelError,
    modelDownloadProgress: state.modelDownloadProgress,
    isDownloading: state.isDownloading,
    generateFrom,
    invalidateAllAndRegenerate,
    invalidateByReaderAndRegenerate,
    clearQueue,
    isGenerated: (globalIndex: number) =>
      generationQueueRef.current.isGenerated(globalIndex),
  };
}
