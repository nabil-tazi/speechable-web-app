import type { OCRProgress, OCRResult, ProcessedImage } from '../types';

interface APIResponse {
  success: boolean;
  images: {
    filename: string;
    text: string;
    confidence: number;
    character_count: number;
    lines_detected: number;
    error?: string;
  }[];
  combined_text: string;
  total_confidence: number;
  image_count: number;
  error?: string;
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

// Compress image before upload if needed
async function compressImage(file: File, maxSize: number = 1024 * 1024): Promise<File> {
  if (file.size <= maxSize) {
    return file;
  }

  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      // Calculate new dimensions to reduce file size
      let { width, height } = img;
      const maxDimension = 1920;
      
      if (Math.max(width, height) > maxDimension) {
        const ratio = maxDimension / Math.max(width, height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;
      
      // Draw and compress
      ctx?.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob((blob) => {
        if (blob) {
          const compressedFile = new File([blob], file.name, {
            type: 'image/jpeg',
            lastModified: file.lastModified
          });
          resolve(compressedFile);
        } else {
          resolve(file); // Fallback to original
        }
      }, 'image/jpeg', 0.8);
    };

    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

// Process multiple images using PaddleOCR API
export async function processImagesWithOCR(
  files: File[],
  onProgress?: (progress: OCRProgress) => void
): Promise<OCRResult> {
  if (files.length === 0) {
    throw new Error('No images provided for OCR processing');
  }

  // Validate all files first
  for (let i = 0; i < files.length; i++) {
    const validation = validateImageFile(files[i]);
    if (!validation.valid) {
      throw new Error(`Invalid file ${files[i].name}: ${validation.error}`);
    }
  }

  try {
    // Report initial progress
    if (onProgress) {
      onProgress({
        imageIndex: 0,
        totalImages: files.length,
        currentImageName: 'Preparing images...',
        progress: 0,
        stage: 'loading'
      });
    }

    // Compress images if needed
    const compressedFiles = await Promise.all(
      files.map(async (file, index) => {
        if (onProgress) {
          onProgress({
            imageIndex: index,
            totalImages: files.length,
            currentImageName: `Compressing ${file.name}`,
            progress: Math.round((index / files.length) * 30), // 0-30% for compression
            stage: 'loading'
          });
        }
        return await compressImage(file);
      })
    );

    // Create FormData for API request
    const formData = new FormData();
    compressedFiles.forEach((file, index) => {
      formData.append('images', file);
    });

    // Report upload progress
    if (onProgress) {
      onProgress({
        imageIndex: 0,
        totalImages: files.length,
        currentImageName: 'Uploading to server...',
        progress: 40,
        stage: 'loading'
      });
    }

    // Make API request with progress tracking
    const response = await fetch('/api/ocr', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status} ${response.statusText}`);
    }

    // Report processing progress
    if (onProgress) {
      onProgress({
        imageIndex: 0,
        totalImages: files.length,
        currentImageName: 'Processing with PaddleOCR...',
        progress: 70,
        stage: 'recognizing'
      });
    }

    const apiResponse: APIResponse = await response.json();

    if (!apiResponse.success) {
      throw new Error(apiResponse.error || 'OCR processing failed');
    }

    // Convert API response to our format
    const processedImages: ProcessedImage[] = apiResponse.images.map((img, index) => {
      // Report progress for each completed image
      if (onProgress) {
        onProgress({
          imageIndex: index,
          totalImages: files.length,
          currentImageName: img.filename,
          progress: 80 + Math.round((index / files.length) * 20), // 80-100%
          stage: 'completed'
        });
      }

      return {
        file: files[index],
        text: img.text || '',
        confidence: img.confidence || 0
      };
    });

    // Final completion
    if (onProgress) {
      onProgress({
        imageIndex: files.length - 1,
        totalImages: files.length,
        currentImageName: 'Processing complete!',
        progress: 100,
        stage: 'completed'
      });
    }

    return {
      images: processedImages,
      combinedText: apiResponse.combined_text || '',
      totalConfidence: apiResponse.total_confidence || 0
    };

  } catch (error) {
    console.error('OCR API error:', error);
    throw new Error(
      error instanceof Error 
        ? error.message 
        : 'Failed to process images with OCR API'
    );
  }
}