import { NextRequest, NextResponse } from "next/server";
import { LEVEL_PROMPT } from "./constants";
import { PROCESSING_ARRAY } from "@/app/features/pdf/types";

// Types
interface SpeechObject {
  text: string;
  reader_id: string;
}

interface SectionContent {
  speech: SpeechObject[];
}

interface Section {
  title: string;
  content: SectionContent;
}

interface ProcessedText {
  processed_text: {
    sections: Section[];
  };
}

interface IdentifiedSection {
  title: string;
  startMarker: string; // first 5 words after title
  order: number;
}
interface SectionIdentificationResult {
  sections: IdentifiedSection[];
}

// Section identification prompt
const SECTION_IDENTIFICATION_PROMPT = `Find top-level section titles in this document.

Look for:
- Major numbered sections
- Common academic sections: Abstract, Introduction, Methods, Results, Discussion, Conclusion,...
- Other standalone major headings that divide the document

IGNORE:
- Subsections
- Minor headings within sections
- Figure/table captions
- References or Bibliography entries

For each TOP-LEVEL title you find, return:
- title: The exact title text
- startMarker: The exact first 5 words AFTER the title

Return JSON:
{
  "sections": [
    {
      "title": "Introduction",
      "startMarker": "First five words of content",
      "order": 1
    }
  ]
}

Focus on major document divisions only. Each section should contain substantial content.`;

export async function POST(req: NextRequest) {
  const {
    input,
    level = 0,
  }: {
    input: string;
    level: 0 | 1 | 2 | 3;
  } = await req.json();

  if (typeof input !== "string") {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  try {
    console.log("Starting section-by-section processing...");

    // Step 1: Identify all sections
    const identifiedSections = await identifySections(input);
    console.log(`Identified ${identifiedSections.sections.length} sections`);

    // Step 2: Extract and process each section
    const processedSections: Section[] = [];

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
        sectionInfo,
        LEVEL_PROMPT[level],
        PROCESSING_ARRAY[level].temperature
      );

      processedSections.push(processedSection);
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

async function identifySections(
  input: string
): Promise<SectionIdentificationResult> {
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
          role: "system",
          content:
            "You are a precise document analyzer that returns only valid JSON responses.",
        },
        {
          role: "user",
          content: `${SECTION_IDENTIFICATION_PROMPT}\n\nTEXT TO ANALYZE:\n${input}`,
        },
      ],
      temperature: 0,
      max_tokens: 4000,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
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
  sectionInfo: IdentifiedSection,
  prompt: string,
  temperature: number
): Promise<Section> {
  // Check if section needs chunking (80k chars ~= 20k tokens)
  const needsChunking = sectionContent.length > 80000;

  if (needsChunking) {
    return await processSectionInChunks(
      sectionContent,
      sectionInfo,
      prompt,
      temperature
    );
  } else {
    return await processSectionSingle(
      sectionContent,
      sectionInfo,
      prompt,
      temperature
    );
  }
}

// Updated processing functions
async function processSectionSingle(
  sectionContent: string,
  sectionInfo: IdentifiedSection,
  prompt: string,
  temperature: number
): Promise<Section> {
  // Inject section info into the prompt
  const contextualizedPrompt = prompt
    .replace("{SECTION_TITLE}", sectionInfo.title)
    .replace("{START_MARKER}", sectionInfo.startMarker);

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
          role: "system",
          content:
            "You are a precise text processing assistant. Return only cleaned text content, no JSON or formatting.",
        },
        {
          role: "user",
          content: `${contextualizedPrompt}\n\nTEXT TO PROCESS:\n${sectionContent}`,
        },
      ],
      temperature: temperature,
      max_tokens: 32000,
      // Remove response_format constraint - we want plain text
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const cleanedText = data.choices[0].message.content.trim();

  // Build the JSON structure ourselves
  return createSectionFromText(cleanedText, sectionInfo.title);
}

async function processSectionInChunks(
  sectionContent: string,
  sectionInfo: IdentifiedSection,
  prompt: string,
  temperature: number
): Promise<Section> {
  const chunks = chunkText(sectionContent, 80000);
  const cleanedChunks: string[] = [];

  // Inject section info into the base prompt
  const contextualizedPrompt = prompt
    .replace("{SECTION_TITLE}", sectionInfo.title)
    .replace("{START_MARKER}", sectionInfo.startMarker);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    const chunkPrompt = `${contextualizedPrompt}

CHUNK ${i + 1} of ${
      chunks.length
    }: Process this portion and return only the cleaned text.`;

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
            role: "system",
            content:
              "You are a precise text processing assistant. Return only cleaned text content, no JSON or formatting.",
          },
          {
            role: "user",
            content: `${chunkPrompt}\n\nTEXT TO PROCESS:\n${chunk}`,
          },
        ],
        temperature: temperature,
        max_tokens: 32000,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    cleanedChunks.push(data.choices[0].message.content.trim());
  }

  // Combine all cleaned chunks
  const combinedText = cleanedChunks.join("\n\n");

  // Build the JSON structure ourselves
  return createSectionFromText(combinedText, sectionInfo.title);
}

function createSectionFromText(cleanedText: string, title: string): Section {
  // Split text into natural speech segments for TTS
  const speechSegments = splitIntoSpeechSegments(cleanedText);

  return {
    title: title,
    content: {
      speech: speechSegments.map((text) => ({
        text: text.trim(),
        reader_id: "default",
      })),
    },
  };
}

function splitIntoSpeechSegments(text: string): string[] {
  // Split at paragraph breaks first
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
  const segments: string[] = [];
  let currentSegment = "";

  for (const paragraph of paragraphs) {
    // Target 200-800 words per segment
    const wordCount =
      currentSegment.split(/\s+/).length + paragraph.split(/\s+/).length;

    if (wordCount > 800 && currentSegment) {
      // Current segment is getting too long, finalize it
      segments.push(currentSegment.trim());
      currentSegment = paragraph;
    } else if (currentSegment) {
      // Add to current segment
      currentSegment += "\n\n" + paragraph;
    } else {
      // Start new segment
      currentSegment = paragraph;
    }
  }

  // Add the final segment
  if (currentSegment.trim()) {
    segments.push(currentSegment.trim());
  }

  // If no segments created, return the whole text as one segment
  return segments.length > 0 ? segments : [text.trim()];
}

// function createSectionFromText(cleanedText: string, title: string): Section {
//   // Split text into natural speech segments for TTS
//   const speechSegments = splitIntoSpeechSegments(cleanedText);

//   return {
//     title: title,
//     content: {
//       speech: speechSegments.map((text) => ({
//         text: text.trim(),
//         reader_id: "default",
//       })),
//     },
//   };
// }

// function splitIntoSpeechSegments(text: string): string[] {
//   // Split at paragraph breaks first
//   const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
//   const segments: string[] = [];
//   let currentSegment = "";

//   for (const paragraph of paragraphs) {
//     // Target 200-800 words per segment
//     const wordCount =
//       currentSegment.split(/\s+/).length + paragraph.split(/\s+/).length;

//     if (wordCount > 800 && currentSegment) {
//       // Current segment is getting too long, finalize it
//       segments.push(currentSegment.trim());
//       currentSegment = paragraph;
//     } else if (currentSegment) {
//       // Add to current segment
//       currentSegment += "\n\n" + paragraph;
//     } else {
//       // Start new segment
//       currentSegment = paragraph;
//     }
//   }

//   // Add the final segment
//   if (currentSegment.trim()) {
//     segments.push(currentSegment.trim());
//   }

//   // If no segments created, return the whole text as one segment
//   return segments.length > 0 ? segments : [text.trim()];
// }

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
