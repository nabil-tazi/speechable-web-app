import type { Segment, Sentence } from "../types";
import type { Block } from "@/app/features/documents/types";
import { getDisabledBlockIds } from "@/app/features/block-editor/utils/disabled-sections";

// Minimum characters for a sentence group to be emitted.
// Short sentences accumulate until this threshold is reached.
// ~15 chars/second speaking rate, so 120 chars ≈ 8 seconds of audio.
const MIN_GROUP_CHARS = 120;

/**
 * Split segment text into sentences using sentencex (multilingual).
 * This is the ONLY place splitting happens - used for both display and audio generation.
 */
export function splitIntoSentences(text: string, languageCode: string = "en"): string[] {
  let sentences: string[];

  try {
    // Use Intl.Segmenter for locale-aware sentence splitting (built-in browser API)
    const SegmenterClass = (Intl as any).Segmenter;
    if (!SegmenterClass) throw new Error("Intl.Segmenter not available");
    const segmenter = new SegmenterClass(languageCode, { granularity: "sentence" });
    sentences = Array.from(segmenter.segment(text), (s: any) => (s.segment as string).trim()).filter((s) => s.length > 0);
  } catch {
    // Fallback to manual splitting if Intl.Segmenter is unavailable
    sentences = manualSentenceSplit(text);
  }

  if (sentences.length === 0) {
    sentences = [text];
  }

  // Debug: log when we get unexpectedly few splits for long text
  const DEBUG_SENTENCE_SPLITTER = false;
  if (DEBUG_SENTENCE_SPLITTER) {
    const avgSentenceLength = text.length / Math.max(1, sentences.length);
    if (avgSentenceLength > 200 && sentences.length < 3) {
      console.warn(
        `[sentence-splitter] Possible under-splitting: ${text.length} chars → ${sentences.length} sentences (avg ${avgSentenceLength.toFixed(0)} chars/sentence)`
      );
      console.warn(
        `[sentence-splitter] Text preview: "${text.slice(0, 100)}..."`
      );
      console.warn(`[sentence-splitter] Sentences:`, sentences);
    }
  }

  // Fallback: if any sentence is too long, try manual splitting on that sentence
  // This handles edge cases where Kokoro's splitter doesn't recognize sentence boundaries
  const MAX_SENTENCE_LENGTH = 400;
  const needsFallback = sentences.some(s => s.length > MAX_SENTENCE_LENGTH);

  if (needsFallback) {
    const expandedSentences: string[] = [];
    for (const sentence of sentences) {
      if (sentence.length > MAX_SENTENCE_LENGTH) {
        const manualSplit = manualSentenceSplit(sentence);
        if (manualSplit.length > 1) {
          if (DEBUG_SENTENCE_SPLITTER) {
            console.log(
              `[sentence-splitter] Fallback split long sentence (${sentence.length} chars) → ${manualSplit.length} sentences`
            );
          }
          expandedSentences.push(...manualSplit);
        } else {
          expandedSentences.push(sentence);
        }
      } else {
        expandedSentences.push(sentence);
      }
    }
    sentences = expandedSentences;
  }

  return sentences;
}

/**
 * Manual sentence splitting as fallback when Kokoro doesn't split properly.
 * Splits on common sentence-ending punctuation followed by space and capital letter.
 */
function manualSentenceSplit(text: string): string[] {
  // Split on . ! ? followed by space and capital/uppercase letter
  // Also handle quotes: ." !" ?" «» ""
  // Uses Unicode uppercase letter class to support accented characters (À, É, etc.)
  const sentenceEndPattern = /([.!?]["'»"]?\s+)(?=[\p{Lu}«""])/gu;

  const parts = text.split(sentenceEndPattern);

  // Recombine: parts alternate between content and delimiter
  const sentences: string[] = [];
  let current = "";

  for (let i = 0; i < parts.length; i++) {
    current += parts[i];
    // Check if this part is a delimiter (ends with space)
    if (parts[i].match(/[.!?]["'»"]?\s+$/)) {
      sentences.push(current.trim());
      current = "";
    }
  }

  // Don't forget the last part
  if (current.trim()) {
    sentences.push(current.trim());
  }

  return sentences.filter((s) => s.length > 0);
}

/**
 * Group short sentences together to ensure minimum audio duration.
 * This improves TTS quality (especially for expressive mode) and ensures
 * enough generation buffer time for seamless playback.
 *
 * Sentences accumulate until combined length >= MIN_GROUP_CHARS,
 * then emit as a single group. Grouping stops at newlines to preserve
 * paragraph boundaries. Remaining sentences are flushed at segment end.
 *
 * IMPORTANT: We extract actual substrings from originalText to preserve
 * original whitespace for proper display matching.
 */
export function groupSentences(
  sentences: string[],
  originalText: string,
  minChars = MIN_GROUP_CHARS
): string[] {
  if (sentences.length === 0) return [];

  const groups: string[] = [];

  // Find positions of each sentence in original text
  const positions: Array<{ start: number; end: number }> = [];
  let searchFrom = 0;
  for (const sentence of sentences) {
    const start = originalText.indexOf(sentence, searchFrom);
    if (start === -1) {
      // Fallback: if we can't find it, use the sentence as-is
      positions.push({ start: -1, end: -1 });
    } else {
      positions.push({ start, end: start + sentence.length });
      searchFrom = start + sentence.length;
    }
  }

  // Helper to flush buffer and create a group
  const flushBuffer = (startIdx: number, endIdx: number) => {
    if (startIdx > endIdx) return;
    const startPos = positions[startIdx].start;
    const endPos = positions[endIdx].end;

    if (startPos >= 0 && endPos >= 0) {
      groups.push(originalText.slice(startPos, endPos));
    } else {
      groups.push(sentences.slice(startIdx, endIdx + 1).join(" "));
    }
  };

  let bufferStartIdx = 0;
  let bufferLength = 0;

  for (let i = 0; i < sentences.length; i++) {
    bufferLength += sentences[i].length;

    // Check if there's a newline between this sentence and the next
    const hasNewlineAfter = i < sentences.length - 1 &&
      positions[i].end >= 0 &&
      positions[i + 1].start >= 0 &&
      originalText.slice(positions[i].end, positions[i + 1].start).includes('\n');

    // Flush if we hit minChars OR if there's a newline after this sentence
    if (bufferLength >= minChars || hasNewlineAfter) {
      flushBuffer(bufferStartIdx, i);
      bufferStartIdx = i + 1;
      bufferLength = 0;
    }
  }

  // Flush remaining sentences
  if (bufferStartIdx < sentences.length) {
    flushBuffer(bufferStartIdx, sentences.length - 1);
  }

  return groups;
}

/**
 * Create sentences from segments. Called once when document loads.
 * This creates a unified list of sentences that are used for both
 * display (highlighting) and audio generation.
 */
export function createSentencesFromSegments(segments: Segment[], languageCode: string = "en"): Sentence[] {
  const sentences: Sentence[] = [];
  let globalIndex = 0;

  for (const segment of segments) {
    // Handle title segments (from block-based model)
    if (segment.isTitle) {
      sentences.push({
        id: `${segment.segmentIndex}-title`,
        text: segment.text,
        segmentIndex: segment.segmentIndex,
        sentenceIndex: -1,
        globalIndex: globalIndex++,
        reader_id: segment.reader_id,
        sectionTitle: segment.text,
        sectionLevel: segment.sectionLevel,
        isFirstInSection: true,
        isTitle: true,
      });
      continue;
    }

    // Handle legacy isFirstInSection (from processed_text model)
    if (segment.isFirstInSection && segment.sectionTitle) {
      sentences.push({
        id: `${segment.segmentIndex}-title`,
        text: segment.sectionTitle,
        segmentIndex: segment.segmentIndex,
        sentenceIndex: -1,
        globalIndex: globalIndex++,
        reader_id: segment.reader_id,
        sectionTitle: segment.sectionTitle,
        sectionLevel: segment.sectionLevel,
        isFirstInSection: true,
        isTitle: true,
      });
    }

    const rawSentences = splitIntoSentences(segment.text, languageCode);
    const groupedTexts = groupSentences(rawSentences, segment.text);

    // Debug: log grouping
    if (rawSentences.length !== groupedTexts.length) {
      console.log(
        `[sentence-splitter] Grouped ${rawSentences.length} sentences → ${groupedTexts.length} groups`
      );
    }

    for (
      let sentenceIndex = 0;
      sentenceIndex < groupedTexts.length;
      sentenceIndex++
    ) {
      const text = groupedTexts[sentenceIndex];
      // Skip empty sentences
      if (!text || text.trim().length === 0) continue;

      sentences.push({
        id: `${segment.segmentIndex}-${sentenceIndex}`,
        text,
        segmentIndex: segment.segmentIndex,
        sentenceIndex,
        globalIndex: globalIndex++,
        reader_id: segment.reader_id,
        sectionTitle: segment.sectionTitle,
        sectionLevel: segment.sectionLevel,
        isFirstInSection: false,
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
          let isFirstInSection = true;
          for (const speechItem of section.content.speech) {
            if (speechItem.text && speechItem.reader_id) {
              segments.push({
                text: speechItem.text,
                reader_id: speechItem.reader_id,
                segmentIndex: segmentIndex++,
                sectionTitle: section.title,
                sectionLevel: section.level ?? 1,
                isFirstInSection,
              });
              isFirstInSection = false;
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

/**
 * Convert blocks to segments for TTS processing.
 * Each block becomes a segment - headings are marked with isTitle.
 * Disabled sections (heading + content until next same/higher level heading) are skipped.
 */
export function parseSegmentsFromBlocks(blocks: Block[]): Segment[] {
  const segments: Segment[] = [];
  let segmentIndex = 0;

  // Get all disabled block IDs (includes headings and their cascaded content)
  const disabledIds = getDisabledBlockIds(blocks);

  const sortedBlocks = [...blocks].sort((a, b) => a.order - b.order);

  for (const block of sortedBlocks) {
    // Skip disabled blocks
    if (disabledIds.has(block.id)) continue;

    if (!block.content.trim()) continue;

    if (block.type.startsWith("heading")) {
      const sectionLevel =
        block.type === "heading1"
          ? 1
          : block.type === "heading2"
          ? 2
          : block.type === "heading3"
          ? 3
          : 4;

      segments.push({
        text: block.content,
        reader_id: block.reader_id,
        segmentIndex: segmentIndex++,
        sectionLevel,
        isTitle: true,
      });
    } else if (block.type === "text") {
      segments.push({
        text: block.content,
        reader_id: block.reader_id,
        segmentIndex: segmentIndex++,
        isTitle: false,
      });
    }
  }

  return segments;
}
