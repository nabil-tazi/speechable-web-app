# TTS System

Browser-based text-to-speech using [Kokoro-JS](https://www.npmjs.com/package/kokoro-js).

## Features

- **Local Processing**: All TTS processing happens in the browser
- **WebGPU Support**: Automatically uses WebGPU if available, falls back to WASM
- **Unified Sentence Model**: One sentence = one audio blob = one playback unit
- **Priority Queue**: Generates what's needed for immediate playback first
- **Multiple Voices**: 12 high-quality voices per reader

## Architecture

```
TTSProvider (React Context)
├── sentences[] (computed once from segments)
├── audioState Map<sentenceId, SentenceAudio>
├── playback { status, currentIndex }
└── voiceConfig { voiceMap, speed }

Hooks:
├── useSentences() - sentence access
├── usePlayback() - play/pause/seek
├── useGeneration() - worker + priority queue
└── useVoiceConfig() - voice/speed settings

Worker:
└── Single-sentence generation with retry logic
```

## Usage

```tsx
import {
  TTSProvider,
  TTSPlayer,
  parseSegmentsFromProcessedText,
} from "@/app/features/tts";

function MyComponent({ processedText }) {
  const segments = parseSegmentsFromProcessedText(processedText);

  return (
    <TTSProvider segments={segments}>
      <TTSPlayer />
    </TTSProvider>
  );
}
```

## Playback States

| Status | Play Button | Audio Output | Meaning |
|--------|-------------|--------------|---------|
| `idle` | Play | No | Initial/stopped |
| `playing` | Pause | Yes | Actively playing |
| `buffering` | Pause | No | Playback ON, waiting for audio |
| `paused` | Play | No | User paused |

## Key Behaviors

- **Sentence click**: Moves to clicked sentence, buffers if not generated
- **Speed change**: Invalidates all audio, regenerates from current position
- **Voice change**: Invalidates audio for that reader only
- **End of document**: Resets to idle at sentence 0

## Files

- `types.ts` - Type definitions
- `context/tts-provider.tsx` - React context provider
- `context/tts-reducer.ts` - State reducer
- `hooks/use-*.ts` - React hooks
- `lib/sentence-splitter.ts` - Sentence splitting utility
- `lib/generation-queue.ts` - Priority queue for generation
- `worker/kokoro-worker.ts` - Web Worker for TTS
- `components/tts-player.tsx` - Player UI
