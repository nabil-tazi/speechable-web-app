import { TextSplitterStream } from "kokoro-js";
import type { Segment, Sentence } from "../types";

/**
 * Split segment text into sentences using Kokoro's TextSplitterStream.
 * This is the ONLY place splitting happens - used for both display and audio generation.
 */
export function splitIntoSentences(text: string): string[] {
  const splitter = new TextSplitterStream();

  // Same tokenization pattern that Kokoro uses internally
  const tokens = text.match(/\s*\S+/g) || [text];
  for (const token of tokens) {
    splitter.push(token);
  }

  splitter.close();

  return Array.from(splitter);
}

/**
 * Create sentences from segments. Called once when document loads.
 * This creates a unified list of sentences that are used for both
 * display (highlighting) and audio generation.
 */
export function createSentencesFromSegments(segments: Segment[]): Sentence[] {
  const sentences: Sentence[] = [];
  let globalIndex = 0;

  for (const segment of segments) {
    const texts = splitIntoSentences(segment.text);

    for (let sentenceIndex = 0; sentenceIndex < texts.length; sentenceIndex++) {
      const text = texts[sentenceIndex];
      // Skip empty sentences
      if (!text || text.trim().length === 0) continue;

      sentences.push({
        id: `${segment.segmentIndex}-${sentenceIndex}`,
        text,
        segmentIndex: segment.segmentIndex,
        sentenceIndex,
        globalIndex: globalIndex++,
        reader_id: segment.reader_id,
      });
    }
  }

  return sentences;
}

/**
 * Convert raw speech segments from document to typed Segments.
 */
export function parseSegmentsFromProcessedText(
  processedText: string
): Segment[] {
  try {
    const parsed = JSON.parse(processedText);
    const segments: Segment[] = [];
    let segmentIndex = 0;

    if (parsed.processed_text?.sections) {
      for (const section of parsed.processed_text.sections) {
        if (section.content?.speech) {
          for (const speechItem of section.content.speech) {
            if (speechItem.text && speechItem.reader_id) {
              segments.push({
                text: speechItem.text,
                reader_id: speechItem.reader_id,
                segmentIndex: segmentIndex++,
              });
            }
          }
        }
      }
    }

    return segments;
  } catch {
    return [];
  }
}
