import { NextRequest, NextResponse } from "next/server";
import {
  checkCreditsForRequest,
  deductCreditsAfterOperation,
} from "@/app/api/lib/credits-middleware";

const SYSTEM_PROMPT = `You are an educational content transformer that restructures text into lecture format.`;

const buildUserPrompt = (
  text: string,
  title?: string
) => `Transform the following text into an educational lecture format optimized for learning and memorization.

${title ? `TOPIC: "${title}"` : ""}

Guidelines:
- Restructure content for educational delivery
- Emphasize key concepts and main ideas
- Add natural transitions between topics
- Pace information for better comprehension and retention
- Use clear, explanatory language
- Highlight important terms and definitions
- Create logical flow from introduction to conclusion
- Remove content that doesn't contribute to learning

CRITICAL - Output format:
- Return ONLY the lecture text, nothing else
- Do NOT include any explanations, notes, or commentary
- Do NOT use any markdown formatting (no **bold**, *italics*, headers, bullet points, numbered lists, etc.)
- Do NOT wrap the text in quotes or any other delimiters
- Do NOT add any prefixes like "Here is...", "Lecture:", etc.
- Output ONLY the lecture-formatted version of the text

Text to transform:
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
        "[deepinfra-text/lecture] API error:",
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
    console.error("[deepinfra-text/lecture] Error:", error);
    return NextResponse.json(
      { error: "Lecture transformation failed" },
      { status: 500 }
    );
  }
}
