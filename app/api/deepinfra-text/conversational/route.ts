import { NextRequest, NextResponse } from "next/server";
import {
  checkCreditsForRequest,
  deductCreditsAfterOperation,
} from "@/app/api/lib/credits-middleware";

const SYSTEM_PROMPT = `You are a conversational content transformer. Create engaging dialogues between exactly 2 speakers with strict alternation. Always respond with valid JSON.`;

const buildUserPrompt = (
  text: string,
  title?: string
) => `Transform this text into a natural conversation format suitable for text-to-speech.

${title ? `TOPIC: "${title}"` : ""}

Create an engaging dialogue between EXACTLY 2 speakers that makes the content accessible and interesting to listen to:

SPEAKER ROLES:
- The questioner introduces the conversation, asks thoughtful questions, and guides the discussion. Helps the expert cover important issues, methods, problems, findings, and results by asking strategic questions. Keeps responses brief and focused on facilitating the expert's explanations. (reader_id: "questioner")

- The expert provides extensive, detailed answers to the questioner's inquiries. Can give longer, comprehensive responses that thoroughly explain concepts, data, methods, and findings. Should cover all the substantive content from the original text. (reader_id: "expert")

CONVERSATION FLOW:
- MUST alternate between questioner and expert - no consecutive speeches from the same speaker
- Questioner asks questions or makes brief comments to guide the conversation
- Expert provides detailed, informative responses
- Expert can have longer speeches (multiple sentences/paragraphs) while questioner keeps contributions shorter
- Ensure natural back-and-forth rhythm throughout

Guidelines:
- Use natural, conversational language with appropriate transitions
- Ensure STRICT alternation between speakers (questioner -> expert -> questioner -> expert)
- Include ALL content from the original text through the expert's responses
- Do not omit any important information, concepts, data, examples, or specific details
- Questioner should ask about key topics, methods, problems, findings, and results
- Expert should provide comprehensive explanations covering all source material

CRITICAL - Output format:
Return ONLY a JSON object in this exact format, nothing else:
{
  "dialogue": [
    {"text": "Speaker's dialogue here", "reader_id": "questioner"},
    {"text": "Speaker's response here", "reader_id": "expert"},
    ...
  ]
}

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
        "[deepinfra-text/conversational] API error:",
        response.status,
        errorText
      );
      throw new Error(`DeepInfra API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new Error("No content in response");
    }

    // Parse JSON response
    let dialogue;
    try {
      // Try direct parse first
      const parsed = JSON.parse(content);
      dialogue = parsed.dialogue;
    } catch {
      // Try to extract JSON from response if wrapped in other text
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        dialogue = parsed.dialogue;
      } else {
        throw new Error("Could not parse dialogue JSON from response");
      }
    }

    if (!Array.isArray(dialogue) || dialogue.length === 0) {
      throw new Error("Invalid dialogue format in response");
    }

    // Validate dialogue structure
    for (const item of dialogue) {
      if (!item.text || !item.reader_id) {
        throw new Error("Invalid dialogue item structure");
      }
      if (item.reader_id !== "questioner" && item.reader_id !== "expert") {
        // Normalize reader_id if needed
        item.reader_id = item.reader_id.toLowerCase().includes("question")
          ? "questioner"
          : "expert";
      }
    }

    // Deduct credits after successful operation
    const creditResult = await deductCreditsAfterOperation(
      creditCheck.userId,
      text.length
    );

    return NextResponse.json({
      dialogue,
      creditsUsed: creditResult?.creditsUsed ?? 0,
      creditsRemaining: creditResult?.creditsRemaining ?? 0,
    });
  } catch (error) {
    console.error("[deepinfra-text/conversational] Error:", error);
    return NextResponse.json(
      { error: "Conversational transformation failed" },
      { status: 500 }
    );
  }
}
