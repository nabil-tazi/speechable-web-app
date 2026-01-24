import { NextRequest, NextResponse } from "next/server";
import {
  checkCreditsForRequest,
  deductCreditsAfterOperation,
} from "@/app/api/lib/credits-middleware";

const SYSTEM_PROMPT = `You are a text processing assistant that improves text for natural-sounding speech.`;

const buildUserPrompt = (
  text: string,
  title?: string
) => `Rewrite the following text to sound more natural when spoken aloud.

${title ? `SECTION: "${title}"` : ""}

Guidelines:
- Make sentences flow naturally for speech
- Remove redundant phrases and filler content
- Maintain the original meaning and key information
- Fix awkward phrasing that doesn't work well in spoken form
- Keep technical terms but explain them naturally where needed
- Ensure proper punctuation for natural pauses

CRITICAL - Output format:
- Return ONLY the processed text, nothing else
- Do NOT include any explanations, notes, or commentary
- Do NOT use any markdown formatting (no **bold**, *italics*, headers, bullet points, numbered lists, etc.)
- Do NOT wrap the text in quotes or any other delimiters
- Do NOT add any prefixes like "Here is...", "Processed text:", etc.
- Output ONLY the natural-sounding version of the text

Text to process:
${text}`;

export async function POST(req: NextRequest) {
  const { text, title }: { text: string; title?: string } = await req.json();

  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json(
      { error: "Missing or empty text" },
      { status: 400 }
    );
  }

  // Check credits before processing
  const creditCheck = await checkCreditsForRequest({ textLength: text.length });
  if (!creditCheck.success) {
    return creditCheck.response;
  }

  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(
      "https://api.deepinfra.com/v1/openai/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "meta-llama/Llama-3.2-3B-Instruct",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(text, title) },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        "[deepinfra-text/natural] API error:",
        response.status,
        errorText
      );
      throw new Error(`DeepInfra API error: ${response.status}`);
    }

    const data = await response.json();
    let result = data.choices?.[0]?.message?.content?.trim();

    if (!result) {
      throw new Error("No content in response");
    }

    // Strip surrounding quotes if LLM wrapped the response
    if (
      (result.startsWith('"') && result.endsWith('"')) ||
      (result.startsWith("'") && result.endsWith("'"))
    ) {
      result = result.slice(1, -1);
    }

    // Deduct credits after successful operation
    const creditResult = await deductCreditsAfterOperation(
      creditCheck.userId,
      text.length
    );

    return NextResponse.json({
      result,
      creditsUsed: creditResult?.creditsUsed ?? 0,
      creditsRemaining: creditResult?.creditsRemaining ?? 0,
    });
  } catch (error) {
    console.error("[deepinfra-text/natural] Error:", error);
    return NextResponse.json(
      { error: "Natural text processing failed" },
      { status: 500 }
    );
  }
}
