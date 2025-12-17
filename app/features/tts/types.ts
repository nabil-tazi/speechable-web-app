// =============================================
// TTS System Types
// =============================================

/**
 * A segment is the top-level unit from the document's processed_text.
 * It represents a block of text assigned to a specific reader/voice.
 */
export interface Segment {
  text: string;
  reader_id: string;
  segmentIndex: number;
}

/**
 * A sentence is the atomic unit for both display and audio generation.
 * Sentences are pre-computed from segments using a consistent splitter.
 * One sentence = one audio blob = one playback unit.
 */
export interface Sentence {
  id: string; // Format: `${segmentIndex}-${sentenceIndex}`
  text: string;
  segmentIndex: number;
  sentenceIndex: number; // Index within the segment
  globalIndex: number; // Global index across all sentences in the document
  reader_id: string;
}

/**
 * Audio state for a single sentence.
 * Kept separate from Sentence to allow for regeneration without
 * recreating sentence structures.
 */
export interface SentenceAudio {
  sentenceId: string;
  status: "pending" | "generating" | "ready" | "error";
  audioBlob?: Blob;
  duration?: number; // In seconds, computed after generation
  retryCount?: number; // Track retry attempts
  generatedSpeed?: number; // Speed used when generating this audio
  generatedVoice?: string; // Voice used when generating this audio
}

/**
 * Playback status states:
 * - idle: OFF, initial/stopped state (play button shows ▶️)
 * - playing: ON, audio is outputting (play button shows ⏸️)
 * - buffering: ON, waiting for current sentence to be generated (play button shows ⏸️)
 * - paused: OFF, user paused playback (play button shows ▶️)
 */
export type PlaybackStatus = "idle" | "playing" | "buffering" | "paused";

/**
 * Playback state tracking current position and status.
 */
export interface PlaybackState {
  status: PlaybackStatus;
  currentIndex: number; // Global index of current/target sentence
}

/**
 * Voice configuration for TTS.
 */
export interface VoiceConfig {
  voiceMap: Record<string, string>; // reader_id -> voice_id
  speed: number; // Playback speed multiplier (1.0 = normal)
}

/**
 * Model loading status.
 */
export type ModelStatus = "uninitialized" | "loading" | "ready" | "error";

// =============================================
// Worker Message Types
// =============================================

export interface GenerateRequest {
  sentenceId: string;
  text: string;
  voice: string;
  speed: number;
}

export type WorkerIncomingMessage =
  | { type: "initialize" }
  | { type: "generate"; request: GenerateRequest }
  | { type: "cancelAll" };

export type WorkerOutgoingMessage =
  | { type: "ready" }
  | {
      type: "loading";
      progress: number;
      isDownloading?: boolean;
      file?: string;
      loaded?: number;
      total?: number;
      status?: string;
    }
  | { type: "generated"; sentenceId: string; audio: Blob; duration: number; speed: number; voice: string }
  | { type: "error"; sentenceId: string; error: string; canRetry: boolean };

// =============================================
// Queue Types
// =============================================

export interface QueueItem {
  sentenceId: string;
  globalIndex: number;
  text: string;
  reader_id: string;
  voice: string;
  speed: number;
}

// =============================================
// Action to queue after model loads
// =============================================

export interface PendingAction {
  type: "play";
  sentenceIndex: number;
}
