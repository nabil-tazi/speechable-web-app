import { NextRequest, NextResponse } from "next/server";
import {
  checkCreditsForRequest,
  deductCreditsAfterOperation,
  KOKORO_CHARACTERS_PER_CREDIT,
} from "@/app/api/lib/credits-middleware";

/**
 * DeepInfra Kokoro TTS API endpoint.
 * Uses hexgrad/Kokoro-82M model for fast, reliable cloud TTS.
 */
export async function POST(req: NextRequest) {
  console.log("[deepinfra-kokoro] Request received");

  const {
    input,
    voice = "af_sky",
    response_format = "mp3",
  }: {
    input: string;
    voice?: string;
    response_format?: string;
  } = await req.json();

  console.log("[deepinfra-kokoro] Generating for voice:", voice, "text:", input.substring(0, 50));

  if (typeof input !== "string" || !input.trim()) {
    return NextResponse.json(
      { error: "Missing or empty input text" },
      { status: 400 }
    );
  }

  // Check credits before processing (Kokoro: 1 credit = 2000 chars)
  const creditCheck = await checkCreditsForRequest({
    textLength: input.length,
    charactersPerCredit: KOKORO_CHARACTERS_PER_CREDIT,
  });
  if (!creditCheck.success) {
    return creditCheck.response;
  }

  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) {
    console.error("[deepinfra-kokoro] DEEPINFRA_API_KEY not configured");
    return NextResponse.json(
      { error: "TTS service not configured" },
      { status: 500 }
    );
  }

  try {
    const startTime = Date.now();
    console.log("[deepinfra-kokoro] Calling DeepInfra API...");

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
          voice,
          input,
          response_format,
          serviceTier: "default",
        }),
      }
    );

    console.log("[deepinfra-kokoro] DeepInfra response status:", response.status);
    console.log("[deepinfra-kokoro] Response headers:", Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[deepinfra-kokoro] API error:", response.status, errorText);
      throw new Error(`DeepInfra API error: ${response.status}`);
    }

    const contentType =
      response_format === "mp3"
        ? "audio/mpeg"
        : response_format === "wav"
          ? "audio/wav"
          : response_format === "opus"
            ? "audio/opus"
            : "audio/mpeg";

    // Collect chunks from the stream
    console.log("[deepinfra-kokoro] Collecting audio chunks...");
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalSize += value.length;
      console.log(`[deepinfra-kokoro] Received chunk: ${value.length} bytes (total: ${totalSize})`);
    }

    // Combine chunks into a single buffer
    const audioBuffer = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      audioBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    const duration = Date.now() - startTime;
    console.log(`[deepinfra-kokoro] Generated ${totalSize} bytes in ${duration}ms for voice ${voice}`);

    // Deduct credits after successful generation (Kokoro: 1 credit = 2000 chars)
    const creditResult = await deductCreditsAfterOperation(
      creditCheck.userId,
      input.length,
      KOKORO_CHARACTERS_PER_CREDIT
    );

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": totalSize.toString(),
        "X-Generation-Time-Ms": duration.toString(),
        "X-Credits-Used": (creditResult?.creditsUsed ?? 0).toString(),
        "X-Credits-Remaining": (creditResult?.creditsRemaining ?? 0).toString(),
      },
    });
  } catch (error) {
    console.error("[deepinfra-kokoro] Error:", error);
    return NextResponse.json(
      { error: "TTS generation failed" },
      { status: 500 }
    );
  }
}
