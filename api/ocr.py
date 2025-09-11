import io
import json
import logging
from typing import List, Dict, Any
from PIL import Image, ImageEnhance
import numpy as np
from paddleocr import PaddleOCR
from http.server import BaseHTTPRequestHandler
import cgi

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class OCRHandler(BaseHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Initialize PaddleOCR with English language
        # Use CPU to avoid memory issues on serverless
        self.ocr = PaddleOCR(
            use_angle_cls=True,  # Enable text angle classification
            lang='en',  # English language
            use_gpu=False,  # Use CPU for serverless compatibility
            show_log=False  # Reduce noise in logs
        )
        super().__init__(*args, **kwargs)
    
    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def do_POST(self):
        """Handle OCR requests"""
        try:
            # Set CORS headers
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            
            # Parse multipart form data
            content_type = self.headers.get('content-type')
            if not content_type or 'multipart/form-data' not in content_type:
                self._send_error(400, "Content-Type must be multipart/form-data")
                return
            
            # Parse form data
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={'REQUEST_METHOD': 'POST'}
            )
            
            # Process uploaded images
            results = []
            image_count = 0
            
            for field_name in form.keys():
                if field_name.startswith('image'):
                    field = form[field_name]
                    if field.filename:
                        image_count += 1
                        logger.info(f"Processing image {image_count}: {field.filename}")
                        
                        # Read image data
                        image_data = field.file.read()
                        
                        # Process image with OCR
                        result = self._process_image(image_data, field.filename, image_count)
                        results.append(result)
            
            if not results:
                self._send_error(400, "No valid images found in request")
                return
            
            # Combine results
            combined_text = "\n\n".join([r["text"] for r in results if r["text"].strip()])
            average_confidence = sum([r["confidence"] for r in results]) / len(results)
            
            response_data = {
                "success": True,
                "images": results,
                "combined_text": combined_text,
                "total_confidence": average_confidence,
                "image_count": len(results)
            }
            
            self.wfile.write(json.dumps(response_data).encode())
            
        except Exception as e:
            logger.error(f"OCR processing error: {str(e)}")
            self._send_error(500, f"OCR processing failed: {str(e)}")
    
    def _process_image(self, image_data: bytes, filename: str, index: int) -> Dict[str, Any]:
        """Process a single image with OCR"""
        try:
            # Load image
            image = Image.open(io.BytesIO(image_data))
            
            # Preprocess image
            processed_image = self._preprocess_image(image)
            
            # Convert to numpy array for PaddleOCR
            img_array = np.array(processed_image)
            
            # Perform OCR
            ocr_result = self.ocr.ocr(img_array, cls=True)
            
            # Parse results
            text_parts = []
            confidences = []
            
            if ocr_result and ocr_result[0]:
                for line in ocr_result[0]:
                    if line and len(line) >= 2:
                        text = line[1][0]  # Extracted text
                        confidence = line[1][1]  # Confidence score
                        
                        if text and text.strip():
                            text_parts.append(text.strip())
                            confidences.append(confidence)
            
            # Clean and combine text
            combined_text = self._clean_text(" ".join(text_parts))
            average_confidence = sum(confidences) / len(confidences) if confidences else 0
            
            return {
                "filename": filename,
                "text": combined_text,
                "confidence": average_confidence * 100,  # Convert to percentage
                "character_count": len(combined_text),
                "lines_detected": len(text_parts)
            }
            
        except Exception as e:
            logger.error(f"Error processing image {filename}: {str(e)}")
            return {
                "filename": filename,
                "text": "",
                "confidence": 0,
                "error": str(e),
                "character_count": 0,
                "lines_detected": 0
            }
    
    def _preprocess_image(self, image: Image.Image) -> Image.Image:
        """Preprocess image for better OCR results"""
        try:
            # Convert to RGB if needed
            if image.mode != 'RGB':
                image = image.convert('RGB')
            
            # Resize large images to optimize processing
            max_size = 2048
            if max(image.size) > max_size:
                ratio = max_size / max(image.size)
                new_size = tuple(int(dim * ratio) for dim in image.size)
                image = image.resize(new_size, Image.Resampling.LANCZOS)
            
            # Enhance contrast slightly for better OCR
            enhancer = ImageEnhance.Contrast(image)
            image = enhancer.enhance(1.2)
            
            # Enhance sharpness slightly
            enhancer = ImageEnhance.Sharpness(image)
            image = enhancer.enhance(1.1)
            
            return image
            
        except Exception as e:
            logger.warning(f"Image preprocessing failed: {str(e)}")
            return image  # Return original if preprocessing fails
    
    def _clean_text(self, text: str) -> str:
        """Clean and normalize extracted text"""
        if not text:
            return ""
        
        # Remove excessive whitespace
        text = " ".join(text.split())
        
        # Fix common OCR issues
        replacements = [
            # Common character misreading
            ("0", "O"),  # In word contexts, 0 is often O
            ("1", "l"),  # In word contexts, 1 is often l
            # Add more replacements as needed
        ]
        
        # Apply replacements cautiously (only in word contexts)
        for old, new in replacements:
            # Replace only when surrounded by letters
            import re
            pattern = f"(?<=[a-zA-Z]){old}(?=[a-zA-Z])"
            text = re.sub(pattern, new, text)
        
        # Remove line breaks that break words
        text = text.replace("-\n", "").replace("\n", " ")
        
        # Normalize multiple spaces
        text = " ".join(text.split())
        
        return text.strip()
    
    def _send_error(self, status: int, message: str):
        """Send error response"""
        self.send_response(status)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        
        error_response = {
            "success": False,
            "error": message
        }
        
        self.wfile.write(json.dumps(error_response).encode())

def handler(request):
    """Vercel serverless function handler"""
    class VercelRequest:
        def __init__(self, request):
            self.request = request
            self.method = request.method
            self.headers = dict(request.headers)
            self.body = request.get_data()
    
    class VercelResponse:
        def __init__(self):
            self.status_code = 200
            self.headers = {}
            self.body = b""
        
        def set_status(self, code):
            self.status_code = code
        
        def set_header(self, key, value):
            self.headers[key] = value
        
        def write(self, data):
            if isinstance(data, str):
                data = data.encode()
            self.body += data
    
    try:
        # Handle CORS preflight
        if request.method == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                },
                'body': ''
            }
        
        if request.method != 'POST':
            return {
                'statusCode': 405,
                'headers': {'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({"success": False, "error": "Method not allowed"})
            }
        
        # Initialize OCR
        ocr = PaddleOCR(use_angle_cls=True, lang='en', use_gpu=False, show_log=False)
        
        # Get uploaded files
        files = request.files.getlist('images')
        if not files:
            return {
                'statusCode': 400,
                'headers': {'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({"success": False, "error": "No images provided"})
            }
        
        results = []
        for i, file in enumerate(files):
            try:
                # Load and preprocess image
                image = Image.open(file.stream)
                if image.mode != 'RGB':
                    image = image.convert('RGB')
                
                # Resize if too large
                max_size = 2048
                if max(image.size) > max_size:
                    ratio = max_size / max(image.size)
                    new_size = tuple(int(dim * ratio) for dim in image.size)
                    image = image.resize(new_size, Image.Resampling.LANCZOS)
                
                # Enhance for OCR
                enhancer = ImageEnhance.Contrast(image)
                image = enhancer.enhance(1.2)
                
                # Convert to numpy array
                img_array = np.array(image)
                
                # Perform OCR
                ocr_result = ocr.ocr(img_array, cls=True)
                
                # Parse results
                text_parts = []
                confidences = []
                
                if ocr_result and ocr_result[0]:
                    for line in ocr_result[0]:
                        if line and len(line) >= 2:
                            text = line[1][0]
                            confidence = line[1][1]
                            
                            if text and text.strip():
                                text_parts.append(text.strip())
                                confidences.append(confidence)
                
                # Clean text
                combined_text = " ".join(text_parts).strip()
                average_confidence = sum(confidences) / len(confidences) if confidences else 0
                
                results.append({
                    "filename": file.filename or f"image_{i+1}",
                    "text": combined_text,
                    "confidence": average_confidence * 100,
                    "character_count": len(combined_text),
                    "lines_detected": len(text_parts)
                })
                
            except Exception as e:
                results.append({
                    "filename": file.filename or f"image_{i+1}",
                    "text": "",
                    "confidence": 0,
                    "error": str(e),
                    "character_count": 0,
                    "lines_detected": 0
                })
        
        # Combine results
        combined_text = "\n\n".join([r["text"] for r in results if r["text"].strip()])
        average_confidence = sum([r["confidence"] for r in results]) / len(results) if results else 0
        
        response_data = {
            "success": True,
            "images": results,
            "combined_text": combined_text,
            "total_confidence": average_confidence,
            "image_count": len(results)
        }
        
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            'body': json.dumps(response_data)
        }
        
    except Exception as e:
        logger.error(f"Handler error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({"success": False, "error": str(e)})
        }