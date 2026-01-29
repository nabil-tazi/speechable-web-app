import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase/server";
import { createAdminClient } from "@/app/lib/supabase/admin";
import {
  checkCredits,
  deductCredits,
  refundCredits,
} from "@/app/features/credits/service";
import {
  PROCESSING_ARRAY,
  LECTURE_DURATIONS,
  CONVERSATIONAL_DURATIONS,
  MAX_VERSIONS_PER_DOCUMENT,
  type LectureDuration,
  type ConversationalDuration,
} from "@/app/features/pdf/types";
import { getLanguageConfig } from "@/app/features/audio/supported-languages";
import { convertProcessedTextToBlocks } from "@/app/features/block-editor";
import { calculateCredits } from "@/app/features/credits/calculate";
import type {
  ProcessedText,
  ProcessedSection,
  Block,
} from "@/app/features/documents/types";
import type { SupabaseClient } from "@supabase/supabase-js";


interface GenerateVersionRequest {
  documentId: string;
  processingLevel: 0 | 1 | 2 | 3;
  existingVersionCount: number;
  targetLanguage?: string;
  lectureDuration?: LectureDuration;
  conversationalDuration?: ConversationalDuration;
  versionName?: string;
}

// Helper to create ProcessedSection from text
function createSectionFromText(text: string, title: string): ProcessedSection {
  // Split into paragraphs so each becomes its own block
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return {
    title,
    content: {
      speech:
        paragraphs.length > 0
          ? paragraphs.map((p) => ({ text: p, reader_id: "Narrator" }))
          : [{ text, reader_id: "Narrator" }],
    },
  };
}

// Helper to create ProcessedSection from dialogue
function createSectionFromDialogue(
  dialogue: { text: string; reader_id: string }[],
  title: string,
): ProcessedSection {
  return {
    title,
    content: {
      speech: dialogue,
    },
  };
}

// Decode common HTML entities in AI output
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
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
      { status: 401 },
    );
  }

  const {
    documentId,
    processingLevel,
    existingVersionCount,
    targetLanguage,
    lectureDuration,
    conversationalDuration,
    versionName: customVersionName,
  }: GenerateVersionRequest = await req.json();

  // Validate processing level
  if (![0, 1, 2, 3].includes(processingLevel)) {
    return NextResponse.json(
      { error: "Invalid processing level" },
      { status: 400 },
    );
  }

  // Get document with processed_text
  const { data: document, error: docError } = await supabase
    .from("documents")
    .select("id, user_id, processed_text, title, language")
    .eq("id", documentId)
    .eq("user_id", user.id)
    .single();

  if (docError || !document) {
    return NextResponse.json(
      { error: "Document not found or access denied" },
      { status: 404 },
    );
  }

  if (!document.processed_text) {
    return NextResponse.json(
      { error: "Document has no processed text" },
      { status: 400 },
    );
  }

  // Check version limit (max 15 per document)
  const { count: versionCount } = await supabase
    .from("document_versions")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId);

  if (versionCount !== null && versionCount >= MAX_VERSIONS_PER_DOCUMENT) {
    return NextResponse.json(
      { error: `Maximum of ${MAX_VERSIONS_PER_DOCUMENT} versions per document reached` },
      { status: 400 },
    );
  }

  const processedText = document.processed_text as ProcessedText;
  const rawInputText = extractTextFromProcessedText(processedText);

  // Determine if translation is needed
  const documentLanguage = document.language || "en";
  const resolvedTargetLanguage = targetLanguage || documentLanguage;
  const needsTranslation = resolvedTargetLanguage !== documentLanguage;

  // Calculate credits needed based on processing type
  const creditsCharged = calculateCredits({
    textLength: rawInputText.length,
    processingLevel,
    needsTranslation,
    lectureDuration: lectureDuration || "medium",
    conversationalDuration: conversationalDuration || "medium",
  });
  let newCreditBalance: number | null = null;

  if (creditsCharged > 0) {
    const creditInfo = await checkCredits(user.id);

    if (!creditInfo) {
      return NextResponse.json(
        { error: "Failed to check credits" },
        { status: 500 },
      );
    }

    if (creditInfo.credits < creditsCharged) {
      return NextResponse.json(
        {
          error: "Insufficient credits",
          creditsNeeded: creditsCharged,
          creditsAvailable: creditInfo.credits,
        },
        { status: 402 },
      );
    }

    // Deduct credits immediately to prevent concurrent overspend
    const deductionResult = await deductCredits(user.id, creditsCharged);
    if (!deductionResult?.success) {
      return NextResponse.json(
        { error: "Failed to deduct credits" },
        { status: 500 },
      );
    }
    newCreditBalance = deductionResult.newBalance;
  }

  // Generate version name
  const versionName = customVersionName
    ? customVersionName
    : (() => {
        const langSuffix = needsTranslation
          ? ` (${getLanguageConfig(resolvedTargetLanguage).name})`
          : "";
        return PROCESSING_ARRAY[processingLevel].name +
          (existingVersionCount > 0 ? " " + (existingVersionCount + 1) : "") +
          langSuffix;
      })();

  // Create pending version
  const { data: pendingVersion, error: versionError } = await supabase
    .from("document_versions")
    .insert({
      document_id: documentId,
      version_name: versionName,
      language: resolvedTargetLanguage,
      processing_type: processingLevel.toString(),
      status: "pending",
      streaming_text: "",
      processing_progress: 0,
      credits_charged: creditsCharged,
    })
    .select()
    .single();

  if (versionError || !pendingVersion) {
    return NextResponse.json(
      { error: "Failed to create version" },
      { status: 500 },
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
  processVersionInBackground(
    user.id,
    pendingVersion.id,
    processingLevel,
    processedText,
    rawInputText,
    document.title || "Document",
    resolvedTargetLanguage,
    documentLanguage,
    lectureDuration || "medium",
    conversationalDuration || "medium",
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
  targetLanguage: string,
  documentLanguage: string,
  lectureDuration: LectureDuration = "medium",
  conversationalDuration: ConversationalDuration = "medium",
) {
  // Create admin client for background processing (bypasses RLS, works after response is sent)
  const adminClient = createAdminClient();

  try {
    console.log(
      `[generate-version] Starting background processing for version ${versionId}`,
    );

    // Update status to processing
    const { error: updateError } = await adminClient
      .from("document_versions")
      .update({ status: "processing", processing_progress: 5 })
      .eq("id", versionId);

    if (updateError) {
      console.error(`[generate-version] Failed to update status:`, updateError);
    }

    let processedResult: {
      cleanedText: ProcessedText;
      metadata: Record<string, any>;
    };

    const needsTranslation = targetLanguage !== documentLanguage;

    if (processingLevel === 0) {
      if (needsTranslation) {
        // Level 0 with translation: translate each section
        processedResult = await processTranslation(
          adminClient,
          versionId,
          processedText,
          targetLanguage,
        );
      } else {
        // Level 0: Original - use existing processed_text as-is
        processedResult = {
          cleanedText: processedText,
          metadata: {
            processingLevel,
            source: "document_processed_text",
            totalSections: processedText.processed_text?.sections?.length || 0,
          },
        };
      }

      await adminClient
        .from("document_versions")
        .update({ processing_progress: 90 })
        .eq("id", versionId);
    } else if (processingLevel === 1) {
      // Level 1: Natural - section-based streaming using existing sections
      processedResult = await processNaturalWithStreaming(
        adminClient,
        versionId,
        rawInputText,
        documentTitle,
        targetLanguage,
        processedText,
      );
    } else if (processingLevel === 2) {
      // Level 2: Lecture - full document streaming
      processedResult = await processLectureWithStreaming(
        adminClient,
        versionId,
        rawInputText,
        documentTitle,
        targetLanguage,
        lectureDuration,
      );
    } else if (processingLevel === 3) {
      // Level 3: Conversational - two-step approach like Lecture
      processedResult = await processConversational(
        adminClient,
        versionId,
        rawInputText,
        documentTitle,
        targetLanguage,
        conversationalDuration,
      );
    } else {
      throw new Error(`Invalid processing level: ${processingLevel}`);
    }

    // Convert to blocks
    // For Lecture (2) and Conversational (3), skip TTS for headings
    const processedTextJson = JSON.stringify(processedResult.cleanedText);
    const headingReaderId = processingLevel === 2 || processingLevel === 3 ? "skip" : undefined;
    const blocks = convertProcessedTextToBlocks(processedTextJson, { headingReaderId });

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

    console.log(
      `[generate-version] Version ${versionId} completed successfully`,
    );
  } catch (error) {
    console.error(
      `[generate-version] Error processing version ${versionId}:`,
      error,
    );

    // Fetch credits_charged from the version record for refund
    const { data: version } = await adminClient
      .from("document_versions")
      .select("credits_charged")
      .eq("id", versionId)
      .single();

    const creditsToRefund = version?.credits_charged ?? 0;

    if (creditsToRefund > 0) {
      console.log(
        `[generate-version] Refunding ${creditsToRefund} credits to user ${userId}`,
      );
      await refundCredits(userId, creditsToRefund);
    }

    // Delete the failed version
    await adminClient.from("document_versions").delete().eq("id", versionId);
  }
}

// Shared streaming helper for section content processing (translation and natural)
async function streamSectionContent(
  supabase: SupabaseClient,
  versionId: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  previousText: string,
  progressBase: number,
  progressWeight: number,
  maxTokens: number,
): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  const response = await fetch(
    "https://api.deepinfra.com/v1/openai/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        reasoning_effort: "low",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
        max_tokens: maxTokens,
        repetition_penalty: 1.3,
      }),
    },
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
  let repetitionDetected = false;
  let promptTokens = 0;
  let completionTokens = 0;

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
          if (parsed.usage) {
            promptTokens = parsed.usage.prompt_tokens || 0;
            completionTokens = parsed.usage.completion_tokens || 0;
          }
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            result += content;
            updateCounter++;

            // Detect repetition loops every 100 chunks
            if (updateCounter % 100 === 0 && result.length > 500) {
              const tail = result.slice(-300);
              const preceding = result.slice(0, -300);
              if (preceding.includes(tail)) {
                console.warn(
                  `[streamSectionContent] Repetition detected, truncating`,
                );
                const firstIdx = preceding.indexOf(tail);
                result = result.slice(0, firstIdx + tail.length);
                repetitionDetected = true;
                break;
              }
            }

            // Update streaming text every 10 chunks
            if (updateCounter % 10 === 0) {
              const displayText =
                previousText + (previousText ? "\n\n" : "") + result;
              const progress = Math.min(
                90,
                progressBase + Math.round(progressWeight * (updateCounter / 200)),
              );
              await supabase
                .from("document_versions")
                .update({
                  streaming_text: displayText,
                  processing_progress: progress,
                })
                .eq("id", versionId);
            }
          }
        } catch {
          // Skip invalid JSON
        }
      }
      if (repetitionDetected) break;
    }
    if (repetitionDetected) {
      reader.cancel();
      break;
    }
  }

  // Clean up
  if (
    (result.startsWith('"') && result.endsWith('"')) ||
    (result.startsWith("'") && result.endsWith("'"))
  ) {
    result = result.slice(1, -1);
  }

  return { text: decodeHtmlEntities(result.trim()), promptTokens, completionTokens };
}

// Translation processing for Original with different target language
async function processTranslation(
  supabase: SupabaseClient,
  versionId: string,
  processedText: ProcessedText,
  targetLanguage: string,
): Promise<{ cleanedText: ProcessedText; metadata: Record<string, any> }> {
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) {
    throw new Error("DeepInfra API key not configured");
  }

  const langName = getLanguageConfig(targetLanguage).name;
  const sections = processedText.processed_text?.sections || [];
  const translatedSections: ProcessedSection[] = [];
  let accumulatedText = "";
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  const systemPrompt = `You are a professional translator. Translate text accurately to ${langName}.
Maintain paragraph breaks. Output ONLY the translated text, no explanations.`;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const progress = Math.round(10 + (i / sections.length) * 80);

    await supabase
      .from("document_versions")
      .update({
        processing_progress: progress,
        streaming_text: accumulatedText + `\n\n[Translating: ${section.title || "Section " + (i + 1)}...]`,
      })
      .eq("id", versionId);

    // Combine all speech segments into one text block (separated by \n\n)
    const combinedContent = section.content.speech.map((s) => s.text).join("\n\n").trim();

    let translatedSpeech: { text: string; reader_id: string }[] = [];
    let translatedTitle = section.title;

    // Skip LLM call if section content is empty
    if (!combinedContent) {
      // Keep empty section as-is, just translate the title if present
      translatedSpeech = section.content.speech;
    } else {
      const userPrompt = `Translate the following text to ${langName}. Return ONLY the translated text, nothing else. Preserve paragraph breaks (double newlines).

${combinedContent}`;

      // Stream translation for this section
      const result = await streamSectionContent(
        supabase,
        versionId,
        apiKey,
        systemPrompt,
        userPrompt,
        accumulatedText,
        progress,
        80 / sections.length,
        Math.max(2048, Math.round(combinedContent.length * 1.5)),
      );

      totalPromptTokens += result.promptTokens;
      totalCompletionTokens += result.completionTokens;

      // Split result back into paragraphs → speech segments
      const translatedParagraphs = result.text
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      // Map back to speech segments, preserving reader_id where possible
      for (let j = 0; j < translatedParagraphs.length; j++) {
        const readerId = section.content.speech[j]?.reader_id || "Narrator";
        translatedSpeech.push({
          text: translatedParagraphs[j],
          reader_id: readerId,
        });
      }

      // Update accumulated text for streaming preview
      accumulatedText +=
        (accumulatedText ? "\n\n" : "") +
        (translatedTitle ? `## ${translatedTitle}\n\n` : "") +
        result.text;

      await supabase
        .from("document_versions")
        .update({ streaming_text: accumulatedText })
        .eq("id", versionId);
    }

    // Translate section title if present (short non-streaming call)
    if (section.title) {
      const titleResponse = await fetch(
        "https://api.deepinfra.com/v1/openai/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "openai/gpt-oss-120b",
            reasoning_effort: "low",
            messages: [
              {
                role: "system",
                content: `You are a professional translator. Translate text accurately to ${langName}.`,
              },
              {
                role: "user",
                content: `Translate this title to ${langName}. Return ONLY the translated title, nothing else.\n\n${section.title}`,
              },
            ],
            max_tokens: 256,
          }),
        },
      );

      if (titleResponse.ok) {
        const titleData = await titleResponse.json();
        translatedTitle = decodeHtmlEntities(
          titleData.choices?.[0]?.message?.content?.trim() || section.title,
        );
      }
    }

    translatedSections.push({
      title: translatedTitle,
      content: { speech: translatedSpeech },
    });
  }

  console.log(
    `[processTranslation] Version ${versionId} complete — ${translatedSections.length} sections — Total tokens: ${totalPromptTokens} in / ${totalCompletionTokens} out`,
  );

  return {
    cleanedText: { processed_text: { sections: translatedSections } },
    metadata: {
      processingLevel: 0,
      source: "translation",
      targetLanguage,
      totalSections: translatedSections.length,
      totalPromptTokens,
      totalCompletionTokens,
    },
  };
}

// Natural processing with streaming - uses existing sections from processedText
async function processNaturalWithStreaming(
  supabase: SupabaseClient,
  versionId: string,
  rawInputText: string,
  documentTitle: string,
  targetLanguage: string,
  processedText?: ProcessedText,
): Promise<{ cleanedText: ProcessedText; metadata: Record<string, any> }> {
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) {
    throw new Error("DeepInfra API key not configured");
  }

  // Use existing sections from processedText (no need for /api/identify-sections)
  const sections = processedText?.processed_text?.sections || [];

  if (sections.length === 0) {
    throw new Error("No sections found in document");
  }

  const langName = getLanguageConfig(targetLanguage).name;
  const processedSections: ProcessedSection[] = [];
  let accumulatedText = "";
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  const systemPrompt = `You are a text processing assistant that improves text for natural-sounding speech.
Output in ${langName}.`;

  // Process sections with streaming updates
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const title = section.title || "";
    const progress = Math.round(10 + (i / sections.length) * 80);

    // Update progress
    await supabase
      .from("document_versions")
      .update({
        processing_progress: progress,
        streaming_text: accumulatedText + `\n\n[Processing: ${title || "Section " + (i + 1)}...]`,
      })
      .eq("id", versionId);

    // Combine speech segments into raw text
    const sectionContent = section.content.speech.map((s) => s.text).join("\n\n").trim();

    // Skip LLM call if section content is empty
    if (!sectionContent) {
      processedSections.push({
        title,
        content: { speech: section.content.speech },
      });
      continue;
    }

    const userPrompt = `Rewrite the following text to sound more natural when spoken aloud.

Guidelines:
- Make sentences flow naturally for speech
- Remove redundant phrases and filler content
- Maintain the original meaning and key information
- Fix awkward phrasing that doesn't work well in spoken form
- Keep technical terms but explain them naturally where needed
- Ensure proper punctuation for natural pauses

CRITICAL - Output format:
- Return ONLY the processed text, nothing else
- Do NOT use any markdown formatting
- Preserve paragraph breaks (double newlines)

Text to process:
${sectionContent}`;

    // Stream this section using GPT-OSS-120B
    const result = await streamSectionContent(
      supabase,
      versionId,
      apiKey,
      systemPrompt,
      userPrompt,
      accumulatedText,
      progress,
      80 / sections.length,
      Math.max(2048, Math.round(sectionContent.length * 1.2)),
    );

    totalPromptTokens += result.promptTokens;
    totalCompletionTokens += result.completionTokens;

    // Split result back into paragraphs → speech segments
    const processedParagraphs = result.text
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    // Map back to speech segments, preserving reader_id where possible
    const processedSpeech: { text: string; reader_id: string }[] = [];
    for (let j = 0; j < processedParagraphs.length; j++) {
      const readerId = section.content.speech[j]?.reader_id || "Narrator";
      processedSpeech.push({
        text: processedParagraphs[j],
        reader_id: readerId,
      });
    }

    processedSections.push({
      title,
      content: { speech: processedSpeech.length > 0 ? processedSpeech : [{ text: result.text, reader_id: "Narrator" }] },
    });

    // Update accumulated text
    accumulatedText +=
      (accumulatedText ? "\n\n" : "") +
      (title ? `## ${title}\n\n` : "") +
      result.text;

    // Update with completed section
    await supabase
      .from("document_versions")
      .update({ streaming_text: accumulatedText })
      .eq("id", versionId);
  }

  console.log(
    `[processNaturalWithStreaming] Version ${versionId} complete — ${processedSections.length} sections — Total tokens: ${totalPromptTokens} in / ${totalCompletionTokens} out`,
  );

  return {
    cleanedText: { processed_text: { sections: processedSections } },
    metadata: {
      processingLevel: 1,
      totalSections: processedSections.length,
      totalPromptTokens,
      totalCompletionTokens,
    },
  };
}

// Lecture processing with two-step approach: plan topics, then generate full lecture
async function processLectureWithStreaming(
  supabase: SupabaseClient,
  versionId: string,
  rawInputText: string,
  documentTitle: string,
  targetLanguage: string,
  duration: LectureDuration = "medium",
): Promise<{ cleanedText: ProcessedText; metadata: Record<string, any> }> {
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) {
    throw new Error("DeepInfra API key not configured");
  }

  const durationConfig =
    LECTURE_DURATIONS.find((d) => d.value === duration) || LECTURE_DURATIONS[1];
  const numTopics = durationConfig.topics;
  const charsPerSection = durationConfig.charsPerSection;
  const langName = getLanguageConfig(targetLanguage).name;

  // Localized section labels
  const INTRO_LABELS: Record<string, string> = {
    en: "Introduction", es: "Introducción", fr: "Introduction",
    it: "Introduzione", pt: "Introdução", ja: "はじめに",
    zh: "引言", hi: "परिचय",
  };
  const CONCLUSION_LABELS: Record<string, string> = {
    en: "Conclusion", es: "Conclusión", fr: "Conclusion",
    it: "Conclusione", pt: "Conclusão", ja: "まとめ",
    zh: "结论", hi: "निष्कर्ष",
  };
  const introLabel = INTRO_LABELS[targetLanguage] || "Introduction";
  const conclusionLabel = CONCLUSION_LABELS[targetLanguage] || "Conclusion";

  // Step 1: Topic Planning (non-streaming)
  await supabase
    .from("document_versions")
    .update({
      processing_progress: 5,
      streaming_text: "Planning lecture topics...",
    })
    .eq("id", versionId);

  const planResponse = await fetch(
    "https://api.deepinfra.com/v1/openai/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        reasoning_effort: "medium",
        messages: [
          {
            role: "system",
            content:
              "You extract key topics from text. Always respond with a JSON array of strings.",
          },
          {
            role: "user",
            content: `Read the following text and list exactly ${numTopics} key topics as a JSON array of strings. Each topic should be a short phrase (3-8 words) written in ${langName}. Return ONLY the JSON array, nothing else.\n\n${rawInputText}`,
          },
        ],
        max_tokens: 2048,
        repetition_penalty: 1.3,
      }),
    },
  );

  if (!planResponse.ok) {
    throw new Error(
      `DeepInfra API error during planning: ${planResponse.status}`,
    );
  }

  const planData = await planResponse.json();
  const planContent = planData.choices?.[0]?.message?.content?.trim() || "";

  let topics: string[] = [];
  try {
    const jsonMatch = planContent.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found");
    topics = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(topics) || topics.length === 0) throw new Error("Empty or invalid array");
  } catch (e) {
    console.warn(`[processLecture] JSON parse failed (${(e as Error).message}), trying line fallback`);
    // Fallback: split by newlines, strip numbering/bullets/quotes
    topics = planContent
      .split(/\n/)
      .map((line: string) => line.replace(/^[\d\-\.\*\)]+\s*/, "").replace(/^["']|["']$/g, "").trim())
      .filter((line: string) => line.length > 2 && line.length < 100)
      .slice(0, numTopics);
  }

  if (topics.length === 0) {
    topics = ["Main Content"];
  }

  console.log(
    `[processLecture] Planned ${topics.length} topics for version ${versionId}:`,
    topics,
  );

  await supabase
    .from("document_versions")
    .update({ processing_progress: 20 })
    .eq("id", versionId);

  // Step 2: Generate lecture content
  let processedSections: ProcessedSection[] = [];
  let totalPromptTokens = planData.usage?.prompt_tokens || 0;
  let totalCompletionTokens = planData.usage?.completion_tokens || 0;

  const baseSystemPrompt = `You are giving a TED talk based on source material. Speak directly to the audience. Use "you", ask rhetorical questions. Be vivid, engaging, with a touch of humor. No markdown formatting (no bold, italics, bullets, headers). Output in ${langName}.

CRITICAL: You must ONLY use facts, examples, names, dates, and claims that appear in the source material. Do NOT invent, fabricate, or embellish any information. Rephrasing for clarity and engagement is encouraged, but every factual claim must be traceable to the source text. If the source does not cover something, do not fill the gap with invented content.

Do NOT include academic citations (e.g. "Author 2023", "Smith et al.") in the output. This is a talk, not a paper. You may mention names naturally (e.g. "as the historian noted") but never use parenthetical references.${targetLanguage === "ja" ? "\n\nIMPORTANT: You are writing in Japanese. Use only Japanese characters (hiragana, katakana, kanji). Do NOT use simplified Chinese characters or Chinese vocabulary in place of Japanese equivalents." : ""}`;

  const sectionNames = [introLabel, ...topics, conclusionLabel];
    const singlePrompt = `Give a TED talk based on the source material below.

Your output MUST use this exact format — start each section with a marker line, then the content:

${sectionNames.map((s) => `===SECTION: ${s}===\n[content for "${s}" here]`).join("\n\n")}

Rules:
- Every section MUST start with ===SECTION: Title=== on its own line
- Do NOT use any other formatting (no markdown, no JSON, no headers)
- Each section should be approximately ${charsPerSection} characters long. Stay focused and concise.

Source material:
${rawInputText}`;

    const expectedTotalChars = sectionNames.length * charsPerSection;
    const maxRetries = parseInt(process.env.MAX_LLM_RETRIES || "2", 10);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(
        `[processLecture] Generating full lecture (single call, attempt ${attempt}/${maxRetries}) for version ${versionId}`,
      );

      const result = await streamLectureSection(
        supabase,
        versionId,
        apiKey,
        baseSystemPrompt,
        singlePrompt,
        "",
        rawInputText.length,
        20,
        1,
        0,
        expectedTotalChars,
        durationConfig.maxTokens,
      );
      totalPromptTokens += result.promptTokens;
      totalCompletionTokens += result.completionTokens;

      // Split on ===SECTION: Title=== markers
      processedSections = [];
      const sectionRegex = /===SECTION:\s*(.+?)\s*===/g;
      const parts = result.text.split(sectionRegex);
      // parts: [preamble, title1, content1, title2, content2, ...]
      let sectionIndex = 0;
      for (let i = 1; i < parts.length; i += 2) {
        const content = (parts[i + 1] || "").trim();
        if (content) {
          const rawTitle = sectionNames[sectionIndex] || parts[i].trim();
          const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
          processedSections.push(createSectionFromText(content, title));
          sectionIndex++;
        }
      }

      if (processedSections.length >= sectionNames.length) {
        break; // All sections produced
      }

      console.warn(
        `[processLecture] Attempt ${attempt}: got ${processedSections.length}/${sectionNames.length} sections`,
      );

      if (attempt === maxRetries) {
        if (processedSections.length === 0) {
          console.error(`[processLecture] No sections found. Raw output (first 500 chars):`, result.text.slice(0, 500));
          throw new Error("Lecture generation failed: no sections detected in output");
        }
        console.warn(`[processLecture] Proceeding with ${processedSections.length} sections after ${maxRetries} attempts`);
      }
    }

    console.log(
      `[processLecture] Version ${versionId} complete (single call) — ${processedSections.length} sections — Total tokens: ${totalPromptTokens} in / ${totalCompletionTokens} out (${totalPromptTokens + totalCompletionTokens} total)`,
    );

    return {
      cleanedText: { processed_text: { sections: processedSections } },
      metadata: {
        processingLevel: 2,
        processingMethod: "deepinfra-lecture-single-call",
        duration,
        plannedTopics: topics,
        actualSections: processedSections.length,
      },
    };
}

// Stream a single lecture section (intro or topic)
async function streamLectureSection(
  supabase: SupabaseClient,
  versionId: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  previousText: string,
  sourceLength: number,
  progressBase: number,
  totalCalls: number,
  callIndex: number,
  expectedChars?: number,
  maxTokensOverride?: number,
): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  const response = await fetch(
    "https://api.deepinfra.com/v1/openai/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        reasoning_effort: "medium",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
        max_tokens: maxTokensOverride || Math.max(1024, Math.round(sourceLength / totalCalls)),
        repetition_penalty: 1.3,
      }),
    },
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
  let repetitionDetected = false;
  let promptTokens = 0;
  let completionTokens = 0;

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
          if (parsed.usage) {
            promptTokens = parsed.usage.prompt_tokens || 0;
            completionTokens = parsed.usage.completion_tokens || 0;
          }
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            result += content;
            updateCounter++;

            // Detect repetition loops every 100 chunks
            if (updateCounter % 100 === 0 && result.length > 500) {
              const tail = result.slice(-300);
              const preceding = result.slice(0, -300);
              if (preceding.includes(tail)) {
                console.warn(
                  `[processLecture] Repetition detected in section ${callIndex}, truncating`,
                );
                const firstIdx = preceding.indexOf(tail);
                result = result.slice(0, firstIdx + tail.length);
                repetitionDetected = true;
                break;
              }
            }

            // Update streaming text every 10 chunks
            if (updateCounter % 10 === 0) {
              const displayText =
                previousText + (previousText ? "\n\n" : "") + result;
              const progress = Math.min(
                90,
                expectedChars
                  ? progressBase + Math.round(70 * (result.length / expectedChars))
                  : progressBase + Math.round((1 / totalCalls) * 70 * (updateCounter / 200)),
              );
              await supabase
                .from("document_versions")
                .update({
                  streaming_text: displayText,
                  processing_progress: progress,
                })
                .eq("id", versionId);
            }
          }
        } catch {
          // Skip invalid JSON
        }
      }
      if (repetitionDetected) break;
    }
    if (repetitionDetected) {
      reader.cancel();
      break;
    }
  }

  // Clean up
  if (
    (result.startsWith('"') && result.endsWith('"')) ||
    (result.startsWith("'") && result.endsWith("'"))
  ) {
    result = result.slice(1, -1);
  }

  const cleaned = decodeHtmlEntities(result.trim());
  console.log(
    `[processLecture] Section ${callIndex} generated: ${cleaned.length} chars (${promptTokens} in / ${completionTokens} out)`,
  );

  // Final streaming update for this section
  const finalDisplay = previousText + (previousText ? "\n\n" : "") + cleaned;
  await supabase
    .from("document_versions")
    .update({ streaming_text: finalDisplay })
    .eq("id", versionId);

  return { text: cleaned, promptTokens, completionTokens };
}

// Conversational processing with two-step approach (like Lecture)
async function processConversational(
  supabase: SupabaseClient,
  versionId: string,
  rawInputText: string,
  documentTitle: string,
  targetLanguage: string,
  duration: ConversationalDuration = "medium",
): Promise<{ cleanedText: ProcessedText; metadata: Record<string, any> }> {
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) {
    throw new Error("DeepInfra API key not configured");
  }

  const durationConfig =
    CONVERSATIONAL_DURATIONS.find((d) => d.value === duration) || CONVERSATIONAL_DURATIONS[1];
  const numTopics = durationConfig.topics;
  const charsPerSection = durationConfig.charsPerSection;
  const langName = getLanguageConfig(targetLanguage).name;

  // Localized section labels (reuse from Lecture)
  const INTRO_LABELS: Record<string, string> = {
    en: "Introduction", es: "Introducción", fr: "Introduction",
    it: "Introduzione", pt: "Introdução", ja: "はじめに",
    zh: "引言", hi: "परिचय",
  };
  const CONCLUSION_LABELS: Record<string, string> = {
    en: "Conclusion", es: "Conclusión", fr: "Conclusion",
    it: "Conclusione", pt: "Conclusão", ja: "まとめ",
    zh: "结论", hi: "निष्कर्ष",
  };
  const introLabel = INTRO_LABELS[targetLanguage] || "Introduction";
  const conclusionLabel = CONCLUSION_LABELS[targetLanguage] || "Conclusion";

  // Step 1: Topic Planning (non-streaming)
  await supabase
    .from("document_versions")
    .update({
      processing_progress: 5,
      streaming_text: "Planning conversation topics...",
    })
    .eq("id", versionId);

  const planResponse = await fetch(
    "https://api.deepinfra.com/v1/openai/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        reasoning_effort: "medium",
        messages: [
          {
            role: "system",
            content:
              "You extract key discussion topics from text. Always respond with a JSON array of strings.",
          },
          {
            role: "user",
            content: `Read the following text and list exactly ${numTopics} key discussion topics as a JSON array of strings. Each topic should be a question or theme that two people would naturally discuss (3-8 words) written in ${langName}. Return ONLY the JSON array, nothing else.\n\n${rawInputText}`,
          },
        ],
        max_tokens: 2048,
        repetition_penalty: 1.3,
      }),
    },
  );

  if (!planResponse.ok) {
    throw new Error(
      `DeepInfra API error during planning: ${planResponse.status}`,
    );
  }

  const planData = await planResponse.json();
  const planContent = planData.choices?.[0]?.message?.content?.trim() || "";

  let topics: string[] = [];
  try {
    const jsonMatch = planContent.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found");
    topics = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(topics) || topics.length === 0) throw new Error("Empty or invalid array");
  } catch (e) {
    console.warn(`[processConversational] JSON parse failed (${(e as Error).message}), trying line fallback`);
    topics = planContent
      .split(/\n/)
      .map((line: string) => line.replace(/^[\d\-\.\*\)]+\s*/, "").replace(/^["']|["']$/g, "").trim())
      .filter((line: string) => line.length > 2 && line.length < 100)
      .slice(0, numTopics);
  }

  if (topics.length === 0) {
    topics = ["Main Discussion"];
  }

  console.log(
    `[processConversational] Planned ${topics.length} topics for version ${versionId}:`,
    topics,
  );

  await supabase
    .from("document_versions")
    .update({ processing_progress: 20 })
    .eq("id", versionId);

  // Step 2: Conversation Generation (single streaming call)
  let processedSections: ProcessedSection[] = [];
  let totalPromptTokens = planData.usage?.prompt_tokens || 0;
  let totalCompletionTokens = planData.usage?.completion_tokens || 0;

  const baseSystemPrompt = `You are writing a natural conversation between a Questioner (Q) and an Expert (E) discussing the following source material. The conversation should feel like a podcast interview — curious, engaging, and accessible.

Output in ${langName}.

CRITICAL: Only use facts from the source material. Do NOT invent information. Do NOT include academic citations.${targetLanguage === "ja" ? "\n\nIMPORTANT: You are writing in Japanese. Use only Japanese characters (hiragana, katakana, kanji). Do NOT use simplified Chinese characters or Chinese vocabulary in place of Japanese equivalents." : ""}`;

  const sectionNames = [introLabel, ...topics, conclusionLabel];
  const singlePrompt = `Write a conversation between Q (Questioner) and E (Expert) covering these topics:

${sectionNames.map((s) => `===SECTION: ${s}===\n[conversation about "${s}" using Q: and E: line prefixes]`).join("\n\n")}

Rules:
- Every section MUST start with ===SECTION: Title=== on its own line
- Within each section, every line of dialogue MUST start with Q: or E:
- Q asks curious, probing questions. E gives clear, engaging answers.
- Each section ~${charsPerSection} characters. Stay focused and concise.
- No markdown formatting.

Source material:
${rawInputText}`;

  const expectedTotalChars = sectionNames.length * charsPerSection;
  const maxRetries = parseInt(process.env.MAX_LLM_RETRIES || "2", 10);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(
      `[processConversational] Generating full conversation (single call, attempt ${attempt}/${maxRetries}) for version ${versionId}`,
    );

    const result = await streamLectureSection(
      supabase,
      versionId,
      apiKey,
      baseSystemPrompt,
      singlePrompt,
      "",
      rawInputText.length,
      20,
      1,
      0,
      expectedTotalChars,
      durationConfig.maxTokens,
    );
    totalPromptTokens += result.promptTokens;
    totalCompletionTokens += result.completionTokens;

    // Split on ===SECTION: Title=== markers
    processedSections = [];
    const sectionRegex = /===SECTION:\s*(.+?)\s*===/g;
    const parts = result.text.split(sectionRegex);
    // parts: [preamble, title1, content1, title2, content2, ...]
    let sectionIndex = 0;
    for (let i = 1; i < parts.length; i += 2) {
      const content = (parts[i + 1] || "").trim();
      if (content) {
        const rawTitle = sectionNames[sectionIndex] || parts[i].trim();
        const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
        // Parse Q:/E: prefixes into dialogue blocks
        const section = createConversationalSection(content, title);
        processedSections.push(section);
        sectionIndex++;
      }
    }

    if (processedSections.length >= sectionNames.length) {
      break; // All sections produced
    }

    console.warn(
      `[processConversational] Attempt ${attempt}: got ${processedSections.length}/${sectionNames.length} sections`,
    );

    if (attempt === maxRetries) {
      if (processedSections.length === 0) {
        console.error(`[processConversational] No sections found. Raw output (first 500 chars):`, result.text.slice(0, 500));
        throw new Error("Conversation generation failed: no sections detected in output");
      }
      console.warn(`[processConversational] Proceeding with ${processedSections.length} sections after ${maxRetries} attempts`);
    }
  }

  console.log(
    `[processConversational] Version ${versionId} complete (single call) — ${processedSections.length} sections — Total tokens: ${totalPromptTokens} in / ${totalCompletionTokens} out (${totalPromptTokens + totalCompletionTokens} total)`,
  );

  return {
    cleanedText: { processed_text: { sections: processedSections } },
    metadata: {
      processingLevel: 3,
      processingMethod: "deepinfra-conversational-two-step",
      duration,
      plannedTopics: topics,
      actualSections: processedSections.length,
    },
  };
}

// Helper to create ProcessedSection from Q:/E: dialogue text
function createConversationalSection(text: string, title: string): ProcessedSection {
  const lines = text.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const dialogue: { text: string; reader_id: string }[] = [];
  let currentSpeaker: string | null = null;
  let currentText = "";

  for (const line of lines) {
    const qMatch = line.match(/^Q:\s*(.*)$/i);
    const eMatch = line.match(/^E:\s*(.*)$/i);

    if (qMatch) {
      // Flush previous speaker
      if (currentSpeaker && currentText.trim()) {
        dialogue.push({ text: decodeHtmlEntities(currentText.trim()), reader_id: currentSpeaker });
      }
      currentSpeaker = "questioner";
      currentText = qMatch[1];
    } else if (eMatch) {
      // Flush previous speaker
      if (currentSpeaker && currentText.trim()) {
        dialogue.push({ text: decodeHtmlEntities(currentText.trim()), reader_id: currentSpeaker });
      }
      currentSpeaker = "expert";
      currentText = eMatch[1];
    } else {
      // Continuation of previous speaker
      if (currentSpeaker) {
        currentText += " " + line;
      }
    }
  }

  // Flush last speaker
  if (currentSpeaker && currentText.trim()) {
    dialogue.push({ text: decodeHtmlEntities(currentText.trim()), reader_id: currentSpeaker });
  }

  // Fallback if no dialogue parsed
  if (dialogue.length === 0) {
    dialogue.push({ text: decodeHtmlEntities(text), reader_id: "expert" });
  }

  return {
    title,
    content: {
      speech: dialogue,
    },
  };
}
