import { createWorker } from 'tesseract.js';
import type { OCRProgress, OCRResult, ProcessedImage } from '../types';

// Text cleaning function adapted from PDF processing
function cleanOCRText(text: string): string {
  let cleaned = text
    // Remove excessive whitespace
    .replace(/\s+/g, ' ')
    // Fix common OCR issues
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space between camelCase
    .replace(/(\w)([.!?])(\w)/g, '$1$2 $3') // Add space after punctuation
    .replace(/([a-zA-Z])(\d)/g, '$1 $2') // Add space between letters and numbers
    .replace(/(\d)([a-zA-Z])/g, '$1 $2') // Add space between numbers and letters
    // Fix common OCR character misreading
    .replace(/0(?=[A-Za-z])/g, 'O') // Replace 0 with O when followed by letters
    .replace(/1(?=[A-Za-z])/g, 'l') // Replace 1 with l when followed by letters
    .replace(/(\w)l(?=\w)/g, '$11') // Replace l with 1 in middle of words if needed
    // Remove line breaks that break words
    .replace(/(\w)-?\n\s*(\w)/g, '$1$2')
    .replace(/\n\s*\n\s*\n/g, '\n\n');

  // Split into lines, clean each line, and rejoin
  cleaned = cleaned
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n')
    .trim();

  return cleaned;
}

// Validate image file
function validateImageFile(file: File): { valid: boolean; error?: string } {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'];
  
  if (!allowedTypes.includes(file.type)) {
    return { 
      valid: false, 
      error: `Unsupported image type: ${file.type}. Please use JPEG, PNG, GIF, BMP, or WebP.` 
    };
  }

  // 10MB limit
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    return { 
      valid: false, 
      error: `Image too large: ${Math.round(file.size / 1024 / 1024)}MB. Maximum size is 10MB.` 
    };
  }

  return { valid: true };
}

// Process single image with OCR
async function processImageWithOCR(
  file: File,
  onProgress?: (progress: OCRProgress) => void,
  imageIndex: number = 0,
  totalImages: number = 1
): Promise<ProcessedImage> {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Report progress - loading
  if (onProgress) {
    onProgress({
      imageIndex,
      totalImages,
      currentImageName: file.name,
      progress: 0,
      stage: 'loading'
    });
  }

  // Create tesseract worker with English language (v6 API)
  const worker = await createWorker('eng');
  
  try {
    // Configure for better accuracy
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?;:()-\'\"',
      tessedit_pageseg_mode: '1', // Automatic page segmentation with OSD
    });

    // Perform OCR (without logger to avoid serialization issues)
    const result = await worker.recognize(file);
    
    // Update progress to recognizing stage
    if (onProgress) {
      onProgress({
        imageIndex,
        totalImages,
        currentImageName: file.name,
        progress: 50,
        stage: 'recognizing'
      });
    }

    // Clean the extracted text
    const cleanedText = cleanOCRText(result.data.text);
    
    // Report completion
    if (onProgress) {
      onProgress({
        imageIndex,
        totalImages,
        currentImageName: file.name,
        progress: 100,
        stage: 'completed'
      });
    }

    return {
      file,
      text: cleanedText,
      confidence: result.data.confidence
    };
    
  } finally {
    // Always terminate worker to free memory
    await worker.terminate();
  }
}

// Process multiple images
export async function processImagesWithOCR(
  files: File[],
  onProgress?: (progress: OCRProgress) => void
): Promise<OCRResult> {
  if (files.length === 0) {
    throw new Error('No images provided for OCR processing');
  }

  const results: ProcessedImage[] = [];
  let totalConfidence = 0;

  // Process images sequentially to avoid memory issues
  for (let i = 0; i < files.length; i++) {
    try {
      const result = await processImageWithOCR(
        files[i],
        onProgress,
        i,
        files.length
      );
      
      results.push(result);
      totalConfidence += result.confidence;
      
    } catch (error) {
      // Report error for this image
      if (onProgress) {
        onProgress({
          imageIndex: i,
          totalImages: files.length,
          currentImageName: files[i].name,
          progress: 0,
          stage: 'error'
        });
      }
      
      // Re-throw error to stop processing
      throw new Error(`Failed to process ${files[i].name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Combine all extracted text
  const combinedText = results
    .map(result => result.text)
    .filter(text => text.trim().length > 0)
    .join('\n\n');

  const averageConfidence = results.length > 0 ? totalConfidence / results.length : 0;

  return {
    images: results,
    combinedText,
    totalConfidence: averageConfidence
  };
}