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
  // When segments change (e.g., after edit), stop playback and clear queue
  useEffect(() => {
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

    // Invalidate all generated audio and clear queue
    // This also clears the generatedSet so old sentence indexes aren't treated as "already generated"
    generationQueueRef.current.invalidateAll();

    // Reset playback state
    dispatch({ type: "STOP" });

    // Create new sentences from updated segments
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
          // Trigger capability check now that model is ready
          dispatch({ type: "CAPABILITY_CHECK_START" });
          workerRef.current?.postMessage({ type: "capabilityCheck" });
          break;

        case "capabilityResult":
          console.log("[TTSProvider] Capability check result:", message.result);
          if (message.result.testGenerationTimeMs) {
            console.log(`[TTSProvider] Test generation time: ${message.result.testGenerationTimeMs}ms`);
          }
          dispatch({ type: "CAPABILITY_CHECK_RESULT", result: message.result });
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

  // Check cloud TTS health on mount (both in parallel)
  useEffect(() => {
    // Start both checks immediately
    dispatch({ type: "CLOUD_HEALTH_CHECK_START", service: "kokoro" });
    dispatch({ type: "CLOUD_HEALTH_CHECK_START", service: "chatterbox" });

    // Check Kokoro (standard mode)
    fetch("/api/deepinfra-health/kokoro")
      .then((res) => res.json())
      .then((data) => {
        dispatch({
          type: "CLOUD_HEALTH_CHECK_RESULT",
          service: "kokoro",
          status: data.status === "ok" ? "ok" : "down",
        });
      })
      .catch(() => {
        dispatch({ type: "CLOUD_HEALTH_CHECK_RESULT", service: "kokoro", status: "down" });
      });

    // Check Chatterbox (expressive mode)
    fetch("/api/deepinfra-health/chatterbox")
      .then((res) => res.json())
      .then((data) => {
        dispatch({
          type: "CLOUD_HEALTH_CHECK_RESULT",
          service: "chatterbox",
          status: data.status === "ok" ? "ok" : "down",
        });
      })
      .catch(() => {
        dispatch({ type: "CLOUD_HEALTH_CHECK_RESULT", service: "chatterbox", status: "down" });
      });
  }, []);

  // Compute effective TTS mode based on voiceQuality, ecoDisabled, and availability
  useEffect(() => {
    const { kokoro, chatterbox } = state.cloudHealth;
    const ecoAvailable = state.capabilityStatus === "available";
    const { voiceQuality, ecoDisabled, voiceConfig } = state;

    // Check if any selected voice is non-English (eco mode only supports English voices)
    // English voices start with 'a' (American) or 'b' (British)
    const hasNonEnglishVoice = Object.values(voiceConfig.voiceMap).some(
      (voiceId) => !voiceId.startsWith("a") && !voiceId.startsWith("b")
    );

    // Eco is only viable if available AND all voices are English
    const ecoViable = ecoAvailable && !hasNonEnglishVoice;

    let newMode: "eco" | "standard" | "expressive" | null = null;

    if (voiceQuality === "expressive") {
      // Expressive mode: use chatterbox if available
      if (chatterbox === "ok") {
        newMode = "expressive";
      } else if (chatterbox === "checking") {
        // Still checking, don't set mode yet
        return;
      }
      // If chatterbox is down, fall back to standard behavior
      else if (!ecoDisabled && ecoViable) {
        newMode = "eco";
      } else if (kokoro === "ok") {
        newMode = "standard";
      } else if (kokoro === "checking") {
        return;
      }
    } else {
      // Standard quality: use eco if available and not disabled, else cloud
      if (!ecoDisabled && ecoViable) {
        newMode = "eco";
      } else if (kokoro === "ok") {
        newMode = "standard";
      } else if (kokoro === "checking") {
        // Still checking, don't set mode yet
        return;
      } else if (!ecoDisabled && state.capabilityStatus === "checking") {
        // Eco still checking, wait
        return;
      }
    }

    // Only update if mode actually changed
    if (newMode !== state.ttsMode) {
      dispatch({ type: "SET_TTS_MODE", mode: newMode });
    }
  }, [state.cloudHealth, state.capabilityStatus, state.voiceQuality, state.ecoDisabled, state.ttsMode, state.voiceConfig.voiceMap]);

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
