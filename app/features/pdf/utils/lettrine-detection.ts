import type { StructuredPage, StructuredBlock, StructuredLine, BoundingBox } from "../types";

export interface DetectedLettrine {
  pageNumber: number;
  blockIndex: number;
  lineIndex: number;
  character: string;
  fontSize: number;
  mergedWith: string;
  confidence: number;
  // Target location for merging
  targetBlockIndex: number;
  targetLineIndex: number;
}

export interface LettrineDetectionOptions {
  minFontSizeRatio?: number;
  maxCharCount?: number;
  minConfidence?: number;
  maxLookAhead?: number; // How many lines/blocks to look ahead
}

const DEFAULT_OPTIONS: Required<LettrineDetectionOptions> = {
  minFontSizeRatio: 2.0,  // Drop caps are typically 2-4x larger than body text
  maxCharCount: 3,
  minConfidence: 0.6,     // Require higher confidence to avoid false positives
  maxLookAhead: 10,       // Look up to 10 lines ahead
};

interface ContinuationResult {
  line: StructuredLine;
  blockIndex: number;
  lineIndex: number;
  distance: number; // How many positions ahead
}

/**
 * Check if a line could be a lettrine (drop cap)
 */
function isLettrineCandidate(
  line: StructuredLine,
  averageFontSize: number,
  options: Required<LettrineDetectionOptions>
): boolean {
  const text = line.text.trim();

  if (text.length === 0 || text.length > options.maxCharCount) {
    return false;
  }

  // Must be only letters
  if (!/^[A-Za-z\u00C0-\u024F]+$/.test(text)) {
    return false;
  }

  // Font size must be significantly larger than average (use the configured ratio)
  const fontSizeRatio = line.font.size / averageFontSize;
  if (fontSizeRatio < options.minFontSizeRatio) {
    return false;
  }

  return true;
}

/**
 * Find continuation text by looking ahead multiple lines/blocks
 */
function findContinuationText(
  page: StructuredPage,
  startBlockIdx: number,
  startLineIdx: number,
  options: Required<LettrineDetectionOptions>
): ContinuationResult | null {
  let distance = 0;
  let currentBlockIdx = startBlockIdx;
  let currentLineIdx = startLineIdx + 1; // Start from next line

  while (distance < options.maxLookAhead) {
    // Check if we need to move to next block
    while (currentBlockIdx < page.blocks.length) {
      const block = page.blocks[currentBlockIdx];

      while (currentLineIdx < block.lines.length) {
        const line = block.lines[currentLineIdx];
        const text = line.text.trim();

        distance++;

        // Skip empty lines
        if (text.length === 0) {
          currentLineIdx++;
          continue;
        }

        // Found text! Check if it's a good continuation candidate
        // Strong signal: starts with lowercase (like "ntarctica" for "A" + "ntarctica")
        if (/^[a-z]/.test(text)) {
          console.log(`[Lettrine] Found lowercase continuation at distance ${distance}: "${text.slice(0, 20)}..."`);
          return {
            line,
            blockIndex: currentBlockIdx,
            lineIndex: currentLineIdx,
            distance,
          };
        }

        // Weaker signal: any text within close distance
        if (distance <= 3) {
          console.log(`[Lettrine] Found nearby text at distance ${distance}: "${text.slice(0, 20)}..."`);
          return {
            line,
            blockIndex: currentBlockIdx,
            lineIndex: currentLineIdx,
            distance,
          };
        }

        // Text found but too far and doesn't start with lowercase - not a match
        return null;
      }

      // Move to next block
      currentBlockIdx++;
      currentLineIdx = 0;
    }

    // No more blocks
    break;
  }

  return null;
}

/**
 * Calculate confidence score for a lettrine detection
 */
function calculateLettrineConfidence(
  lettrineLine: StructuredLine,
  continuation: ContinuationResult,
  lineIndex: number,
  averageFontSize: number
): number {
  let confidence = 0;

  // Font size ratio
  const fontSizeRatio = lettrineLine.font.size / averageFontSize;
  if (fontSizeRatio >= 3) confidence += 0.4;
  else if (fontSizeRatio >= 2) confidence += 0.3;
  else if (fontSizeRatio >= 1.5) confidence += 0.25;
  else if (fontSizeRatio >= 1.2) confidence += 0.15;

  // Single character is most confident
  const charCount = lettrineLine.text.trim().length;
  if (charCount === 1) confidence += 0.3;
  else if (charCount <= 3) confidence += 0.15;

  // First line in block
  if (lineIndex === 0) confidence += 0.15;

  // Next line starts with lowercase (continuation of word) - STRONG signal
  const nextText = continuation.line.text.trim();
  if (nextText.length > 0 && /^[a-z]/.test(nextText)) {
    confidence += 0.3; // Increased from 0.2 - very strong signal
  }

  // Next line has substantive text
  if (nextText.length >= 2) confidence += 0.1;

  // Penalize if continuation is far away
  if (continuation.distance > 3) {
    confidence -= 0.1;
  }

  return Math.min(Math.max(confidence, 0), 1);
}

/**
 * Detect and merge lettrines (drop caps) in structured pages
 * Uses look-ahead to find continuation text that may not be adjacent
 */
export function detectAndMergeLettrines(
  pages: StructuredPage[],
  averageFontSize: number,
  options: LettrineDetectionOptions = {}
): {
  processedPages: StructuredPage[];
  detectedLettrines: DetectedLettrine[];
} {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const detectedLettrines: DetectedLettrine[] = [];

  console.log(`[Lettrine] Average font size: ${averageFontSize.toFixed(1)}pt, looking ahead up to ${opts.maxLookAhead} lines`);

  const processedPages = pages.map((page) => {
    const lettrinesOnPage: DetectedLettrine[] = [];

    // Detect lettrines
    for (let blockIdx = 0; blockIdx < page.blocks.length; blockIdx++) {
      const block = page.blocks[blockIdx];

      for (let lineIdx = 0; lineIdx < block.lines.length; lineIdx++) {
        const line = block.lines[lineIdx];

        if (!isLettrineCandidate(line, averageFontSize, opts)) {
          continue;
        }

        // Look ahead to find continuation text
        const continuation = findContinuationText(page, blockIdx, lineIdx, opts);

        if (!continuation) {
          console.log(`[Lettrine] Candidate "${line.text.trim()}" - no continuation found`);
          continue;
        }

        const confidence = calculateLettrineConfidence(
          line,
          continuation,
          lineIdx,
          averageFontSize
        );

        console.log(
          `[Lettrine] "${line.text.trim()}" + "${continuation.line.text.trim().slice(0, 15)}..." ` +
          `(${line.font.size.toFixed(1)}pt, ratio: ${(line.font.size / averageFontSize).toFixed(2)}x, ` +
          `distance: ${continuation.distance}, conf: ${Math.round(confidence * 100)}%)`
        );

        if (confidence >= opts.minConfidence) {
          lettrinesOnPage.push({
            pageNumber: page.pageNumber,
            blockIndex: blockIdx,
            lineIndex: lineIdx,
            character: line.text.trim(),
            fontSize: line.font.size,
            mergedWith: continuation.line.text.trim(),
            confidence,
            targetBlockIndex: continuation.blockIndex,
            targetLineIndex: continuation.lineIndex,
          });
        }
      }
    }

    detectedLettrines.push(...lettrinesOnPage);

    // Build sets of lines/blocks to skip or modify
    const lettrinePositions = new Set(
      lettrinesOnPage.map((l) => `${l.blockIndex}-${l.lineIndex}`)
    );
    const targetMerges = new Map<string, DetectedLettrine>();
    for (const l of lettrinesOnPage) {
      targetMerges.set(`${l.targetBlockIndex}-${l.targetLineIndex}`, l);
    }

    // Also track all lines between lettrine and target that should be skipped
    const linesToSkip = new Set<string>();
    for (const l of lettrinesOnPage) {
      // Skip the lettrine line itself
      linesToSkip.add(`${l.blockIndex}-${l.lineIndex}`);

      // Skip any lines between lettrine and target
      let currentBlock = l.blockIndex;
      let currentLine = l.lineIndex + 1;

      while (currentBlock < l.targetBlockIndex ||
             (currentBlock === l.targetBlockIndex && currentLine < l.targetLineIndex)) {
        if (currentBlock < page.blocks.length) {
          const block = page.blocks[currentBlock];
          if (currentLine < block.lines.length) {
            linesToSkip.add(`${currentBlock}-${currentLine}`);
            currentLine++;
          } else {
            currentBlock++;
            currentLine = 0;
          }
        } else {
          break;
        }
      }
    }

    // Rebuild blocks with merging
    const newBlocks: StructuredBlock[] = [];

    for (let blockIdx = 0; blockIdx < page.blocks.length; blockIdx++) {
      const block = page.blocks[blockIdx];
      const newLines: StructuredLine[] = [];

      for (let lineIdx = 0; lineIdx < block.lines.length; lineIdx++) {
        const lineKey = `${blockIdx}-${lineIdx}`;

        // Skip lines that are lettrines or between lettrine and target
        if (linesToSkip.has(lineKey)) {
          continue;
        }

        const line = block.lines[lineIdx];

        // Check if this line receives a lettrine merge
        const incomingLettrine = targetMerges.get(lineKey);

        if (incomingLettrine) {
          const mergedText = incomingLettrine.character + line.text;
          const lettrineBbox = page.blocks[incomingLettrine.blockIndex].lines[incomingLettrine.lineIndex].bbox;

          console.log(`[Lettrine] Merged: "${mergedText.slice(0, 40)}..."`);

          newLines.push({
            ...line,
            text: mergedText,
            bbox: mergeBboxes(lettrineBbox, line.bbox),
          });
        } else {
          newLines.push(line);
        }
      }

      if (newLines.length > 0) {
        newBlocks.push({
          ...block,
          lines: newLines,
        });
      }
    }

    // Reconstruct rawText
    const newRawText = newBlocks
      .map((block) =>
        block.lines
          .map((line) => line.text)
          .filter((text) => text.trim())
          .join("\n")
      )
      .join("\n\n")
      .trim();

    return {
      ...page,
      blocks: newBlocks,
      rawText: newRawText,
    };
  });

  if (detectedLettrines.length > 0) {
    console.log(`[Lettrine] Total detected: ${detectedLettrines.length} drop caps`);
  } else {
    console.log(`[Lettrine] No drop caps detected`);
  }

  return { processedPages, detectedLettrines };
}

function mergeBboxes(bbox1: BoundingBox, bbox2: BoundingBox): BoundingBox {
  const x = Math.min(bbox1.x, bbox2.x);
  const y = Math.min(bbox1.y, bbox2.y);
  const x2 = Math.max(bbox1.x + bbox1.w, bbox2.x + bbox2.w);
  const y2 = Math.max(bbox1.y + bbox1.h, bbox2.y + bbox2.h);

  return { x, y, w: x2 - x, h: y2 - y };
}
