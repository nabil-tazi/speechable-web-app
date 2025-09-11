export interface ProcessedImage {
  file: File;
  text: string;
  confidence: number;
}

export interface OCRProgress {
  imageIndex: number;
  totalImages: number;
  currentImageName: string;
  progress: number; // 0-100
  stage: 'loading' | 'recognizing' | 'completed' | 'error';
}

export interface OCRResult {
  images: ProcessedImage[];
  combinedText: string;
  totalConfidence: number;
}