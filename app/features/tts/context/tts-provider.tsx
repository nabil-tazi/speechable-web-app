"use client";

import React, {
  createContext,
  useContext,
  useReducer,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useState,
} from "react";
import type {
  Sentence,
  Segment,
  SentenceAudio,
  PlaybackStatus,
  VoiceConfig,
  ModelStatus,
  WorkerOutgoingMessage,
  PendingAction,
} from "../types";
import { ttsReducer, initialState, type TTSState, type TTSAction } from "./tts-reducer";
import { createSentencesFromSegments } from "../lib/sentence-splitter";
import { GenerationQueue } from "../lib/generation-queue";

// =============================================
// Context Types
// =============================================

interface TTSContextValue {
  // State
  state: TTSState;
  dispatch: React.Dispatch<TTSAction>;

  // Refs for hooks to use
  workerRef: React.RefObject<Worker | null>;
  audioContextRef: React.RefObject<AudioContext | null>;
  currentSourceRef: React.RefObject<AudioBufferSourceNode | null>;
  generationQueueRef: React.RefObject<GenerationQueue>;
  analyserRef: React.RefObject<AnalyserNode | null>;

  // Playback guard refs - MUST be shared across all usePlayback() consumers
  // to prevent multiple components from triggering playback simultaneously
  isStartingPlaybackRef: React.MutableRefObject<boolean>;
  pendingDecodeRef: React.MutableRefObject<AbortController | null>;

  // Derived helpers
  currentSentence: Sentence | null;
  isPlaybackOn: boolean; // playing or buffering

  // Hover state for syncing between player and sentence display
  hoveredIndex: number | null;
  setHoveredIndex: (index: number | null) => void;
}

const TTSContext = createContext<TTSContextValue | null>(null);

// =============================================
// Provider Props
// =============================================

interface TTSProviderProps {
  children: React.ReactNode;
  segments: Segment[];
  initialVoiceMap?: Record<string, string>;
  initialSpeed?: number;
}

// =============================================
// Provider Component
// =============================================

export function TTSProvider({
  children,
  segments,
  initialVoiceMap = {},
  initialSpeed = 1.0,
}: TTSProviderProps) {
  const [state, dispatch] = useReducer(ttsReducer, {
    ...initialState,
    voiceConfig: {
      voiceMap: initialVoiceMap,
      speed: initialSpeed,
    },
  });

  // Refs
  const workerRef = useRef<Worker | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const generationQueueRef = useRef<GenerationQueue>(new GenerationQueue());
  const analyserRef = useRef<AnalyserNode | null>(null);
  // Ref to access current sentences in worker callback (avoids stale closure)
  const sentencesRef = useRef<Sentence[]>([]);

  // Playback guard refs - shared across all usePlayback() consumers
  // These MUST be in context so multiple components don't each have their own copy
  const isStartingPlaybackRef = useRef<boolean>(false);
  const pendingDecodeRef = useRef<AbortController | null>(null);

  // Initialize sentences from segments
  useEffect(() => {
    const sentences = createSentencesFromSegments(segments);
    sentencesRef.current = sentences;
    dispatch({ type: "SET_SENTENCES", sentences });
  }, [segments]);

  // Initialize worker
  useEffect(() => {
    if (typeof window === "undefined") return;

    workerRef.current = new Worker(
      new URL("../worker/kokoro-worker.ts", import.meta.url),
      { type: "module" }
    );

    workerRef.current.onmessage = (event: MessageEvent<WorkerOutgoingMessage>) => {
      const message = event.data;

      switch (message.type) {
        case "loading":
          dispatch({ type: "MODEL_LOADING" });
          if (message.progress !== undefined) {
            dispatch({ type: "MODEL_DOWNLOAD_PROGRESS", progress: message.progress });
          }
          // Only update isDownloading if model wasn't previously cached
          // (cached loads still report progress but we don't want to show modal)
          if (message.isDownloading !== undefined) {
            const wasCached = localStorage.getItem("tts-model-cached") === "true";
            if (!wasCached) {
              dispatch({ type: "SET_IS_DOWNLOADING", isDownloading: message.isDownloading });
            }
          }
          break;

        case "ready":
          dispatch({ type: "MODEL_READY" });
          // Mark model as cached for future loads
          localStorage.setItem("tts-model-cached", "true");
          break;

        case "generated":
          console.log("[TTSProvider] Received generated audio for:", message.sentenceId);
          dispatch({
            type: "GENERATION_COMPLETE",
            sentenceId: message.sentenceId,
            audio: message.audio,
            duration: message.duration,
            speed: message.speed,
            voice: message.voice,
          });
          // Queue management is handled by useGeneration hook
          break;

        case "error":
          if (message.sentenceId) {
            console.log("[TTSProvider] Received error for:", message.sentenceId, message.error);
            dispatch({
              type: "GENERATION_ERROR",
              sentenceId: message.sentenceId,
              error: message.error,
            });
            // Queue management is handled by useGeneration hook
          } else {
            dispatch({ type: "MODEL_ERROR", error: message.error });
          }
          break;
      }
    };

    // Initialize the model
    workerRef.current.postMessage({ type: "initialize" });

    return () => {
      // Stop any currently playing audio
      if (currentSourceRef.current) {
        try {
          currentSourceRef.current.onended = null;
          currentSourceRef.current.stop();
        } catch {
          // Ignore errors from already-stopped sources
        }
        currentSourceRef.current = null;
      }

      // Cancel any pending decode operations
      if (pendingDecodeRef.current) {
        pendingDecodeRef.current.abort();
        pendingDecodeRef.current = null;
      }

      // Close the AudioContext
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }

      // Terminate the worker
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Derived values
  const currentSentence = useMemo(() => {
    return state.sentences[state.playback.currentIndex] || null;
  }, [state.sentences, state.playback.currentIndex]);

  const isPlaybackOn = useMemo(() => {
    return state.playback.status === "playing" || state.playback.status === "buffering";
  }, [state.playback.status]);

  // Hover state for syncing between player and sentence display
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Context value
  const value = useMemo<TTSContextValue>(
    () => ({
      state,
      dispatch,
      workerRef,
      audioContextRef,
      currentSourceRef,
      generationQueueRef,
      analyserRef,
      isStartingPlaybackRef,
      pendingDecodeRef,
      currentSentence,
      isPlaybackOn,
      hoveredIndex,
      setHoveredIndex,
    }),
    [state, currentSentence, isPlaybackOn, hoveredIndex]
  );

  return <TTSContext.Provider value={value}>{children}</TTSContext.Provider>;
}

// =============================================
// Hook to access context
// =============================================

export function useTTSContext(): TTSContextValue {
  const context = useContext(TTSContext);
  if (!context) {
    throw new Error("useTTSContext must be used within a TTSProvider");
  }
  return context;
}
