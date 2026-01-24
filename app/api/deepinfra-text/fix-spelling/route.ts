import { NextRequest, NextResponse } from "next/server";
import {
  checkCreditsForRequest,
  deductCreditsAfterOperation,
} from "@/app/api/lib/credits-middleware";

const SYSTEM_PROMPT = `You are a spelling and grammar correction assistant.`;

const buildUserPrompt = (
  text: string
) => `Fix spelling mistakes and grammatical errors in the following text.

Guidelines:
- Fix spelling mistakes
- Correct grammatical errors
- Fix punctuation issues
- Maintain the original meaning, tone, and style
- Do NOT change wording unless necessary for grammar
- Do NOT add or remove content

CRITICAL - Output format:
- Return ONLY the corrected text, nothing else
- Do NOT include any explanations, lists of changes, or commentary
- Do NOT use any markdown formatting (no **bold**, *italics*, headers, bullet points, numbered lists, etc.)
- Do NOT wrap the text in quotes or any other delimiters
- Do NOT add any prefixes like "Here is...", "Corrected text:", or "Corrections made:"
- Do NOT describe what changes were made
- Output ONLY the corrected version of the text, exactly as it should appear

Text to correct:
${text}`;

export async function POST(req: NextRequest) {
  const { text }: { text: string } = await req.json();

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
          // model: "mistralai/Mistral-Nemo-Instruct-2407", hallucinations
          model: "meta-llama/Llama-3.2-3B-Instruct", // cheapest, a bit slow
          // model: "meta-llama/Meta-Llama-3.1-8B-Instruct",

          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(text) },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        "[deepinfra-text/fix-spelling] API error:",
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
    console.error("[deepinfra-text/fix-spelling] Error:", error);
    return NextResponse.json(
      { error: "Spelling correction failed" },
      { status: 500 }
    );
  }
}
