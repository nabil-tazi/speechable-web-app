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

// Compress image before upload - balanced for OCR quality vs size
async function compressImage(file: File, maxSize: number = 2 * 1024 * 1024): Promise<File> { // 2MB target - much more reasonable for OCR
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      // Keep larger dimensions for better OCR accuracy
      let { width, height } = img;
      const maxDimension = 2048; // Increased back to reasonable size for OCR
      
      if (Math.max(width, height) > maxDimension) {
        const ratio = maxDimension / Math.max(width, height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;
      
      // Draw image
      ctx?.drawImage(img, 0, 0, width, height);
      
      // Try compression with OCR-friendly settings
      const tryCompress = (quality: number) => {
        canvas.toBlob((blob) => {
          if (blob && (blob.size <= maxSize || quality <= 0.5)) {
            // Accept result if under size limit OR we've tried reasonable quality levels
            const compressedFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: file.lastModified
            });
            resolve(compressedFile);
          } else if (quality > 0.5) {
            // Try slightly lower quality but don't go too low
            tryCompress(quality - 0.1);
          } else {
            // If still too big at quality 0.5, only slightly reduce dimensions
            const newWidth = Math.round(width * 0.9); // Only 10% reduction, not 20%
            const newHeight = Math.round(height * 0.9);
            
            // Don't let it get too small for OCR
            if (newWidth > 800 && newHeight > 600) {
              width = newWidth;
              height = newHeight;
              canvas.width = width;
              canvas.height = height;
              ctx?.drawImage(img, 0, 0, width, height);
              tryCompress(0.8); // Start with higher quality again
            } else {
              // Accept current result rather than making it unreadable
              const compressedFile = new File([blob!], file.name, {
                type: 'image/jpeg',
                lastModified: file.lastModified
              });
              resolve(compressedFile);
            }
          }
        }, 'image/jpeg', quality);
      };

      // Start with high quality for OCR
      tryCompress(0.9);
    };

    img.onerror = () => {
      // If image loading fails, try to return a very compressed version
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      canvas.toBlob((blob) => {
        if (blob) {
          const fallbackFile = new File([blob], file.name, {
            type: 'image/jpeg',
            lastModified: file.lastModified
          });
          resolve(fallbackFile);
        } else {
          resolve(file);
        }
      }, 'image/jpeg', 0.5);
    };
    
    img.src = URL.createObjectURL(file);
  });
}

// Re-export the original client-side Tesseract.js implementation
export { processImagesWithOCR } from './image-processing';