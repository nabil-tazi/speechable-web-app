import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase/server";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { checkCredits, deductCredits, refundCredits } from "@/app/features/credits/service";
import { PROCESSING_ARRAY } from "@/app/features/pdf/types";
import { convertProcessedTextToBlocks } from "@/app/features/block-editor";
import type { ProcessedText, ProcessedSection, Block } from "@/app/features/documents/types";
import type { SupabaseClient } from "@supabase/supabase-js";

// Credit rate for text processing
const CHARACTERS_PER_CREDIT = 10000;

interface GenerateVersionRequest {
  documentId: string;
  processingLevel: 0 | 1 | 2 | 3;
  existingVersionCount: number;
}

// Helper to create ProcessedSection from text
function createSectionFromText(text: string, title: string): ProcessedSection {
  return {
    title,
    content: {
      speech: [{ text, reader_id: "Narrator" }],
    },
  };
}

// Helper to create ProcessedSection from dialogue
function createSectionFromDialogue(
  dialogue: { text: string; reader_id: string }[],
  title: string
): ProcessedSection {
  return {
    title,
    content: {
      speech: dialogue,
    },
  };
}

// Extract plain text from processed_text structure
function extractTextFromProcessedText(processedText: ProcessedText): string {
  if (!processedText?.processed_text?.sections) {
    return "";
  }

  return processedText.processed_text.sections
    .map((section) => {
      const title = section.title ? section.title + "\n\n" : "";
      const content = section.content.speech.map((s) => s.text).join(" ");
      return title + content;
    })
    .join("\n\n");
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  // Get authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  const { documentId, processingLevel, existingVersionCount }: GenerateVersionRequest =
    await req.json();

  // Validate processing level
  if (![0, 1, 2, 3].includes(processingLevel)) {
    return NextResponse.json(
      { error: "Invalid processing level" },
      { status: 400 }
    );
  }

  // Get document with processed_text
  const { data: document, error: docError } = await supabase
    .from("documents")
    .select("id, user_id, processed_text, title")
    .eq("id", documentId)
    .eq("user_id", user.id)
    .single();

  if (docError || !document) {
    return NextResponse.json(
      { error: "Document not found or access denied" },
      { status: 404 }
    );
  }

  if (!document.processed_text) {
    return NextResponse.json(
      { error: "Document has no processed text" },
      { status: 400 }
    );
  }

  const processedText = document.processed_text as ProcessedText;
  const rawInputText = extractTextFromProcessedText(processedText);

  // Check credits (only for AI processing levels 1-3)
  let newCreditBalance: number | null = null;
  if (processingLevel > 0) {
    const creditsNeeded = rawInputText.length / CHARACTERS_PER_CREDIT;
    const creditInfo = await checkCredits(user.id);

    if (!creditInfo) {
      return NextResponse.json(
        { error: "Failed to check credits" },
        { status: 500 }
      );
    }

    if (creditInfo.credits < creditsNeeded) {
      return NextResponse.json(
        {
          error: "Insufficient credits",
          creditsNeeded,
          creditsAvailable: creditInfo.credits,
        },
        { status: 402 }
      );
    }

    // Deduct credits immediately to prevent concurrent overspend
    const deductionResult = await deductCredits(user.id, creditsNeeded);
    if (!deductionResult?.success) {
      return NextResponse.json(
        { error: "Failed to deduct credits" },
        { status: 500 }
      );
    }
    newCreditBalance = deductionResult.newBalance;
  }

  // Generate version name
  const versionName =
    PROCESSING_ARRAY[processingLevel].name +
    (existingVersionCount > 0 ? " " + (existingVersionCount + 1) : "");

  // Create pending version
  const { data: pendingVersion, error: versionError } = await supabase
    .from("document_versions")
    .insert({
      document_id: documentId,
      version_name: versionName,
      processing_type: processingLevel.toString(),
      status: "pending",
      streaming_text: "",
      processing_progress: 0,
    })
    .select()
    .single();

  if (versionError || !pendingVersion) {
    return NextResponse.json(
      { error: "Failed to create version" },
      { status: 500 }
    );
  }

  // Return version ID immediately - processing happens in background
  const response = NextResponse.json({
    versionId: pendingVersion.id,
    status: "pending",
    ...(newCreditBalance !== null && { newCreditBalance }),
  });

  // Start background processing (non-blocking)
  // Use admin client for background processing since the request context will be closed
  const creditsToRefund = processingLevel > 0 ? rawInputText.length / CHARACTERS_PER_CREDIT : 0;
  processVersionInBackground(
    user.id,
    pendingVersion.id,
    processingLevel,
    processedText,
    rawInputText,
    document.title || "Document",
    creditsToRefund
  );

  return response;
}

// Background processing function
async function processVersionInBackground(
  userId: string,
  versionId: string,
  processingLevel: 0 | 1 | 2 | 3,
  processedText: ProcessedText,
  rawInputText: string,
  documentTitle: string,
  creditsToRefund: number
) {
  // Create admin client for background processing (bypasses RLS, works after response is sent)
  const adminClient = createAdminClient();

  try {
    console.log(`[generate-version] Starting background processing for version ${versionId}`);

    // Update status to processing
    const { error: updateError } = await adminClient
      .from("document_versions")
      .update({ status: "processing", processing_progress: 5 })
      .eq("id", versionId);

    if (updateError) {
      console.error(`[generate-version] Failed to update status:`, updateError);
    }

    let processedResult: { cleanedText: ProcessedText; metadata: Record<string, any> };

    if (processingLevel === 0) {
      // Level 0: Original - use existing processed_text as-is
      processedResult = {
        cleanedText: processedText,
        metadata: {
          processingLevel,
          source: "document_processed_text",
          totalSections: processedText.processed_text?.sections?.length || 0,
        },
      };

      await adminClient
        .from("document_versions")
        .update({ processing_progress: 90 })
        .eq("id", versionId);
    } else if (processingLevel === 1) {
      // Level 1: Natural - section-based streaming
      processedResult = await processNaturalWithStreaming(
        adminClient,
        versionId,
        rawInputText,
        documentTitle
      );
    } else if (processingLevel === 2) {
      // Level 2: Lecture - full document streaming
      processedResult = await processLectureWithStreaming(
        adminClient,
        versionId,
        rawInputText,
        documentTitle
      );
    } else if (processingLevel === 3) {
      // Level 3: Conversational - no text streaming (JSON output)
      processedResult = await processConversational(
        adminClient,
        versionId,
        rawInputText,
        documentTitle
      );
    } else {
      throw new Error(`Invalid processing level: ${processingLevel}`);
    }

    // Convert to blocks
    const processedTextJson = JSON.stringify(processedResult.cleanedText);
    const blocks = convertProcessedTextToBlocks(processedTextJson);

    // Finalize version
    await adminClient
      .from("document_versions")
      .update({
        blocks,
        status: "completed",
        streaming_text: "",
        processing_progress: 100,
        processing_metadata: processedResult.metadata,
      })
      .eq("id", versionId);

    console.log(`[generate-version] Version ${versionId} completed successfully`);
  } catch (error) {
    console.error(`[generate-version] Error processing version ${versionId}:`, error);

    // Refund credits on failure
    if (creditsToRefund > 0) {
      console.log(`[generate-version] Refunding ${creditsToRefund} credits to user ${userId}`);
      await refundCredits(userId, creditsToRefund);
    }

    // Delete the failed version
    await adminClient
      .from("document_versions")
      .delete()
      .eq("id", versionId);
  }
}

// Natural processing with streaming
async function processNaturalWithStreaming(
  supabase: SupabaseClient,
  versionId: string,
  rawInputText: string,
  documentTitle: string
): Promise<{ cleanedText: ProcessedText; metadata: Record<string, any> }> {
  // First, identify sections
  const sectionResponse = await fetch(
    `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/api/identify-sections`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: rawInputText }),
    }
  );

  if (!sectionResponse.ok) {
    throw new Error("Failed to identify sections");
  }

  const sectionData = await sectionResponse.json();
  const structuredDocument: { title: string; content: string }[] =
    sectionData.structuredDocument || [];

  if (structuredDocument.length === 0) {
    throw new Error("No sections identified in document");
  }

  const processedSections: ProcessedSection[] = [];
  let accumulatedText = "";
  const totalSections = structuredDocument.length;

  // Process sections with streaming updates
  for (let i = 0; i < structuredDocument.length; i++) {
    const { title, content } = structuredDocument[i];
    const progress = Math.round(10 + (i / totalSections) * 80);

    // Update progress
    await supabase
      .from("document_versions")
      .update({
        processing_progress: progress,
        streaming_text: accumulatedText + `\n\n[Processing: ${title}...]`,
      })
      .eq("id", versionId);

    // Stream this section
    const sectionText = await streamNaturalSection(
      supabase,
      versionId,
      content,
      title,
      accumulatedText
    );

    const section = createSectionFromText(sectionText, title);
    processedSections.push(section);

    // Update accumulated text
    accumulatedText += (accumulatedText ? "\n\n" : "") + (title ? `## ${title}\n\n` : "") + sectionText;

    // Update with completed section
    await supabase
      .from("document_versions")
      .update({ streaming_text: accumulatedText })
      .eq("id", versionId);
  }

  return {
    cleanedText: { processed_text: { sections: processedSections } },
    metadata: { processingLevel: 1, totalSections: processedSections.length },
  };
}

// Stream a single natural section
async function streamNaturalSection(
  supabase: SupabaseClient,
  versionId: string,
  content: string,
  title: string,
  previousText: string
): Promise<string> {
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) {
    throw new Error("DeepInfra API key not configured");
  }

  const systemPrompt = `You are a text processing assistant that improves text for natural-sounding speech.`;
  const userPrompt = `Rewrite the following text to sound more natural when spoken aloud.

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
${content}`;

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
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`DeepInfra API error: ${response.status}`);
  }

  // Process SSE stream
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let result = "";
  let updateCounter = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            result += content;
            updateCounter++;

            // Update streaming text every 10 chunks
            if (updateCounter % 10 === 0) {
              const displayText = previousText + (previousText ? "\n\n" : "") +
                (title ? `## ${title}\n\n` : "") + result;
              await supabase
                .from("document_versions")
                .update({ streaming_text: displayText })
                .eq("id", versionId);
            }
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }

  // Clean up result
  if (
    (result.startsWith('"') && result.endsWith('"')) ||
    (result.startsWith("'") && result.endsWith("'"))
  ) {
    result = result.slice(1, -1);
  }

  return result.trim();
}

// Lecture processing with streaming
async function processLectureWithStreaming(
  supabase: SupabaseClient,
  versionId: string,
  rawInputText: string,
  documentTitle: string
): Promise<{ cleanedText: ProcessedText; metadata: Record<string, any> }> {
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) {
    throw new Error("DeepInfra API key not configured");
  }

  await supabase
    .from("document_versions")
    .update({ processing_progress: 10 })
    .eq("id", versionId);

  const systemPrompt = `You are an educational content transformer that restructures text into lecture format.`;
  const userPrompt = `Transform the following text into an educational lecture format optimized for learning and memorization.

${documentTitle ? `TOPIC: "${documentTitle}"` : ""}

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
${rawInputText}`;

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
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`DeepInfra API error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let result = "";
  let updateCounter = 0;
  const expectedLength = rawInputText.length * 0.8; // Estimate output length

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            result += content;
            updateCounter++;

            // Update streaming text and progress every 10 chunks
            if (updateCounter % 10 === 0) {
              const progress = Math.min(
                90,
                Math.round(10 + (result.length / expectedLength) * 80)
              );
              await supabase
                .from("document_versions")
                .update({
                  streaming_text: result,
                  processing_progress: progress,
                })
                .eq("id", versionId);
            }
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }

  // Clean up result
  if (
    (result.startsWith('"') && result.endsWith('"')) ||
    (result.startsWith("'") && result.endsWith("'"))
  ) {
    result = result.slice(1, -1);
  }

  const section = createSectionFromText(result.trim(), "");

  return {
    cleanedText: { processed_text: { sections: [section] } },
    metadata: { processingLevel: 2, processingMethod: "deepinfra-lecture-streaming" },
  };
}

// Conversational processing (no streaming - JSON output)
async function processConversational(
  supabase: SupabaseClient,
  versionId: string,
  rawInputText: string,
  documentTitle: string
): Promise<{ cleanedText: ProcessedText; metadata: Record<string, any> }> {
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) {
    throw new Error("DeepInfra API key not configured");
  }

  await supabase
    .from("document_versions")
    .update({
      processing_progress: 20,
      streaming_text: "Generating dialogue...",
    })
    .eq("id", versionId);

  const systemPrompt = `You are a conversational content transformer. Create engaging dialogues between exactly 2 speakers with strict alternation. Always respond with valid JSON.`;

  const userPrompt = `Transform this text into a natural conversation format suitable for text-to-speech.

${documentTitle ? `TOPIC: "${documentTitle}"` : ""}

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
${rawInputText}`;

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
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[processConversational] DeepInfra API error:", response.status, errorText);
    throw new Error(`DeepInfra API error: ${response.status}`);
  }

  await supabase
    .from("document_versions")
    .update({ processing_progress: 80 })
    .eq("id", versionId);

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("No content in response");
  }

  // Parse JSON response
  let dialogue;
  const jsonStr = content.match(/\{[\s\S]*\}/)?.[0] || content;
  try {
    const parsed = JSON.parse(jsonStr);
    dialogue = parsed.dialogue;
  } catch {
    // Attempt to fix common LLM JSON issues: unescaped quotes in values
    try {
      const fixed = jsonStr.replace(
        /"text"\s*:\s*"([\s\S]*?)"\s*,\s*"reader_id"/g,
        (_match: string, textContent: string) => {
          const escaped = textContent.replace(/(?<!\\)"/g, '\\"');
          return `"text": "${escaped}", "reader_id"`;
        }
      );
      const parsed = JSON.parse(fixed);
      dialogue = parsed.dialogue;
    } catch (e2) {
      console.error("[processConversational] JSON parse failed. Raw content:", content);
      throw new Error("Could not parse dialogue JSON from response");
    }
  }

  if (!Array.isArray(dialogue) || dialogue.length === 0) {
    throw new Error("Invalid dialogue format in response");
  }

  // Normalize reader_ids
  for (const item of dialogue) {
    if (!item.text || !item.reader_id) {
      throw new Error("Invalid dialogue item structure");
    }
    if (item.reader_id !== "questioner" && item.reader_id !== "expert") {
      item.reader_id = item.reader_id.toLowerCase().includes("question")
        ? "questioner"
        : "expert";
    }
  }

  const section = createSectionFromDialogue(dialogue, "");

  return {
    cleanedText: { processed_text: { sections: [section] } },
    metadata: {
      processingLevel: 3,
      processingMethod: "deepinfra-conversational",
      dialogueCount: dialogue.length,
    },
  };
}
