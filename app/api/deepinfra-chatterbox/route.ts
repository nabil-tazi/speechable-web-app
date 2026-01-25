import { NextRequest, NextResponse } from "next/server";
import {
  checkCreditsForRequest,
  deductCreditsAfterOperation,
  CHATTERBOX_CHARACTERS_PER_CREDIT,
} from "@/app/api/lib/credits-middleware";

/**
 * Voice ID mapping from Kokoro voice names to cloned Chatterbox voice IDs.
 */
const VOICE_ID_MAP: Record<string, string> = {
  // American Female
  af_alloy: "syb7ffpd9565tzn0pp5x",
  af_aoede: "knc6he0gt4eza2crmp5t",
  af_bella: "bxcnvcv81ttejz4u713j",
  af_heart: "hlwub3vxkxtzjou06ri6",
  af_jessica: "c3o6dmvgf9sz5qww40ex",
  af_kore: "7x1a7508xjrtc1e21288",
  af_nicole: "vhhnf2holcgiv4s4f1oj",
  af_nova: "6oibmb8h2puuwykz6i8z",
  af_river: "ntd6usrk3fkyyd9h53t6",
  af_sarah: "wllwz6o3y4ubcupbls4v",
  af_sky: "ll0bb1lvkyjjys7t669r",
  // American Male
  am_adam: "qhcte4p1xmddgxb9zzma",
  am_echo: "m4gco941wdxgywah9se2",
  am_eric: "kzlsdm8ylm17ljlzv9xc",
  am_fenrir: "woxyjylnblubqzca4g1x",
  am_liam: "6nq3h4jwamuhjkrj3qke",
  am_michael: "v0b5esty84yip19ok0cp",
  am_onyx: "jhgzneik1gq6269eq3uu",
  am_puck: "jfc4qtyfi6yte79u9vig",
  am_santa: "h4da5pppyteofr7swtd9",
  // British Female
  bf_alice: "m8g9oaqr9q2hvjokeqz7",
  bf_emma: "c4gtv2tndc2qdpnsx0zw",
  bf_isabella: "q8thtgcuq488k17phegb",
  bf_lily: "frthre00k4c96wg5381e",
  // British Male
  bm_daniel: "fzaos9xo9anou4ptbhq4",
  bm_fable: "pfzxkku3j37ullyto7sf",
  bm_george: "koj17oa8to9gw10yn7wv",
  bm_lewis: "6tp1nku15xeiq6jvp4ud",
};

/**
 * DeepInfra Chatterbox TTS API endpoint.
 * Uses ResembleAI/chatterbox-turbo model for expressive TTS with emotion control.
 */
export async function POST(req: NextRequest) {
  const {
    input,
    voice = "af_sky",
    response_format = "mp3",
    cfg = 0.1,
    exaggeration = 1.0,
  }: {
    input: string;
    voice?: string;
    response_format?: string;
    cfg?: number;
    exaggeration?: number;
  } = await req.json();

  if (typeof input !== "string" || !input.trim()) {
    return NextResponse.json(
      { error: "Missing or empty input text" },
      { status: 400 }
    );
  }

  // Check credits before processing (Chatterbox: 1 credit = 1000 chars)
  const creditCheck = await checkCreditsForRequest({
    textLength: input.length,
    charactersPerCredit: CHATTERBOX_CHARACTERS_PER_CREDIT,
  });
  if (!creditCheck.success) {
    return creditCheck.response;
  }

  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) {
    console.error("[deepinfra-chatterbox] DEEPINFRA_API_KEY not configured");
    return NextResponse.json(
      { error: "TTS service not configured" },
      { status: 500 }
    );
  }

  // Map Kokoro voice name to Chatterbox voice ID
  const voiceId = VOICE_ID_MAP[voice] || VOICE_ID_MAP["af_sky"];
  if (!VOICE_ID_MAP[voice]) {
    console.warn(
      `[deepinfra-chatterbox] Unknown voice "${voice}", falling back to af_sky`
    );
  }

  try {
    const startTime = Date.now();

    const response = await fetch(
      "https://api.deepinfra.com/v1/openai/audio/speech",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "ResembleAI/chatterbox-turbo",
          voice: voiceId,
          input,
          response_format,
          cfg,
          exaggeration,
          serviceTier: "default",
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        "[deepinfra-chatterbox] API error:",
        response.status,
        errorText
      );
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

    // Stream the response directly to client instead of buffering
    console.log(
      `[deepinfra-chatterbox] Streaming response for voice ${voice} (id: ${voiceId}), cfg=${cfg}, exaggeration=${exaggeration}`
    );

    // Deduct credits after successful API response (Chatterbox: 1 credit = 1000 chars)
    const creditResult = await deductCreditsAfterOperation(
      creditCheck.userId,
      input.length,
      CHATTERBOX_CHARACTERS_PER_CREDIT
    );

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "X-Generation-Time-Ms": (Date.now() - startTime).toString(),
        "X-Credits-Used": (creditResult?.creditsUsed ?? 0).toString(),
        "X-Credits-Remaining": (creditResult?.creditsRemaining ?? 0).toString(),
      },
    });
  } catch (error) {
    console.error("[deepinfra-chatterbox] Error:", error);
    return NextResponse.json(
      { error: "TTS generation failed" },
      { status: 500 }
    );
  }
}
