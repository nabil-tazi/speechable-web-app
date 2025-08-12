import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { input }: { input: string } = await req.json();

  if (typeof input !== "string") {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-nano",
        messages: [
          {
            role: "system",
            content:
              "Without changing the meaning, clean up this text and rephrase slightly so it can feel natural when read out loud by a TTS model, replace the numbers with how they should be read in the given context.",
          },
          {
            role: "user",
            content: input,
          },
        ],
        temperature: 0,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const result = data.choices[0].message.content;

    return NextResponse.json({ message: result });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}

//"Without changing the meaning, the content, or the words, clean up this text so it can be read out loud by a TTS model"
// Sample PDF created for testing PDFObject. This PDF is three pages long. Three long pages, or three short pages if you're optimistic. Is it the same as saying "three long minutes," knowing that all minutes are the same duration and one cannot be longer than the other? If these pages are all the same size, can one possibly be longer than the other? I digress. Here's some Latin: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer nec odio. Praesent libero. Sed cursus ante da.

//"Without changing the meaning, clean up this text and rephrase slightly so it can feel natural when read out loud by a TTS model",
// This is a sample PDF created for testing PDFObject. The document is three pages long—whether they feel long or short depends on your perspective. You might think of it as three long pages, or perhaps three short ones if you're feeling optimistic. It's similar to saying "three long minutes," even though all minutes are the same length and none can be longer than the others. If all these pages are the same size, can one really be longer than the rest? I digress. Now, here's some Latin: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer nec odio. Praesent libero. Sed cursus ante dapibus.
