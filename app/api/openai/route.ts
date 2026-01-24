import { NextRequest, NextResponse } from "next/server";
import { DOCUMENT_SPECIFIC_INSTRUCTIONS } from "./constants";
import {
  checkCreditsForRequest,
  deductCreditsAfterOperation,
} from "@/app/api/lib/credits-middleware";

import type { DocumentType } from "./constants";

function isValidDocumentType(type: string): type is DocumentType {
  return type in DOCUMENT_SPECIFIC_INSTRUCTIONS;
}

async function classifyDocumentType(text: string): Promise<DocumentType> {
  // For short documents, classification doesn't matter much - just use general
  if (text.length <= 1000) {
    return "general";
  }

  // For longer documents, take beginning and middle samples
  const beginning = text.substring(0, 300);
  const middleStart = Math.floor(text.length / 2);
  const middle = text.substring(middleStart, middleStart + 200);
  const sample = `${beginning}\n...\n${middle}`;

  const documentTypes = Object.keys(DOCUMENT_SPECIFIC_INSTRUCTIONS).join(", ");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Classify this document into one of these types: ${documentTypes}

Rules:
- Respond with ONLY the document type, nothing else
- If unsure, respond with "general"
- Look for key indicators like citations, financial data, legal language, step-by-step instructions, etc.

Document sample:
${sample}`,
        },
      ],
      temperature: 0,
      max_tokens: 10,
    }),
  });

  if (!response.ok) {
    console.warn(`Document classification failed: ${response.status}`);
    return "general";
  }

  const data = await response.json();
  const classifiedType = data.choices[0].message.content.trim().toLowerCase();

  return isValidDocumentType(classifiedType) ? classifiedType : "general";
}

function buildContextAwarePrompt(
  level: 1 | 2 | 3 | 4,
  docType: DocumentType
): string {
  const docConfig = DOCUMENT_SPECIFIC_INSTRUCTIONS[docType];

  const basePrompts = {
    1: `TASK: Clean up this text WITHOUT changing, WITHOUT removing, and WITHOUT summarizing any content.
    
Document type: ${docType.replace("_", " ")}
Specific considerations: ${docConfig.analysis}

Apply these cleaning rules ONLY:
- Remove page numbers, headers, footers, table formatting artifacts
- Fix OCR errors and spacing issues
- Add periods (.) after titles, headings, and section names for proper TTS pausing
- Add periods after standalone phrases that need vocal pauses
- Handle ALL CAPS words: keep caps only for acronyms that should be spelled out (NASA, FBI, HTML), convert to normal case for words that should be pronounced as words (IMPORTANT → Important, EUROCALL → Eurocall)
- Fix punctuation for natural speech rhythm WITHOUT removing sentences
- PRESERVE all original sentences, paragraphs, and content exactly - only clean formatting
- ${docConfig.specific_rules[1]}

IMPORTANT: Only clean the formatting and fix obvious errors, but every readable sentence in the original text should be kept EXACTLY as they are.

Return only the cleaned text, no analysis or headers.`,

    2: `TASK: Optimize this text for natural text-to-speech reading and listening comprehension.

CONTEXT: You are preparing a script for a TTS algorithm. Focus on how the text will sound when spoken aloud.

Document type: ${docType.replace("_", " ")}
Specific considerations: ${docConfig.analysis}

Apply these improvements:
- Clean formatting and remove metadata elements
- Add periods (.) after titles, headings, and section breaks for proper TTS pausing
- Rephrase awkward sentences to sound natural when spoken
- Convert numbers/abbreviations to readable form (e.g., "Dr." to "Doctor")
- Handle ALL CAPS words: keep caps only for acronyms to be spelled out (NASA, API, PDF), convert to normal case for words to be pronounced as words (IMPORTANT → Important, CONFERENCE → Conference)
- Add commas and periods where listeners would expect natural pauses
- Break up overly long sentences that would be hard to follow when spoken
- ${docConfig.specific_rules[2]}

Return only the optimized text, no analysis or headers.`,

    3: `TASK: Transform this into digestible audio content optimized for listening.

CONTEXT: You are preparing a script for a TTS algorithm. The listener cannot see the text, only hear it.

Document type: ${docType.replace("_", " ")}
Specific considerations: ${docConfig.analysis}

Create a condensed version that:
- Removes non-essential formatting and metadata
- Adds proper punctuation (periods, commas) for natural TTS pauses
- Handle ALL CAPS words appropriately: keep caps for acronyms (NASA, HTML, API), convert to normal case for regular words (RESULTS → Results, CONCLUSION → Conclusion)
- Summarizes dense sections while preserving key information
- Uses clear, accessible language optimized for audio consumption
- Adds transitional phrases to help listeners follow the content flow
- Ensures titles and section breaks have proper punctuation for pauses
- ${docConfig.specific_rules[3]}

Return only the digestible text, no analysis or headers.`,

    4: `TASK: Convert this into a natural podcast conversation between two hosts optimized for TTS.

CONTEXT: You are creating a script that will be read by text-to-speech technology, so natural punctuation and speech patterns are crucial.

Document type: ${docType.replace("_", " ")}
Specific considerations: ${docConfig.analysis}

Create a dialogue between:
- Host A (Alex): Asks engaging questions, provides transitions, curious and engaging tone
- Host B (Blake): Explains concepts clearly and enthusiastically, confident explanatory tone
- Include natural speech patterns, "um", "you know", casual interjections
- Handle ALL CAPS words: keep caps for acronyms to be spelled out (NASA, PDF, HTML), convert to normal case for words to be spoken naturally (WELCOME → Welcome, STUDY → Study)
- Add proper punctuation for natural TTS pauses and rhythm
- Use ellipses (...) for thinking pauses, commas for breath breaks
- End sentences with periods for clear TTS sentence boundaries
- ${docConfig.specific_rules[4]}

Format exactly as:
[ALEX]: [Alex's dialogue]
[BLAKE]: [Blake's response]
[ALEX]: [Alex's follow-up]
[BLAKE]: [Blake's explanation]

Return only the dialogue script, no analysis or headers.`,
  };

  return basePrompts[level];
}

export async function POST(req: NextRequest) {
  const {
    input,
    level = 1,
  }: {
    input: string;
    level: 0 | 1 | 2 | 3 | 4;
  } = await req.json();

  if (typeof input !== "string") {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  // Level 0: Return original text (no credit charge)
  if (level === 0) {
    return NextResponse.json({ message: input });
  }

  // Check credits before processing
  const creditCheck = await checkCreditsForRequest({ textLength: input.length });
  if (!creditCheck.success) {
    return creditCheck.response;
  }

  try {
    // Step 1: Classify document type (only for longer documents)
    let detectedDocType: DocumentType = "general";

    if (input.length > 1000) {
      detectedDocType = await classifyDocumentType(input);
    }

    // Step 2: Process the entire document with context
    const prompt = buildContextAwarePrompt(
      level as 1 | 2 | 3 | 4,
      detectedDocType
    );

    // Temperature based on level, but use full 32k token capacity for all
    const levelConfigs = {
      1: { temperature: 0, maxTokens: 32000 }, // Clean: preserve everything
      2: { temperature: 0.2, maxTokens: 32000 }, // Optimize: might be same length
      3: { temperature: 0.3, maxTokens: 32000 }, // Digest: let model decide compression ratio
      4: { temperature: 0.7, maxTokens: 32000 }, // Podcast: dialogue can vary greatly
    };

    const config = levelConfigs[level as keyof typeof levelConfigs];

    // Check if we need chunking based on OUTPUT token limits
    // We want chunks of ~20k tokens max, which is ~80k characters
    const needsChunking = input.length > 80000;

    if (needsChunking) {
      // For very large documents, still use chunking but with larger chunks
      const result = await processInChunks(
        input,
        prompt,
        config,
        detectedDocType
      );

      // Deduct credits after successful operation
      const creditResult = await deductCreditsAfterOperation(
        creditCheck.userId,
        input.length
      );

      return NextResponse.json({
        message: result,
        metadata: {
          level,
          detectedDocumentType: detectedDocType,
          processingMethod: "chunked",
          originalLength: input.length,
          processedLength: result.length,
        },
        creditsUsed: creditResult?.creditsUsed ?? 0,
        creditsRemaining: creditResult?.creditsRemaining ?? 0,
      });
    } else {
      console.log("normal size");
      console.log("max tokens: ", config.maxTokens);

      // Single processing call for normal-sized documents
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4.1-nano",
            messages: [
              {
                role: "user",
                content: `${prompt}\n\nTEXT TO PROCESS:\n${input}`,
              },
            ],
            temperature: config.temperature,
            max_tokens: config.maxTokens,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      const result = data.choices[0].message.content;

      // Deduct credits after successful operation
      const creditResult = await deductCreditsAfterOperation(
        creditCheck.userId,
        input.length
      );

      return NextResponse.json({
        message: result,
        metadata: {
          level,
          detectedDocumentType: detectedDocType,
          processingMethod: "single",
          originalLength: input.length,
          processedLength: result.length,
        },
        creditsUsed: creditResult?.creditsUsed ?? 0,
        creditsRemaining: creditResult?.creditsRemaining ?? 0,
      });
    }
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}

async function processInChunks(
  input: string,
  prompt: string,
  config: { temperature: number; maxTokens: number },
  docType: DocumentType
): Promise<string> {
  const chunks = chunkText(input, 80000); // ~20k tokens per chunk (safe for 32k output limit)
  const processedChunks = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // Include document type context for all chunks
    const contextualPrompt = `DOCUMENT TYPE: ${docType}\nCHUNK ${i + 1} of ${
      chunks.length
    }\n\n${prompt}`;

    // Calculate dynamic max tokens for this chunk
    const chunkPromptTokens = Math.ceil(contextualPrompt.length / 4);
    const chunkInputTokens = Math.ceil(chunk.length / 4);
    const chunkEstimatedSize = chunkPromptTokens + chunkInputTokens;
    const chunkMaxTokens = Math.min(32000, Math.ceil(chunkEstimatedSize * 1.1));

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
            role: "user",
            content: `${contextualPrompt}\n\nTEXT TO PROCESS:\n${chunk}`,
          },
        ],
        temperature: config.temperature,
        max_tokens: chunkMaxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    processedChunks.push(data.choices[0].message.content);
  }

  return processedChunks.join("\n\n");
}

function chunkText(text: string, maxChunkSize: number): string[] {
  // Split by paragraphs first, then by sentences if needed
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length > maxChunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }

      // If single paragraph is too long, split by sentences
      if (paragraph.length > maxChunkSize) {
        const sentences = paragraph.split(/[.!?]+/);
        for (const sentence of sentences) {
          if (currentChunk.length + sentence.length > maxChunkSize) {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
              currentChunk = "";
            }
          }
          currentChunk += sentence + ". ";
        }
      } else {
        currentChunk = paragraph;
      }
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
