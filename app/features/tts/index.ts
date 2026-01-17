// Context
export { TTSProvider, useTTSContext } from "./context/tts-provider";

// Hooks
export { useSentences } from "./hooks/use-sentences";
export { usePlayback } from "./hooks/use-playback";
export { useGeneration } from "./hooks/use-generation";
export { useVoiceConfig } from "./hooks/use-voice-config";
export { useGain } from "./hooks/use-gain";

// Components
export { TTSPlayer } from "./components/tts-player";
export { SentenceDisplay } from "./components/sentence-display";
export { DownloadButton } from "./components/download-button";
export { EcoBadge } from "./components/eco-badge";

// Types
export type {
  Sentence,
  Segment,
  SentenceAudio,
  PlaybackStatus,
  VoiceConfig,
  ModelStatus,
} from "./types";

export type { VoiceQuality } from "./context/tts-reducer";

// Utilities
export {
  createSentencesFromSegments,
  parseSegmentsFromProcessedText,
  parseSegmentsFromBlocks,
  splitIntoSentences,
} from "./lib/sentence-splitter";
