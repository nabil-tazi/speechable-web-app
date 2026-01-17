import { KokoroTTS } from "kokoro-js";
import type {
  WorkerIncomingMessage,
  WorkerOutgoingMessage,
  GenerateRequest,
  CapabilityCheckResult,
} from "../types";

let tts: KokoroTTS | null = null;
let isLoading = false;
let hasActiveDownloads = false;

const MAX_RETRIES = 3;

// Track download progress per file - only files actively downloading
const downloadProgress = new Map<string, { loaded: number; total: number }>();
const activeFiles = new Set<string>(); // Files we've seen with loaded < total (not cached)
let lastSentProgress = 0;

/**
 * Calculate download progress based on actual file totals.
 */
function calculateAggregateProgress(): number {
  let totalLoaded = 0;
  let totalSize = 0;
  for (const { loaded, total } of downloadProgress.values()) {
    totalLoaded += loaded;
    totalSize += total;
  }
  return totalSize > 0 ? Math.min(totalLoaded / totalSize, 1) : 0;
}

/**
 * Detect WebGPU support for optimal performance.
 */
async function detectWebGPU(): Promise<boolean> {
  try {
    // @ts-ignore - WebGPU is not yet in TypeScript DOM types
    const adapter = await navigator.gpu?.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

/**
 * Post a typed message to the main thread.
 */
function postMessage(message: WorkerOutgoingMessage): void {
  self.postMessage(message);
}

/**
 * Initialize the TTS model.
 */
async function initializeModel(): Promise<void> {
  if (tts || isLoading) {
    if (tts) {
      postMessage({ type: "ready" });
    }
    return;
  }

  isLoading = true;

  try {
    // Clear any stale progress data from previous loads
    downloadProgress.clear();
    activeFiles.clear();
    lastSentProgress = 0;
    hasActiveDownloads = false;
    postMessage({ type: "loading", progress: 0, isDownloading: false });

    const device = (await detectWebGPU()) ? "webgpu" : "wasm";
    console.log("[Kokoro Worker] Using device:", device);
    const model_id = "onnx-community/Kokoro-82M-v1.0-ONNX";

    tts = await KokoroTTS.from_pretrained(model_id, {
      dtype: device === "wasm" ? "q8" : "fp32",
      device,
      progress_callback: (data: {
        status?: string;
        file?: string;
        loaded?: number;
        total?: number;
        progress?: number;
      }) => {
        // Track loaded bytes per file
        if (data.file && data.loaded !== undefined && data.total) {
          // Only track files we've seen actively downloading (not instantly complete/cached)
          if (data.loaded < data.total) {
            hasActiveDownloads = true;
            activeFiles.add(data.file);
          }

          // Only update progress for files that are actively downloading
          if (activeFiles.has(data.file)) {
            const current = downloadProgress.get(data.file);
            const currentLoaded = current?.loaded ?? 0;

            if (data.loaded > currentLoaded) {
              downloadProgress.set(data.file, {
                loaded: data.loaded,
                total: data.total,
              });

              const aggregateProgress = calculateAggregateProgress();

              // Only send progress if it's higher than last sent (never go backwards)
              if (aggregateProgress > lastSentProgress) {
                lastSentProgress = aggregateProgress;
                postMessage({
                  type: "loading",
                  progress: aggregateProgress,
                  isDownloading: hasActiveDownloads,
                });
              }
            }
          }
        }
      },
    });

    // Clear progress tracking after successful load
    downloadProgress.clear();
    postMessage({ type: "ready" });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to initialize TTS model";
    postMessage({
      type: "error",
      sentenceId: "",
      error: errorMessage,
      canRetry: false,
    });
  } finally {
    isLoading = false;
  }
}

/**
 * Generate audio for a single sentence with retry logic.
 */
async function generateSentence(request: GenerateRequest): Promise<void> {
  if (!tts) {
    postMessage({
      type: "error",
      sentenceId: request.sentenceId,
      error: "Model not initialized",
      canRetry: false,
    });
    return;
  }

  console.log("[Kokoro Worker] Generating sentence:", {
    sentenceId: request.sentenceId,
    text:
      request.text.substring(0, 50) + (request.text.length > 50 ? "..." : ""),
    voice: request.voice,
    speed: request.speed,
  });

  // Skip empty or whitespace-only text
  if (!request.text || request.text.trim().length === 0) {
    console.warn(
      "[Kokoro Worker] Skipping empty text for sentence:",
      request.sentenceId
    );
    postMessage({
      type: "generated",
      sentenceId: request.sentenceId,
      audio: new Blob([], { type: "audio/wav" }),
      duration: 0,
      speed: request.speed,
      voice: request.voice,
    });
    return;
  }

  let lastError: string = "";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Generate audio for the sentence
      // Cast voice to any to bypass strict type checking (voice IDs are dynamic)
      const audio = await tts.generate(request.text, {
        voice: request.voice as any,
        speed: request.speed,
      });

      // Debug: log the audio object structure
      console.log("[Kokoro Worker] Audio object keys:", Object.keys(audio));
      console.log("[Kokoro Worker] Audio object:", audio);

      // Convert to blob and calculate duration
      const blob = audio.toBlob();

      // The RawAudio class has audio property (Float32Array) and sampling_rate
      // Try different property names based on the actual structure
      let duration = 0;
      if ((audio as any).audio && (audio as any).sampling_rate) {
        // New API: audio.audio is the Float32Array
        duration = (audio as any).audio.length / (audio as any).sampling_rate;
      } else if ((audio as any).data && (audio as any).sampling_rate) {
        // Old API: audio.data is the Float32Array
        duration = (audio as any).data.length / (audio as any).sampling_rate;
      } else {
        // Fallback: estimate from blob size (rough estimate)
        console.warn(
          "[Kokoro Worker] Could not determine audio duration, using estimate"
        );
        duration = blob.size / (16000 * 2); // Assuming 16kHz mono 16-bit
      }

      postMessage({
        type: "generated",
        sentenceId: request.sentenceId,
        audio: blob,
        duration,
        speed: request.speed,
        voice: request.voice,
      });

      return; // Success, exit the retry loop
    } catch (error: unknown) {
      lastError =
        error instanceof Error ? error.message : "Failed to generate audio";
      console.warn(
        `[Kokoro Worker] Generation attempt ${attempt}/${MAX_RETRIES} failed for sentence ${request.sentenceId}:`,
        lastError
      );

      // Wait before retrying (exponential backoff)
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 100)
        );
      }
    }
  }

  // All retries failed
  postMessage({
    type: "error",
    sentenceId: request.sentenceId,
    error: lastError,
    canRetry: false, // Already exhausted retries
  });
}

/**
 * Run a capability check to determine if local TTS generation is viable.
 * This tests: model availability, WebGPU support, and test generation.
 */
async function runCapabilityCheck(): Promise<void> {
  const TEST_SENTENCE = "Hello World, testing speechable eco-mode generation";

  const result: CapabilityCheckResult = {
    available: false,
    modelCached: false,
    hasWebGPU: false,
    testGenerationSuccess: false,
  };

  try {
    // Check WebGPU availability
    result.hasWebGPU = await detectWebGPU();
    console.log("[Kokoro Worker] Capability check - WebGPU:", result.hasWebGPU);

    // Check if model is already loaded or needs loading
    if (!tts && !isLoading) {
      // Model not loaded - check if it's cached by attempting a quick load
      // For now, we'll just report that it's not cached
      result.modelCached = false;
      result.error = "Model not loaded";
      postMessage({ type: "capabilityResult", result });
      return;
    }

    // Wait for model to be ready if it's still loading
    if (isLoading) {
      // Model is loading, wait for it (with timeout)
      const startWait = performance.now();
      const MAX_WAIT_MS = 30000; // 30 seconds max wait
      while (isLoading && (performance.now() - startWait) < MAX_WAIT_MS) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (isLoading) {
        result.error = "Model loading timeout";
        postMessage({ type: "capabilityResult", result });
        return;
      }
    }

    if (!tts) {
      result.error = "Model failed to load";
      postMessage({ type: "capabilityResult", result });
      return;
    }

    result.modelCached = true;

    // Run test generation and measure time
    const startTime = performance.now();

    try {
      const audio = await tts.generate(TEST_SENTENCE, {
        voice: "af_sky" as any,
        speed: 1.0,
      });

      const endTime = performance.now();
      result.testGenerationTimeMs = Math.round(endTime - startTime);

      // Calculate audio duration
      let audioDurationMs = 0;
      if ((audio as any).audio && (audio as any).sampling_rate) {
        audioDurationMs = Math.round(((audio as any).audio.length / (audio as any).sampling_rate) * 1000);
      } else if ((audio as any).data && (audio as any).sampling_rate) {
        audioDurationMs = Math.round(((audio as any).data.length / (audio as any).sampling_rate) * 1000);
      }
      result.testAudioDurationMs = audioDurationMs;

      // Validate the audio looks reasonable
      const blob = audio.toBlob();
      const isValidSize = blob.size > 1000; // Should be at least 1KB for this sentence

      // Check real-time factor - generation must be faster than playback
      // RTF < 1 means generation is faster than real-time (good)
      // RTF > 1 means generation is slower than real-time (unusable)
      const rtf = audioDurationMs > 0 ? result.testGenerationTimeMs! / audioDurationMs : Infinity;
      const isFastEnough = rtf < 1.5; // Allow up to 1.5x real-time (some buffer for actual use)

      console.log(
        "[Kokoro Worker] Capability check - RTF:",
        rtf.toFixed(2),
        "generation:",
        result.testGenerationTimeMs,
        "ms, audio:",
        audioDurationMs,
        "ms"
      );

      if (isValidSize && isFastEnough) {
        result.testGenerationSuccess = true;
        result.available = true;
        console.log(
          "[Kokoro Worker] Capability check - Test generation successful in",
          result.testGenerationTimeMs,
          "ms, audio duration:",
          audioDurationMs,
          "ms, blob size:",
          blob.size
        );
      } else if (!isValidSize) {
        result.error = `Generated audio too small: ${blob.size} bytes`;
        console.warn("[Kokoro Worker] Capability check - Audio too small:", blob.size);
      } else {
        result.error = `Generation too slow (${rtf.toFixed(1)}x real-time). WebGPU required for real-time generation.`;
        console.warn("[Kokoro Worker] Capability check - Too slow, RTF:", rtf.toFixed(2));
      }
    } catch (genError) {
      result.error = genError instanceof Error ? genError.message : "Generation failed";
      console.error("[Kokoro Worker] Capability check - Generation error:", genError);
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : "Capability check failed";
    console.error("[Kokoro Worker] Capability check error:", error);
  }

  postMessage({ type: "capabilityResult", result });
}

/**
 * Handle messages from main thread.
 */
self.addEventListener("message", async (event: MessageEvent) => {
  const message = event.data as WorkerIncomingMessage;

  switch (message.type) {
    case "initialize":
      await initializeModel();
      break;

    case "generate":
      await generateSentence(message.request);
      break;

    case "cancelAll":
      // Currently, individual sentence generation is atomic and short.
      // Cancellation is handled by not processing further queue items on the main thread.
      break;

    case "capabilityCheck":
      await runCapabilityCheck();
      break;
  }
});
