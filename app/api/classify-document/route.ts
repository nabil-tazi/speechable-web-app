import { NextRequest, NextResponse } from "next/server";
import { VALID_LANGUAGE_CODES } from "./constants";
import { DOCUMENT_SPECIFIC_INSTRUCTIONS } from "../openai/constants";

import OpenAI from "openai";

import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { DocumentType } from "@/app/features/documents/types";
import { DOCUMENT_TYPES } from "@/app/features/documents/constants";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_SECRET_KEY,
});

// type DocumentType =
//   | "general"
//   | "academic"
//   | "legal"
//   | "financial"
//   | "technical"
//   | "manual"
//   | "news" // For news articles, newspapers, press releases
//   | "literature"; // For fiction, non-fiction, novels, essays, books

// function isValidDocumentType(type: string): type is DocumentType {
//   return type in DOCUMENT_SPECIFIC_INSTRUCTIONS;
// }

const DocumentClassificationSchema = z.object({
  documentType: z
    .nativeEnum(DOCUMENT_TYPES)
    .transform((key) => key as DocumentType),
  language: z
    .string()
    .refine((code) => VALID_LANGUAGE_CODES.has(code.toLowerCase()), {
      message: `Language code must be one of the supported ISO 639-1 codes: ${Array.from(
        VALID_LANGUAGE_CODES
      ).join(", ")}`,
    })
    .transform((code) => code.toLowerCase())
    .describe("ISO 639-1 language code from the supported language set"),
});

async function classifyDocumentAndLanguage(text: string): Promise<{
  documentType: DocumentType;
  language: string;
}> {
  // Create sample that works for both short and long texts
  let sample: string;

  if (text.length <= 500) {
    // For short texts, use the entire text
    sample = text;
  } else {
    // For longer texts, take beginning and middle samples
    const beginning = text.substring(0, 300);
    const middleStart = Math.floor(text.length / 2);
    const middleEnd = Math.min(middleStart + 200, text.length);
    const middle = text.substring(middleStart, middleEnd);
    sample = `${beginning}\n...\n${middle}`;
  }

  const documentTypes = Object.keys(DOCUMENT_SPECIFIC_INSTRUCTIONS).join(", ");

  // Create a list of valid language codes for the prompt
  const supportedLanguages = Array.from(VALID_LANGUAGE_CODES)
    .slice(0, 20)
    .join(", ");
  const documentTypesList = Object.keys(DOCUMENT_TYPES).join(", ");

  const response = await openai.responses.parse({
    model: "gpt-5-nano",
    input: [
      {
        role: "system",
        content:
          "You are a precise document analyzer that classifies documents by type and detects their primary language. Return only valid structured responses.",
      },
      {
        role: "user",
        content: `Analyze this document and provide both document type classification and language detection.

        Classification rules:
        - Document type options: ${documentTypesList}
        - Look for key indicators: 
          * Citations, references, abstracts (academic)
          * Financial data, budgets, reports (financial)  
          * Legal language, contracts, terms (legal)
          * Step-by-step instructions, procedures (technical/manual)
          * News format, journalism, press releases (news)
          * Creative writing, novels, essays, books (literature)
        - If unsure about type, use "general"

        Language detection:
        - Detect the primary language and return the ISO 639-1 code
        - Supported languages include: ${supportedLanguages}, and others
        - If unsure about language, use "en"

        Document sample:
        ${sample}`,
      },
    ],
    reasoning: {
      effort: "minimal",
    },
    max_output_tokens: 200, // Increased slightly since we need reasoning for classification
    text: {
      format: zodTextFormat(
        DocumentClassificationSchema,
        "document_classification"
      ),
    },
  });

  console.log("Document classification response:", response);

  const validatedResult = response.output_parsed;

  if (!validatedResult) {
    console.warn("Failed to parse document classification from OpenAI");
    return {
      documentType: "general",
      language: "en",
    };
  }

  return {
    documentType: validatedResult.documentType,
    language: validatedResult.language,
  };
}

//   const response = await fetch("https://api.openai.com/v1/chat/completions", {
//     method: "POST",
//     headers: {
//       Authorization: `Bearer ${process.env.OPENAI_SECRET_KEY}`,
//       "Content-Type": "application/json",
//     },
//     body: JSON.stringify({
//       model: "gpt-4o-mini",
//       response_format: { type: "json_object" },
//       messages: [
//         {
//           role: "user",
//           content: `Analyze this document and provide both document type classification and language detection.

// Respond in this exact JSON format:
// {"documentType": "document_type", "language": "language_code"}

// Classification rules:
// - Document type options: ${documentTypes}
// - Look for key indicators: citations (academic), financial data (financial), legal language (legal), step-by-step instructions (technical/manual)
// - If unsure about type, use "general"

// Language detection:
// - Detect the primary language and return the ISO 639-1 code (e.g., "en", "es", "fr", "de", etc.)
// - If unsure about language, use "en"

// Document sample:
// ${sample}`,
//         },
//       ],
//       temperature: 0,
//       max_tokens: 100,
//     }),
//   });

// if (!response.ok) {
//   console.warn(`Document classification failed: ${response.status}`);
//   return {
//     documentType: "general",
//     language: "en",
//   };
// }

// const data = await response.json();
// const content = data.choices[0].message.content.trim();

// try {
//   const parsed = JSON.parse(content);
//   const documentType = isValidDocumentType(parsed.documentType)
//     ? parsed.documentType
//     : "general";
//   const language = VALID_LANGUAGE_CODES.has(parsed.language)
//     ? parsed.language
//     : "en";

//   return { documentType, language };
// } catch (error) {
//   console.warn("Failed to parse JSON response:", error);
//   return {
//     documentType: "general",
//     language: "en",
//   };
// }

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request body
    if (!body.text || typeof body.text !== "string") {
      return NextResponse.json(
        {
          error: "Invalid request: text field is required and must be a string",
        },
        { status: 400 }
      );
    }

    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_SECRET_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    const { documentType, language } = await classifyDocumentAndLanguage(
      body.text
    );

    return NextResponse.json({
      documentType,
      language,
      success: true,
    });
  } catch (error) {
    console.error("Document classification error:", error);

    return NextResponse.json(
      { error: "Internal server error during document classification" },
      { status: 500 }
    );
  }
}

// Optional: Add GET method for health check
export async function GET() {
  return NextResponse.json({
    message: "Document classification API is running",
    supportedMethods: ["POST"],
    expectedPayload: { text: "string" },
  });
}
