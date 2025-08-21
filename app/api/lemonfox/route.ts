import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const {
    input,
    voice = "nicole",
    response_format = "mp3",
    word_timestamps = false,
  }: {
    input: string;
    voice?: string;
    response_format?: string;
    word_timestamps?: boolean;
  } = await req.json();

  if (typeof input !== "string") {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  try {
    const response = await fetch("https://api.lemonfox.ai/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.LEMONFOX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input,
        voice,
        response_format,
        word_timestamps,
      }),
    });

    if (!response.ok) {
      throw new Error(`LemonFox AI API error: ${response.status}`);
    }

    // Get the audio buffer from the response
    const audioBuffer = await response.arrayBuffer();

    // Return the audio file with appropriate headers
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": response_format === "mp3" ? "audio/mpeg" : "audio/wav",
        "Cache-Control": "public, max-age=31536000", // Cache for 1 year
        // Optional: Add content-disposition header for download filename
        // "Content-Disposition": `attachment; filename="speech.${response_format}"`,
      },
    });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}
