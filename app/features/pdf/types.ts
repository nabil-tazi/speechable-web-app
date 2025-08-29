// types/pdf.ts
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
      "Natural conversation between two speakers discussing the document topic",
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
