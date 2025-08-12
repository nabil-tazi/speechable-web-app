import { NextRequest, NextResponse } from "next/server";
import gTTS from "gtts";

interface TTSRequestBody {
  input: string;
  lang?: string;
  slow?: boolean;
}

export async function POST(req: NextRequest) {
  let body: TTSRequestBody;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { input, lang = "en", slow = false } = body;

  if (typeof input !== "string" || input.trim() === "") {
    return NextResponse.json(
      { error: "Missing or invalid 'input' field" },
      { status: 400 }
    );
  }

  try {
    const tts = new gTTS(input, lang, slow);

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      tts
        .stream()
        .on("data", (chunk: Buffer) => chunks.push(chunk))
        .on("end", () => resolve())
        .on("error", (err: Error) => reject(err));
    });

    const audioBuffer = Buffer.concat(chunks);

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=31536000",
      },
    });
  } catch (error) {
    console.error("Error generating TTS:", error);
    return NextResponse.json(
      { error: "TTS generation failed" },
      { status: 500 }
    );
  }
}
