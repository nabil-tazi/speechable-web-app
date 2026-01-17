import { v4 as uuidv4 } from "uuid";
import type {
  Block,
  BlockType,
  ProcessedText,
  ProcessedSection,
} from "@/app/features/documents/types";
import type { TTSSection } from "@/app/features/pdf/helpers/remove-highlights";

/**
 * Converts processed_text JSON structure to blocks array.
 *
 * Input structure:
 * { processed_text: { sections: [{ title, level?, content: { speech: [{ text, reader_id }] } }] } }
 *
 * Output: Block[] with proper ordering
 */
export function convertProcessedTextToBlocks(processedTextJson: string): Block[] {
  const blocks: Block[] = [];
  let order = 0;
  const now = new Date().toISOString();

  try {
    const parsed: ProcessedText = JSON.parse(processedTextJson);

    if (!parsed.processed_text?.sections) {
      return [];
    }

    for (const section of parsed.processed_text.sections) {
      // Add section title as heading block
      if (section.title) {
        const headingType = getHeadingType(section.level);
        blocks.push({
          id: uuidv4(),
          type: headingType,
          content: section.title,
          reader_id: "Narrator",
          order: order++,
          audio_stale: false,
          created_at: now,
          updated_at: now,
        });
      }

      // Add speech items as text blocks
      if (section.content?.speech) {
        for (const speechItem of section.content.speech) {
          if (speechItem.text?.trim()) {
            blocks.push({
              id: uuidv4(),
              type: "text",
              content: speechItem.text,
              reader_id: speechItem.reader_id || "Narrator",
              order: order++,
              audio_stale: false,
              created_at: now,
              updated_at: now,
            });
          }
        }
      }
    }
  } catch (error) {
    console.error("Failed to convert processed_text to blocks:", error);
  }

  return blocks;
}

function getHeadingType(level?: number): BlockType {
  switch (level) {
    case 1:
      return "heading1";
    case 2:
      return "heading2";
    case 3:
      return "heading3";
    case 4:
      return "heading4";
    default:
      return "heading1";
  }
}

/**
 * Clean up punctuation issues in text content.
 * Fixes common problems from PDF extraction like orphaned punctuation,
 * missing spaces, and multiple consecutive spaces.
 */
function cleanupPunctuation(text: string): string {
  return text
    .trim()
    // Remove leading punctuation (., ,, ;, :, etc.)
    .replace(/^[.,;:!?'")\]}\-–—]+\s*/, '')
    // Remove space before punctuation
    .replace(/\s+([.,;:!?'")\]}])/g, '$1')
    // Ensure space after punctuation (except at end of string)
    .replace(/([.,;:!?])([A-Za-z])/g, '$1 $2')
    // Fix multiple spaces
    .replace(/\s{2,}/g, ' ')
    // Trim again
    .trim();
}

/**
 * Converts blocks array back to processed_text JSON structure.
 * Used for backwards compatibility with existing TTS system.
 */
export function convertBlocksToProcessedText(blocks: Block[]): string {
  const sections: ProcessedSection[] = [];
  let currentSection: ProcessedSection | null = null;

  const sortedBlocks = [...blocks].sort((a, b) => a.order - b.order);

  for (const block of sortedBlocks) {
    if (block.type.startsWith("heading")) {
      // Start a new section
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        title: block.content,
        level:
          block.type === "heading1" ? 1 : block.type === "heading2" ? 2 : block.type === "heading3" ? 3 : 4,
        content: { speech: [] },
      };
    } else if (block.type === "text") {
      // Add to current section or create default section
      if (!currentSection) {
        currentSection = {
          title: "Content",
          content: { speech: [] },
        };
      }
      currentSection.content.speech.push({
        text: block.content,
        reader_id: block.reader_id,
      });
    }
  }

  // Don't forget the last section
  if (currentSection) {
    sections.push(currentSection);
  }

  return JSON.stringify({
    processed_text: { sections },
  });
}

/**
 * Converts TTSSection array directly to blocks.
 * This skips the processed_text JSON intermediate step.
 *
 * Input: TTSSection[] with { title, level, content }
 * Output: Block[] with headings and text blocks
 */
export function convertTTSSectionsToBlocks(sections: TTSSection[]): Block[] {
  const blocks: Block[] = [];
  let order = 0;
  const now = new Date().toISOString();

  for (const section of sections) {
    // Add section title as heading block
    if (section.title) {
      const headingType = getHeadingType(section.level);
      blocks.push({
        id: uuidv4(),
        type: headingType,
        content: section.title,
        reader_id: "Narrator",
        order: order++,
        audio_stale: false,
        created_at: now,
        updated_at: now,
      });
    }

    // Split content into paragraphs and create text blocks
    if (section.content?.trim()) {
      const paragraphs = section.content
        .split(/\n\n+/)
        .map(p => cleanupPunctuation(p))
        .filter(p => p.length > 0);

      for (const paragraph of paragraphs) {
        blocks.push({
          id: uuidv4(),
          type: "text",
          content: paragraph,
          reader_id: "Narrator",
          order: order++,
          audio_stale: false,
          created_at: now,
          updated_at: now,
        });
      }
    }
  }

  return blocks;
}
