import { NextRequest, NextResponse } from "next/server";
import { LEVEL_PROMPT } from "./constants";
import { PROCESSING_ARRAY } from "@/app/features/pdf/types";

import OpenAI from "openai";

import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { SectionTTSInput } from "@/app/features/audio/types";
import {
  SpeechObject,
  SectionContent,
  ProcessedSection,
  ProcessedText,
} from "@/app/features/documents/types";

// Simple provider selection
const useOpenRouter = process.env.USE_OPENROUTER === "true";
const MODEL_NAME = useOpenRouter
  ? "nvidia/nemotron-3-nano-30b-a3b:free"
  : "gpt-5-nano";

// OpenAI client (for GPT-5-nano with structured outputs)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_SECRET_KEY || "dummy-key-for-netlify",
});

// OpenRouter client (for Nemotron and other models)
const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY || "dummy-key-for-netlify",
});

// Types

interface IdentifiedSection {
  title: string;
  startMarker: string; // first 5 words after title
  order: number;
}
interface SectionIdentificationResult {
  sections: IdentifiedSection[];
}

const SectionIdentificationSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().min(1, "Title cannot be empty"),
        startMarker: z.string().min(1, "Start marker cannot be empty"),
        order: z.number().int().positive("Order must be a positive integer"),
      })
    )
    .min(1, "Must contain at least one section")
    .refine(
      (sections) => {
        // Validate that order numbers are sequential starting from 1
        const orders = sections.map((s) => s.order).sort((a, b) => a - b);
        return orders.every((order, index) => order === index + 1);
      },
      {
        message: "Order numbers must be sequential starting from 1",
      }
    ),
});

// Define the Zod schema for the dialogue structure
const DialogueSchema = z.object({
  dialogue: z
    .array(
      z.object({
        text: z.string().min(1, "Dialogue content only, no markup"),
        reader_id: z.union([z.literal("questioner"), z.literal("expert")]),
      })
    )
    .min(1, "Dialogue must contain at least one speech object"),
});

// JSON Schema equivalents for OpenRouter
const DialogueJsonSchema = {
  type: "object",
  properties: {
    dialogue: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: {
            type: "string",
            minLength: 1,
            description: "Dialogue content only, no markup",
          },
          reader_id: {
            type: "string",
            enum: ["questioner", "expert"],
            description: "Speaker identifier",
          },
        },
        required: ["text", "reader_id"],
        additionalProperties: false,
      },
      minItems: 1,
      description: "Array of dialogue exchanges",
    },
  },
  required: ["dialogue"],
  additionalProperties: false,
};

const SectionIdentificationJsonSchema = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            minLength: 1,
            description: "Section title",
          },
          startMarker: {
            type: "string",
            minLength: 1,
            description: "First 5 words after title",
          },
          order: {
            type: "integer",
            minimum: 1,
            description: "Sequential order starting from 1",
          },
        },
        required: ["title", "startMarker", "order"],
        additionalProperties: false,
      },
      minItems: 1,
      description: "Identified document sections",
    },
  },
  required: ["sections"],
  additionalProperties: false,
};

// Unified completion functions that work with both providers
async function createStructuredCompletion<T>(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  schema: any,
  zodSchema: z.ZodType<T>,
  schemaName: string
): Promise<T> {
  if (useOpenRouter) {
    console.log("OPEN ROUTER");
    // Use manual JSON schema approach for Nemotron
    const enhancedMessages = [...messages];
    enhancedMessages[0] = {
      ...enhancedMessages[0],
      content:
        enhancedMessages[0].content +
        `\n\nRespond with valid JSON that matches this exact schema:\n${JSON.stringify(
          schema,
          null,
          2
        )}\n\nOutput ONLY the JSON, no other text.`,
    };

    const completion = await openrouter.chat.completions.create({
      model: MODEL_NAME,
      messages: enhancedMessages,
      max_tokens: 32000,
    });

    const jsonContent = completion.choices[0]?.message?.content;
    if (!jsonContent) {
      throw new Error(
        "No response from OpenRouter: " + JSON.stringify(completion.choices[0])
      );
    }

    try {
      const parsed = JSON.parse(jsonContent);
      // Validate with Zod as backup
      return zodSchema.parse(parsed);
    } catch (error) {
      // Try to extract JSON from response if it's wrapped in other text
      const jsonMatch = jsonContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return zodSchema.parse(parsed);
      }
      throw error;
    }
  } else {
    console.log("OPEN AI");
    // Use OpenAI with responses.parse
    const response = await openai.responses.parse({
      model: MODEL_NAME,
      input: messages,
      reasoning: {
        effort: "minimal",
      },
      max_output_tokens: 32000,
      text: {
        format: zodTextFormat(zodSchema, schemaName),
      },
    });

    const validatedResult = response.output_parsed;
    if (!validatedResult) {
      throw new Error("Failed to parse structured output from OpenAI");
    }

    return validatedResult;
  }
}

async function createTextCompletion(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
): Promise<string> {
  if (useOpenRouter) {
    console.log("OPEN ROUTER");
    // Use OpenRouter standard completion
    const completion = await openrouter.chat.completions.create({
      model: MODEL_NAME,
      messages,
      max_tokens: 32000,
    });

    const textContent = completion.choices[0].message.content;
    if (!textContent) {
      throw new Error("No response from OpenRouter");
    }

    return textContent.trim();
  } else {
    console.log("OPEN AI");
    // Use OpenAI responses.create
    const response = await openai.responses.create({
      model: MODEL_NAME,
      input: messages,
      reasoning: {
        effort: "minimal",
      },
      max_output_tokens: 32000,
    });

    return response.output_text.trim();
  }
}

// Section identification prompt
const SECTION_IDENTIFICATION_PROMPT = `Find top-level section titles in this document.

Look for:
- Major numbered sections
- Common academic sections: Abstract, Introduction, Methods, Results, Discussion, Conclusion,...
- Other standalone major headings that divide the document

IGNORE:
- Figure/table captions
- References or Bibliography entries

For each TOP-LEVEL title you find, return:
- title: The exact title text (e.g., "1. Introduction")
- startMarker: EXACTLY the first 5 words of the content that follows this title (not including the title itself)

Focus on major document divisions only. Each section should contain substantial content.`;

// IGNORE
// - Subsections
// - Minor headings within sections
//
// Return JSON:
// {
//   "sections": [
//     {
//       "title": "Introduction",
//       "startMarker": "First five words of content",
//       "order": 1
//     }
//   ]
// }

export async function POST(req: NextRequest) {
  const {
    text,
    title,
    level = 0,
  }: {
    text: string;
    title: string;
    level: 0 | 1 | 2 | 3;
  } = await req.json();

  if (typeof text !== "string") {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }
  if (level === 0 || level === 1)
    return processSingleSection(text, title, level);
  // if (level === 0 || level === 1) return processSectionBySection(input, level);
  if (level === 2 || level === 3) return processAllAtOnce(text, level);
}

async function identifySections(
  input: string
): Promise<SectionIdentificationResult> {
  const messages = [
    {
      role: "system" as const,
      content:
        "You are a precise document analyzer that returns only valid JSON responses.",
    },
    {
      role: "user" as const,
      content: `${SECTION_IDENTIFICATION_PROMPT}\n\nTEXT TO ANALYZE:\n${input}`,
    },
  ];

  const response = await createStructuredCompletion(
    messages,
    SectionIdentificationJsonSchema,
    SectionIdentificationSchema,
    "section_identification"
  );

  console.log(response);

  return response;
}

function extractSectionContent(
  fullText: string,
  currentSection: IdentifiedSection,
  nextSection?: IdentifiedSection
): string {
  // Find the start position using the startMarker
  const startIndex = fullText.indexOf(currentSection.startMarker);
  if (startIndex === -1) {
    throw new Error(
      `Could not find start marker: ${currentSection.startMarker}`
    );
  }

  let endIndex: number;

  if (nextSection) {
    // End at the next section's start marker
    const nextStartIndex = fullText.indexOf(
      nextSection.startMarker,
      startIndex + 1
    );
    if (nextStartIndex === -1) {
      // If we can't find the next section, go to end of document
      endIndex = fullText.length;
    } else {
      endIndex = nextStartIndex;
    }
  } else {
    // This is the last section, go to end of document
    endIndex = fullText.length;
  }

  return fullText.substring(startIndex, endIndex).trim();
}

async function processSingleSection(
  sectionContent: string,
  sectionTitle: string,
  level: 0 | 1 | 2 | 3
  // temperature: number
) {
  console.log("PROCESSING SECTION: ", sectionTitle);

  // Check if section needs chunking (80k chars ~= 20k tokens)
  const needsChunking = sectionContent.length > 80000;

  const prompt = LEVEL_PROMPT[level];

  let section: ProcessedSection;

  if (needsChunking) {
    section = await processSectionInChunks(
      sectionContent,
      sectionTitle,
      prompt
    );
  } else {
    section = await processSectionSingle(sectionContent, sectionTitle, prompt);
  }

  return NextResponse.json({
    message: section,
    metadata: {
      level,
      processingMethod: "section-by-section",
      // sectionsProcessed: processedSections.length,
      originalLength: sectionContent.length,
      processedLength: JSON.stringify(section.content).length,
    },
  });
}

// Updated processing functions
async function processSectionSingle(
  sectionContent: string,
  sectionTitle: string,
  prompt: string
): Promise<ProcessedSection> {
  // Inject section info into the prompt
  const contextualizedPrompt = prompt.replace("{SECTION_TITLE}", sectionTitle);
  // .replace("{START_MARKER}", sectionInfo.startMarker);

  // const response = await fetch("https://api.openai.com/v1/chat/completions", {
  //   method: "POST",
  //   headers: {
  //     Authorization: `Bearer ${process.env.OPENAI_SECRET_KEY}`,
  //     "Content-Type": "application/json",
  //   },
  //   body: JSON.stringify({
  //     model: "gpt-5-nano",
  //     messages: [
  //       {
  //         role: "system",
  //         content:
  //           "You are a precise text processing assistant. Return only cleaned text content, no JSON or formatting.",
  //       },
  //       {
  //         role: "user",
  //         content: `${contextualizedPrompt}\n\nTEXT TO PROCESS:\n${sectionContent}`,
  //       },
  //     ],
  //     // temperature: temperature,
  //     max_tokens: 32000,
  //     // Remove response_format constraint - we want plain text
  //   }),
  // });

  // if (!response.ok) {
  //   throw new Error(`OpenAI API error: ${response.status}`);
  // }

  // const data = await response.json();
  // const cleanedText = data.choices[0].message.content.trim();

  const messages = [
    {
      role: "system" as const,
      content:
        "You are a precise text processing assistant. Return only cleaned text content, no JSON or formatting.",
    },
    {
      role: "user" as const,
      content: `${contextualizedPrompt}\n\nTEXT TO PROCESS:\n${sectionContent}`,
    },
  ];

  const cleanedText = await createTextCompletion(messages);

  // Build the JSON structure ourselves

  const section = createSectionFromText(cleanedText, sectionTitle);
  return section;

  // return NextResponse.json({
  //     message: result,
  //     metadata: {
  //       level,
  //       processingMethod: "section-by-section",
  //       sectionsProcessed: processedSections.length,
  //       originalLength: input.length,
  //       processedLength: JSON.stringify(result).length,
  //     },
  //   });
}

async function processSectionInChunks(
  sectionContent: string,
  sectionTitle: string,
  prompt: string
): Promise<ProcessedSection> {
  const chunks = chunkText(sectionContent, 80000);
  const cleanedChunks: string[] = [];

  // Inject section info into the base prompt
  const contextualizedPrompt = prompt.replace("{SECTION_TITLE}", sectionTitle);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    const chunkPrompt = `${contextualizedPrompt}

CHUNK ${i + 1} of ${
      chunks.length
    }: Process this portion and return only the cleaned text.`;

    // const response = await fetch("https://api.openai.com/v1/chat/completions", {
    //   method: "POST",
    //   headers: {
    //     Authorization: `Bearer ${process.env.OPENAI_SECRET_KEY}`,
    //     "Content-Type": "application/json",
    //   },
    //   body: JSON.stringify({
    //     model: "gpt-5-nano",
    //     messages: [
    //       {
    //         role: "system",
    //         content:
    //           "You are a precise text processing assistant. Return only cleaned text content, no JSON or formatting.",
    //       },
    //       {
    //         role: "user",
    //         content: `${chunkPrompt}\n\nTEXT TO PROCESS:\n${chunk}`,
    //       },
    //     ],
    //     // temperature: temperature,
    //     max_tokens: 32000,
    //   }),
    // });

    // if (!response.ok) {
    //   throw new Error(`OpenAI API error: ${response.status}`);
    // }

    // const data = await response.json();

    const messages = [
      {
        role: "system" as const,
        content:
          "You are a precise text processing assistant. Return only cleaned text content, no JSON or formatting.",
      },
      {
        role: "user" as const,
        content: `${chunkPrompt}\n\nTEXT TO PROCESS:\n${chunk}`,
      },
    ];

    const cleanedChunk = await createTextCompletion(messages);

    cleanedChunks.push(cleanedChunk);
  }

  // Combine all cleaned chunks
  const combinedText = cleanedChunks.join("\n\n");

  // Build the JSON structure ourselves
  return createSectionFromText(combinedText, sectionTitle);
}

function createSectionFromText(
  cleanedText: string,
  title: string
): ProcessedSection {
  return {
    title: title,
    content: {
      speech: [
        {
          text: cleanedText,
          reader_id: "Narrator",
        },
      ],
    },
  };
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

async function processSectionBySection(input: string, level: 0 | 1 | 2 | 3) {
  try {
    console.log("Starting section-by-section processing...");

    // Step 1: Identify all sections
    const identifiedSections = await identifySections(input);
    console.log(`Identified ${identifiedSections.sections.length} sections`);

    // Step 2: Extract and process each section
    const processedSections: ProcessedSection[] = [];

    for (let i = 0; i < identifiedSections.sections.length; i++) {
      const sectionInfo = identifiedSections.sections[i];
      const nextSection = identifiedSections.sections[i + 1]; // undefined for last section

      console.log(`Processing section: ${sectionInfo.title}`);

      // Extract section content from original text
      const sectionContent = extractSectionContent(
        input,
        sectionInfo,
        nextSection
      );

      // Process this section (with chunking if needed)
      const processedSection = await processSingleSection(
        sectionContent,
        sectionInfo.title,
        level
      );

      // processedSections.push(processedSection);
    }

    // Step 3: Combine all processed sections
    const result: ProcessedText = {
      processed_text: {
        sections: processedSections,
      },
    };

    return NextResponse.json({
      message: result,
      metadata: {
        level,
        processingMethod: "section-by-section",
        sectionsProcessed: processedSections.length,
        originalLength: input.length,
        processedLength: JSON.stringify(result).length,
      },
    });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}

async function processAllAtOnce(input: string, level: 2 | 3) {
  try {
    console.log(`Starting all-at-once processing for level ${level}...`);
    return await processAllAtOnceSingle(input, level);
    // Check if input needs chunking (80k chars ~= 20k tokens)
    // const needsChunking = input.length > 80000;

    // if (needsChunking) {
    //   return await processAllAtOnceInChunks(input, level);
    // } else {
    //   return await processAllAtOnceSingle(input, level);
    // }
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}

async function processAllAtOnceSingle(input: string, level: 2 | 3) {
  const prompt = LEVEL_PROMPT[level];
  const temperature = PROCESSING_ARRAY[level].temperature;

  let processedResult: ProcessedText;

  if (level === 3) {
    // ✅ Structured JSON output
    const messages = [
      {
        role: "system" as const,
        content:
          "You are a conversational content transformer. Create engaging dialogues between exactly 2 speakers with strict alternation.",
      },
      {
        role: "user" as const,
        content: `${prompt}\n\nTEXT TO PROCESS:\n${input}`,
      },
    ];

    const speechArray = await createStructuredCompletion(
      messages,
      DialogueJsonSchema,
      DialogueSchema,
      "dialogue_response"
    );

    processedResult = createProcessedTextFromSpeechArray(speechArray.dialogue);
  } else {
    // ✅ Plain text output
    const messages = [
      {
        role: "system" as const,
        content:
          "You are a precise text processing assistant. Return only cleaned text content, no JSON or formatting.",
      },
      {
        role: "user" as const,
        content: `${prompt}\n\nTEXT TO PROCESS:\n${input}`,
      },
    ];

    const result = await createTextCompletion(messages);

    processedResult = createProcessedTextFromSpeechArray([
      { text: result, reader_id: "Narrator" },
    ]);
  }

  return NextResponse.json({
    message: processedResult,
    metadata: {
      level,
      processingMethod: "all-at-once",
      originalLength: input.length,
      processedLength: JSON.stringify(processedResult).length,
      ...(level === 3 && {
        speakersCount:
          processedResult.processed_text.sections[0].content.speech.length,
      }),
    },
  });
}

function createProcessedTextFromSpeechArray(
  speechArray: SpeechObject[]
): ProcessedText {
  console.log();
  return {
    processed_text: {
      sections: [
        {
          title: "Conversation",
          content: {
            speech: speechArray,
          },
        },
      ],
    },
  };
}
