// types/pdf.ts

// MuPDF.js structured text types
export interface FontInfo {
  name: string;
  family: string;
  size: number;
  weight: string;
  style: string;
  isSuperscript?: boolean;
}

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StructuredLine {
  text: string;
  bbox: BoundingBox;
  font: FontInfo;
  wmode: number;
  // Character boundary positions for detecting word breaks across lines
  firstCharX?: number;  // X position of first character's left edge
  lastCharX?: number;   // X position of last character's right edge
}

export interface StructuredBlock {
  type: string;
  bbox: BoundingBox;
  lines: StructuredLine[];
}

// Removable highlight types (cleaned when hiding tagged sections)
export type RemovableHighlightType = 'anomaly' | 'legend' | 'footnote' | 'figure_label' | 'reference' | 'header' | 'footer' | 'page_number' | 'author' | 'heading' | 'url' | 'email' | 'toc' | 'bibliography';

// All highlight types including permanent markers
// NOTE: 'section_start' is deprecated - use 'heading' with enriched properties instead
export type HighlightType = RemovableHighlightType | 'section_start';

// Array of removable types for filtering
export const REMOVABLE_HIGHLIGHT_TYPES: RemovableHighlightType[] = [
  'anomaly', 'legend', 'footnote', 'figure_label', 'reference', 'header', 'footer', 'page_number', 'author', 'heading', 'url', 'email', 'toc', 'bibliography'
];

export interface TextHighlight {
  start: number;  // Character index in rawText
  end: number;    // Character index (exclusive)
  type: HighlightType;
  // For 'heading' type (enriched with PDF outline metadata when available):
  sectionTitle?: string;   // The section title (detected text, e.g., "2. Methods")
  sectionLevel?: number;   // The section level (1, 2, 3...) - from outline or font hierarchy
  verified?: boolean;      // True if heading matched a PDF outline entry
}

/**
 * Font information for a range of text.
 * Used to preserve font metadata through text joining for heading detection.
 */
export interface FontRange {
  start: number;      // Character offset in text
  end: number;        // Character offset (exclusive)
  size: number;       // Font size (rounded to 0.1)
  weight: 'normal' | 'bold';
  italic: boolean;    // Whether font is italic/oblique
}

/**
 * Heading candidate detected at block level (Stage 1).
 * Contains scoring information for Stage 2 validation.
 */
export interface BlockHeadingCandidate {
  textStart: number;         // Position in joined text
  textEnd: number;           // End position (exclusive)
  text: string;              // The heading text
  score: number;             // Total score from all factors
  factors: string[];         // Contributing factors for debugging
  fontSize: number;          // Dominant font size
  fontWeight: string;        // Dominant font weight
  italic: boolean;           // Whether italic
  verticalGapBefore: number; // Gap from previous block (px)
}

export interface StructuredPage {
  pageNumber: number;
  width: number;
  height: number;
  blocks: StructuredBlock[];
  rawText: string;
  highlights?: TextHighlight[];
  fontRanges?: FontRange[];
  headingCandidates?: BlockHeadingCandidate[]; // Stage 1 heading candidates (block-level)
}

export interface DetectedArtifact {
  type: "page_number" | "header" | "footer" | "watermark" | "footnote";
  text: string;
  pageNumber: number;
  bbox: BoundingBox;
}

export interface DetectedHeading {
  text: string;
  fontSize: number;
  fontWeight: string;
  pageNumber: number;
  bbox: BoundingBox;
}

// Outline-based section matching types
export interface OutlineEntry {
  title: string;
  page: number;
  level: number;
}

export interface OutlineMatch {
  outlineEntry: OutlineEntry;
  matchedLine: StructuredLine | null;
  matchedPageNumber: number;
  matchedBlockIndex: number;
  matchedLineIndex: number;
  matchConfidence: 'high' | 'medium' | 'none';
  skipped?: boolean;
  skipReason?: 'legend' | 'no_match';
}

export interface OutlineSectionWithContent {
  title: string;
  level: number;
  pageNumber: number;
  content: string;
  startPosition: { page: number; blockIndex: number; lineIndex: number };
  endPosition: { page: number; blockIndex: number; lineIndex: number } | null;
}

// Extended ParsedPDF with structured text
export interface ParsedPDFExtended {
  text: string;
  numPages: number;
  metadata?: Record<string, unknown>;
  pages: Array<{
    pageNumber: number;
    text: string;
  }>;
  // New MuPDF fields
  structuredPages?: StructuredPage[];
  averageFontSize?: number;
  detectedHeadings?: DetectedHeading[];
  removedArtifacts?: DetectedArtifact[];
}

// Legacy type for backward compatibility
export interface ParsedPDF {
  text: string;
  numPages: number;
  metadata?: any;
  pages: Array<{
    pageNumber: number;
    text: string;
  }>;
}

export interface ProcessingMetadata {
  level: number;
  detectedDocumentType?: string;
  processingMethod?: string;
  originalLength: number;
  processedLength: number;
}

export type ProcessingType = {
  name: string;
  description: string;
  time: string;
  sourceAccuracy: number; // Very close to original
  listeningEase: number; // Hard to listen to (verbose, not optimized)
  useCase: string;
  temperature: number;
};

export const PREPROCESSING_LEVELS = {
  // 0: {
  //   name: "Raw",
  //   description: "Original text without any modifications",
  //   time: "~1s",
  //   sourceAccuracy: 5, // Very close to original
  //   listeningEase: 1, // Hard to listen to (verbose, not optimized)
  //   useCase: "Exact transcription",
  // },
  1: {
    name: "Original",
    description: "Strips away citations, page numbers, and document noise",
    time: "~2s",
    sourceAccuracy: 4.8, // Close to original
    listeningEase: 3.5, // Slightly easier to listen to
    useCase: "Faithful adaptation",
    temperature: 0,
  },
  2: {
    name: "Natural",
    description:
      "Moderate rephrasing for better flow and natural speech patterns",
    time: "~5s",
    sourceAccuracy: 4.3, // Moderately faithful
    listeningEase: 4.2, // Good listening experience
    useCase: "General listening",
    temperature: 0.2,
  },
  3: {
    name: "Lecture", //didactic
    description:
      "Breaks down complex concepts and restructures content for easier learning",
    time: "~8s",
    sourceAccuracy: 3.5, // Substantially changed
    listeningEase: 5, // Very easy to listen to
    useCase: "Educational content",
    temperature: 0.4,
  },
  4: {
    name: "Conversational",
    description:
      "Natural conversation between two speakers covering the document content",
    time: "~15s",
    sourceAccuracy: 3, // Far from original
    listeningEase: 5, // Extremely easy to listen to
    useCase: "Conversational format",
    temperature: 0.6,
  },
} as const;

export const PROCESSING_ARRAY: ProcessingType[] =
  Object.values(PREPROCESSING_LEVELS);

export type PreprocessingLevel = 0 | 1 | 2 | 3;
