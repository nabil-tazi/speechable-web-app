import { NextRequest, NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are a text summarization assistant.`;

const buildUserPrompt = (
  text: string
) => `Condense the following text while preserving the key information and main ideas.

Guidelines:
- Maintain the original meaning and tone
- Remove redundant information
- Keep important details and key points
- Aim for approximately 30-50% of the original length

CRITICAL - Output format:
- Return ONLY the summarized text, nothing else
- Do NOT include any explanations, notes, or commentary
- Do NOT use any markdown formatting (no **bold**, *italics*, headers, bullet points, numbered lists, etc.)
- Do NOT wrap the text in quotes or any other delimiters
- Do NOT add any prefixes like "Here is...", "Summary:", or "Here's a summary:"
- Do NOT describe what was removed or changed
- Output ONLY the summarized version of the text, exactly as it should appear

Text to summarize:
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
        "[deepinfra-text/summarize] API error:",
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
    console.error("[deepinfra-text/summarize] Error:", error);
    return NextResponse.json(
      { error: "Summarization failed" },
      { status: 500 }
    );
  }
}
