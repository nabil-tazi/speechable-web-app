import { NextRequest, NextResponse } from "next/server";
import { zodTextFormat } from "openai/helpers/zod.mjs";
import OpenAI from "openai";

import { z } from "zod";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_SECRET_KEY,
});

const SECTION_IDENTIFICATION_PROMPT2 = `Find section titles in this document.

Look for:
- An abstract at the beginning of the document
- Common academic sections: Abstract, Introduction, Methods, Results, Discussion, Conclusion,...
- Top level numbered sections
- Other standalone major headings that divide the document

IGNORE:
- Figure/table captions
- References or Bibliography entries

For each TOP-LEVEL title you find, return:
- title: The exact title text (e.g., "1. Introduction")
- startMarker: the first 5-7 words of the section content (e.g., the words after "1. Introduction")

Focus on major document divisions only. Each section should contain substantial content.`;

//original prompt
const SECTION_IDENTIFICATION_PROMPT = `You are a document structure analyzer. Your task is to identify ONLY the main top-level sections that divide a document.

WHAT TO IDENTIFY:
- Main numbered sections (1., 2., 3., I., II., III., etc.)
- Standard academic paper sections: Abstract, Introduction, Methods, Results, Discussion, Conclusion, References
- Major standalone headings that represent primary document divisions
- Sections that contain substantial content (multiple paragraphs)

WHAT TO IGNORE:
- Subsections
- Figure captions, table captions
- Individual reference entries
- Author information, affiliations
- Acknowledgments (unless it's a major section)
- Appendix subsections (identify only "Appendix" or "Appendices")
- References section at the end of the document

EXAMPLES OF TOP-LEVEL SECTIONS:
✅ "Abstract"
✅ "1. Introduction" 
✅ "2. Methods"
✅ "Discussion and Conclusions"
✅ "References"

EXAMPLES OF WHAT NOT TO IDENTIFY:
❌ "2.1 Data Collection" (subsection)
❌ "Figure 1: Sample data" (caption)
❌ "Smith, J. (2020)..." (reference entry)
❌ "2.1.1 Statistical Analysis" (sub-subsection)

INSTRUCTIONS:
1. Scan the document for section boundaries
2. For each top-level section found, extract:
   - title: The exact heading text
   - startMarker: The first 6-8 words of content that follows the heading (not the heading itself)
   - order: Sequential number starting from 1

Be conservative - if you're unsure whether something is a top-level section, don't include it.`;

interface IdentifiedSection {
  title: string;
  startMarker: string; // first 5 words after title
  order: number;
}

interface SectionIdentificationResult {
  sections: IdentifiedSection[];
}

interface StructuredSection {
  title: string;
  content: string;
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

function extractSectionContent(
  fullText: string,
  currentSection: IdentifiedSection,
  nextSection?: IdentifiedSection
): string {
  // Helper function to find start marker with fallback
  function findStartMarker(text: string, marker: string): number {
    let currentMarker = marker;
    let startIndex = -1;

    // Try progressively shorter versions of the marker
    while (currentMarker.length > 0 && startIndex === -1) {
      console.log("looking for: ", currentMarker);
      startIndex = text.indexOf(currentMarker);
      if (startIndex === -1) {
        // Remove the last word and try again
        const words = currentMarker.trim().split(/\s+/);
        if (words.length <= 1) {
          break; // Can't reduce further
        }
        words.pop(); // Remove last word
        currentMarker = words.join(" ");
        console.log("not found, trying with a shorter start marker");
      }
    }

    return startIndex;
  }

  // Find the start position using the startMarker with fallback
  const startIndex = findStartMarker(fullText, currentSection.startMarker);
  if (startIndex === -1) {
    throw new Error(
      `Could not find any version of start marker: ${currentSection.startMarker}`
    );
  }

  let endIndex: number;

  if (nextSection) {
    // End at the next section's start marker (also with fallback)
    const nextStartIndex = findStartMarker(fullText, nextSection.startMarker);
    if (nextStartIndex === -1 || nextStartIndex <= startIndex) {
      // If we can't find the next section or it's before current section, go to end of document
      endIndex = fullText.length;
    } else {
      endIndex = nextStartIndex;
    }
  } else {
    // This is the last section, go to end of document
    endIndex = fullText.length;
  }

  let extractedContent = fullText.substring(startIndex, endIndex).trim();

  // Check if the content starts with the section title and remove it if present
  const titleToCheck = currentSection.title.trim();
  if (
    titleToCheck &&
    extractedContent.toLowerCase().startsWith(titleToCheck.toLowerCase())
  ) {
    // Remove the title from the beginning
    extractedContent = extractedContent.substring(titleToCheck.length).trim();

    // Also remove any trailing punctuation or numbering that might follow the title
    // Common patterns: "1. Introduction:", "Abstract.", "Methods -", etc.
    extractedContent = extractedContent.replace(/^[:\-\.\s]+/, "").trim();
  }

  return extractedContent;
}

async function identifySections(
  input: string
): Promise<SectionIdentificationResult> {
  const response = await openai.responses.parse({
    model: "gpt-5-nano",
    instructions: SECTION_IDENTIFICATION_PROMPT,
    input: [
      {
        role: "system",
        content:
          "You are a precise document section identifier that returns only valid JSON responses.",
      },
      {
        role: "user",
        content: `${input}`,
      },
    ],
    reasoning: {
      effort: "medium",
    },
    max_output_tokens: 15000,
    text: {
      format: zodTextFormat(
        SectionIdentificationSchema,
        "section_identification"
      ),
    },
  });

  console.log(response);

  const validatedResult = response.output_parsed;

  if (!validatedResult) {
    throw new Error("Failed to parse section identification from OpenAI");
  }

  return validatedResult;
}

function createStructuredDocument(
  fullText: string,
  identifiedSections: SectionIdentificationResult
): StructuredSection[] {
  const sortedSections = identifiedSections.sections.sort(
    (a, b) => a.order - b.order
  );

  return sortedSections.map((section, index) => {
    const nextSection =
      index < sortedSections.length - 1 ? sortedSections[index + 1] : undefined;

    const content = extractSectionContent(fullText, section, nextSection);

    console.log(section.title, " : length of content ");
    console.log(content.length);

    return {
      title: section.title,
      content: content,
    };
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate request body
    if (!body.text || typeof body.text !== "string") {
      return NextResponse.json(
        {
          error: "Invalid request: text field is required and must be a string",
        },
        { status: 400 }
      );
    }

    const identifiedSections = await identifySections(body.text);
    const structuredDocument = createStructuredDocument(
      body.text,
      identifiedSections
    );

    return NextResponse.json({
      identifiedSections,
      structuredDocument,
      success: true,
    });
  } catch (error) {
    console.error("Error processing document:", error);
    return NextResponse.json(
      {
        error: "Failed to process document",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
