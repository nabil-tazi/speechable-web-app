import type {
  Sentence,
  SentenceAudio,
  PlaybackStatus,
  PlaybackState,
  VoiceConfig,
  ModelStatus,
  PendingAction,
} from "../types";

// =============================================
// State
// =============================================

export interface TTSState {
  // Model state
  modelStatus: ModelStatus;
  modelError?: string;
  modelDownloadProgress?: number; // 0-1, for tracking model download
  isDownloading: boolean; // True when actual file downloads are happening (not cached)

  // Sentences (immutable after creation)
  sentences: Sentence[];

  // Audio state per sentence (sentenceId -> SentenceAudio)
  audioState: Map<string, SentenceAudio>;

  // Playback state
  playback: PlaybackState;

  // Voice configuration
  voiceConfig: VoiceConfig;

  // Pending action to execute after model loads
  pendingAction: PendingAction | null;
}

export const initialState: TTSState = {
  modelStatus: "uninitialized",
  modelDownloadProgress: 0,
  isDownloading: false,
  sentences: [],
  audioState: new Map(),
  playback: {
    status: "idle",
    currentIndex: 0,
  },
  voiceConfig: {
    voiceMap: {},
    speed: 1.0,
  },
  pendingAction: null,
};

// =============================================
// Actions
// =============================================

export type TTSAction =
  // Model lifecycle
  | { type: "MODEL_LOADING" }
  | { type: "MODEL_READY" }
  | { type: "MODEL_ERROR"; error: string }
  | { type: "MODEL_DOWNLOAD_PROGRESS"; progress: number }
  | { type: "SET_IS_DOWNLOADING"; isDownloading: boolean }

  // Sentence initialization
  | { type: "SET_SENTENCES"; sentences: Sentence[] }

  // Audio generation
  | { type: "GENERATION_START"; sentenceId: string }
  | {
      type: "GENERATION_COMPLETE";
      sentenceId: string;
      audio: Blob;
      duration: number;
      speed: number;
      voice: string;
    }
  | { type: "GENERATION_ERROR"; sentenceId: string; error: string }
  | { type: "INVALIDATE_ALL_AUDIO" }
  | { type: "INVALIDATE_AUDIO_BY_READER"; readerId: string }

  // Playback control
  | { type: "PLAY"; sentenceIndex: number }
  | { type: "PAUSE" }
  | { type: "STOP" }
  | { type: "SET_BUFFERING"; sentenceIndex: number }
  | { type: "SET_PLAYING"; sentenceIndex: number }
  | { type: "SENTENCE_COMPLETE" }

  // Voice configuration
  | { type: "SET_VOICE"; readerId: string; voiceId: string }
  | { type: "SET_SPEED"; speed: number }
  | { type: "SET_VOICE_MAP"; voiceMap: Record<string, string> }

  // Pending actions
  | { type: "SET_PENDING_ACTION"; action: PendingAction }
  | { type: "CLEAR_PENDING_ACTION" };

// =============================================
// Reducer
// =============================================

export function ttsReducer(state: TTSState, action: TTSAction): TTSState {
  switch (action.type) {
    // Model lifecycle
    case "MODEL_LOADING":
      return { ...state, modelStatus: "loading" };

    case "MODEL_READY":
      return { ...state, modelStatus: "ready", modelError: undefined };

    case "MODEL_ERROR":
      return { ...state, modelStatus: "error", modelError: action.error };

    case "MODEL_DOWNLOAD_PROGRESS":
      return { ...state, modelDownloadProgress: action.progress };

    case "SET_IS_DOWNLOADING":
      return { ...state, isDownloading: action.isDownloading };

    // Sentence initialization
    case "SET_SENTENCES": {
      const audioState = new Map<string, SentenceAudio>();
      for (const sentence of action.sentences) {
        audioState.set(sentence.id, {
          sentenceId: sentence.id,
          status: "pending",
        });
      }
      return {
        ...state,
        sentences: action.sentences,
        audioState,
        playback: { status: "idle", currentIndex: 0 },
      };
    }

    // Audio generation
    case "GENERATION_START":
      return updateAudioState(state, action.sentenceId, {
        status: "generating",
      });

    case "GENERATION_COMPLETE":
      return updateAudioState(state, action.sentenceId, {
        status: "ready",
        audioBlob: action.audio,
        duration: action.duration,
        generatedSpeed: action.speed,
        generatedVoice: action.voice,
      });

    case "GENERATION_ERROR":
      return updateAudioState(state, action.sentenceId, {
        status: "error",
      });

    case "INVALIDATE_ALL_AUDIO": {
      const audioState = new Map<string, SentenceAudio>();
      for (const sentence of state.sentences) {
        audioState.set(sentence.id, {
          sentenceId: sentence.id,
          status: "pending",
        });
      }
      return { ...state, audioState };
    }

    case "INVALIDATE_AUDIO_BY_READER": {
      const audioState = new Map(state.audioState);
      for (const sentence of state.sentences) {
        if (sentence.reader_id === action.readerId) {
          audioState.set(sentence.id, {
            sentenceId: sentence.id,
            status: "pending",
          });
        }
      }
      return { ...state, audioState };
    }

    // Playback control
    case "PLAY":
      return {
        ...state,
        playback: {
          status: "playing",
          currentIndex: action.sentenceIndex,
        },
      };

    case "PAUSE":
      return {
        ...state,
        playback: { ...state.playback, status: "paused" },
      };

    case "STOP":
      return {
        ...state,
        playback: { status: "idle", currentIndex: 0 },
      };

    case "SET_BUFFERING":
      return {
        ...state,
        playback: {
          status: "buffering",
          currentIndex: action.sentenceIndex,
        },
      };

    case "SET_PLAYING":
      return {
        ...state,
        playback: {
          status: "playing",
          currentIndex: action.sentenceIndex,
        },
      };

    case "SENTENCE_COMPLETE": {
      const nextIndex = state.playback.currentIndex + 1;
      if (nextIndex >= state.sentences.length) {
        // End of document - reset to idle at sentence 0
        return {
          ...state,
          playback: { status: "idle", currentIndex: 0 },
        };
      }
      // Move to next sentence (will be set to playing or buffering by playback hook)
      return {
        ...state,
        playback: {
          ...state.playback,
          currentIndex: nextIndex,
        },
      };
    }

    // Voice configuration
    case "SET_VOICE": {
      const newVoiceMap = {
        ...state.voiceConfig.voiceMap,
        [action.readerId]: action.voiceId,
      };
      return {
        ...state,
        voiceConfig: { ...state.voiceConfig, voiceMap: newVoiceMap },
      };
    }

    case "SET_SPEED":
      return {
        ...state,
        voiceConfig: { ...state.voiceConfig, speed: action.speed },
      };

    case "SET_VOICE_MAP":
      return {
        ...state,
        voiceConfig: { ...state.voiceConfig, voiceMap: action.voiceMap },
      };

    // Pending actions
    case "SET_PENDING_ACTION":
      return { ...state, pendingAction: action.action };

    case "CLEAR_PENDING_ACTION":
      return { ...state, pendingAction: null };

    default:
      return state;
  }
}

// =============================================
// Helpers
// =============================================

function updateAudioState(
  state: TTSState,
  sentenceId: string,
  updates: Partial<SentenceAudio>
): TTSState {
  const audioState = new Map(state.audioState);
  const current = audioState.get(sentenceId) || {
    sentenceId,
    status: "pending" as const,
  };
  audioState.set(sentenceId, { ...current, ...updates });
  return { ...state, audioState };
}
