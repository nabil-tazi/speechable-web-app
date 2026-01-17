import { NextResponse } from "next/server";

/**
 * Health check for Kokoro TTS model (standard mode).
 */
export async function GET() {
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { status: "error", error: "DEEPINFRA_API_KEY not configured" },
      { status: 500 }
    );
  }

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const response = await fetch(
      "https://api.deepinfra.com/v1/openai/audio/speech",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "hexgrad/Kokoro-82M",
          voice: "af_sky",
          input: ".",
          response_format: "mp3",
          serviceTier: "default",
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      clearTimeout(timeoutId);
      return NextResponse.json(
        { status: "error", latencyMs: Date.now() - startTime, error: `HTTP ${response.status}` },
        { status: 503 }
      );
    }

    // Must consume the body to confirm generation completes
    await response.arrayBuffer();
    clearTimeout(timeoutId);

    return NextResponse.json({
      status: "ok",
      latencyMs: Date.now() - startTime,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { status: "down", latencyMs, error: "Timeout - model not responding" },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { status: "error", latencyMs, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 503 }
    );
  }
}
