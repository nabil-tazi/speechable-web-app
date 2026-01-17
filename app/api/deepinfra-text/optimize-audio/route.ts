import { NextRequest, NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are a text-to-speech optimization assistant.`;

const buildUserPrompt = (
  text: string
) => `Rewrite the following text to sound better when read aloud by a TTS system.

Guidelines:
- Expand abbreviations (e.g., "Dr." → "Doctor", "vs." → "versus")
- Spell out numbers in a natural way (e.g., "100" → "one hundred")
- Replace symbols with words (e.g., "&" → "and", "%" → "percent")
- Break up long, complex sentences into shorter ones
- Remove or replace text that doesn't translate well to speech (URLs, email addresses, etc.)
- Ensure proper punctuation for natural pauses
- Keep the meaning and tone intact

CRITICAL - Output format:
- Return ONLY the optimized text, nothing else
- Do NOT include any explanations, notes, or commentary
- Do NOT use any markdown formatting (no **bold**, *italics*, headers, bullet points, numbered lists, etc.)
- Do NOT wrap the text in quotes or any other delimiters
- Do NOT add any prefixes like "Here is...", "Optimized text:", or "Here's the rewritten version:"
- Do NOT describe what changes were made
- Output ONLY the optimized version of the text, exactly as it should appear

Text to optimize:
${text}`;

export async function POST(req: NextRequest) {
  const { text }: { text: string } = await req.json();

  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json(
      { error: "Missing or empty text" },
      { status: 400 }
    );
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
        "[deepinfra-text/optimize-audio] API error:",
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

    return NextResponse.json({ result });
  } catch (error) {
    console.error("[deepinfra-text/optimize-audio] Error:", error);
    return NextResponse.json(
      { error: "Audio optimization failed" },
      { status: 500 }
    );
  }
}
