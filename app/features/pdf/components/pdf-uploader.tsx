"use client";

import { useState } from "react";

import { ParsedPDF, PreprocessingLevel, ProcessingMetadata } from "../types";
import ProcessingLevelSelector from "../../speech/components/processing-level-selector";
import PDFUploadArea from "./upload-area";
import PDFResultsDisplay from "./pdf-results-display";
import PDFDocumentOverview from "./pdf-overview";
import { processPDFFile } from "../utils/pdf-processing";

import {
  createDocumentAction,
  updateDocumentAction,
  uploadDocumentThumbnailAction,
} from "../../documents/actions";

// Add new types for document classification
type DocumentClassification = {
  documentType: string;
  language: string;
};

// Add type for file info
type FileInfo = {
  name: string;
  size: number;
  thumbnailUrl: string | null;
};

type Props = {
  userId: string;
};

export default function PDFUploader({ userId }: Props) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [isCleaningText, setIsCleaningText] = useState(false);
  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(
    null
  );
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [parsedPDF, setParsedPDF] = useState<ParsedPDF | null>(null);
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [classification, setClassification] =
    useState<DocumentClassification | null>(null);
  const [cleanedText, setCleanedText] = useState<string | null>(null);
  const [preprocessingLevel, setPreprocessingLevel] =
    useState<PreprocessingLevel>(1);
  const [processingMetadata, setProcessingMetadata] =
    useState<ProcessingMetadata | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const pdfFile = files.find((file) => file.type === "application/pdf");

    if (pdfFile) {
      processPDF(pdfFile);
    } else {
      setError("Please upload a PDF file");
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type === "application/pdf") {
        processPDF(file);
      } else {
        setError("Please select a PDF file");
      }
    }
  };

  // Function to generate PDF thumbnail
  const generatePDFThumbnail = async (file: File): Promise<string | null> => {
    try {
      const pdfjsLib = await import("pdfjs-dist");

      // Configure worker
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1); // Get first page

      const scale = 0.5; // Reduce scale for thumbnail
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) return null;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
        canvas: canvas,
      };

      await page.render(renderContext).promise;

      return canvas.toDataURL("image/png");
    } catch (error) {
      console.error("Error generating PDF thumbnail:", error);
      return null;
    }
  };

  async function classifyDocument(
    text: string
  ): Promise<{ documentType: string; language: string } | null> {
    setIsClassifying(true);
    setError(null);

    try {
      const response = await fetch("/api/classify-document", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Classification failed: ${response.status}`
        );
      }

      const data = await response.json();
      const classification = {
        documentType: data.documentType,
        language: data.language,
      };

      setClassification(classification);
      setError(null);

      return classification; // Return the classification object
    } catch (err) {
      console.error("Error classifying document:", err);
      setError(
        err instanceof Error ? err.message : "Failed to classify document"
      );
      return null; // Return null on error
    } finally {
      setIsClassifying(false);
    }
  }

  async function cleanTextWithOpenAI(text: string, retryCount = 0) {
    const maxRetries = 2;
    setIsCleaningText(true);
    setError(null);

    try {
      const response = await fetch("/api/openai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: text,
          level: preprocessingLevel,
          documentType: classification?.documentType,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        // Handle specific error codes
        if (
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504
        ) {
          if (retryCount < maxRetries) {
            setError(
              `Server temporarily unavailable, retrying... (${retryCount + 1}/${
                maxRetries + 1
              })`
            );
            await new Promise((resolve) =>
              setTimeout(resolve, (retryCount + 1) * 1000)
            );
            return cleanTextWithOpenAI(text, retryCount + 1);
          } else {
            throw new Error(
              "OpenAI service is temporarily unavailable. Please try again in a few minutes."
            );
          }
        } else if (response.status === 429) {
          throw new Error(
            "Rate limit exceeded. Please wait a moment and try again."
          );
        } else if (response.status === 401) {
          throw new Error(
            "Authentication failed. Please check your API configuration."
          );
        } else if (response.status >= 400 && response.status < 500) {
          throw new Error(
            errorData.error ||
              `Request failed (${response.status}). Please check your input and try again.`
          );
        } else {
          throw new Error(
            errorData.error || `OpenAI API error: ${response.status}`
          );
        }
      }

      const data = await response.json();
      setCleanedText(data.message);
      setProcessingMetadata(data.metadata);

      setError(null);
    } catch (err) {
      console.error("Error processing text:", err);

      if (err instanceof TypeError && err.message.includes("fetch")) {
        setError("Network error. Please check your connection and try again.");
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to process text with AI. Please try again.");
      }
    } finally {
      setIsCleaningText(false);
    }
  }

  const generateAudio = async (customText?: string) => {
    const textToConvert = customText || cleanedText;
    if (!textToConvert) return;

    setIsGeneratingAudio(true);
    setError(null);

    try {
      const response = await fetch("/api/lemonfox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: textToConvert.slice(0, 1000),
          voice: "onyx",
          response_format: "mp3",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate audio");
      }

      const audioBlob = await response.blob();
      const newAudioUrl = URL.createObjectURL(audioBlob);

      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }

      setAudioUrl(newAudioUrl);
    } catch (err) {
      console.error("Error generating audio:", err);
      setError(err instanceof Error ? err.message : "Failed to generate audio");
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const processPDF = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setParsedPDF(null);
    setFileInfo(null);
    setClassification(null);
    setCleanedText(null);
    setProcessingMetadata(null);

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(null);

    try {
      // Generate thumbnail and process PDF in parallel
      const thumbnailPromise = generatePDFThumbnail(file);
      const pdfProcessingPromise = processPDFFile(file);

      const [pdfData, thumbnailDataUrl] = await Promise.all([
        pdfProcessingPromise,
        thumbnailPromise,
      ]);

      setParsedPDF(pdfData);

      let thumbnailFile: File | null = null;
      let thumbnailUrl: string | null = null;

      // Handle thumbnail data URL
      if (thumbnailDataUrl) {
        // Use the data URL directly for display
        thumbnailUrl = thumbnailDataUrl;

        // Convert data URL to File for upload to Supabase
        try {
          const response = await fetch(thumbnailDataUrl);
          const blob = await response.blob();
          thumbnailFile = new File([blob], `${file.name}-thumbnail.png`, {
            type: "image/png",
          });
        } catch (error) {
          console.warn("Failed to convert thumbnail data URL to File:", error);
        }
      }

      setFileInfo({
        name: file.name,
        size: file.size,
        thumbnailUrl: thumbnailUrl,
      });

      console.log(userId);

      // Create document record
      const { data: doc, error: docError } = await createDocumentAction({
        mime_type: file.type || "application/pdf",
        filename: file.name, // Use actual filename
        original_filename: file.name, // Use actual original filename
        document_type: "",
        raw_text: pdfData.text, // Store the extracted text
        page_count: pdfData.numPages, // Store page count if available
        file_size: file.size,
        metadata: {
          // Store any additional PDF metadata
          extractedAt: new Date().toISOString(),
          processingMethod: "client-side", // or whatever method you're using
          ...pdfData.metadata, // Include any metadata from PDF processing
        },
      });

      // Check for errors
      if (docError || !doc) {
        throw new Error(docError || "Failed to create document");
      }

      // Upload thumbnail to Supabase Storage (only if thumbnail was generated)
      if (thumbnailDataUrl) {
        console.log("About to upload thumbnail for document:", doc.id);
        console.log("Thumbnail data URL length:", thumbnailDataUrl.length);

        const { success, error: thumbError } =
          await uploadDocumentThumbnailAction(doc.id, thumbnailDataUrl);

        if (!success) {
          console.error("Thumbnail upload failed:", thumbError);
          // Don't throw here, just warn since document creation succeeded
          setError(
            `Document created but thumbnail upload failed: ${thumbError}`
          );
        } else {
          console.log("Thumbnail uploaded successfully");
        }
      }

      // Clean up the local thumbnail URL after upload
      // (Keep it for now if you want to display it immediately)

      // Store document ID for later use (creating versions, etc.)
      setCurrentDocumentId(doc.id); // You'll need this state

      // Classify document if we have text
      if (pdfData.text.trim().length > 0) {
        const result = await classifyDocument(pdfData.text.trim());

        if (result) {
          updateDocumentAction(doc.id, {
            language: result.language,
            document_type: result.documentType,
          });
        }
      }

      console.log("Document created successfully:", doc);
    } catch (err) {
      console.error("Error processing PDF:", err);
      setError("Failed to process PDF. Please try again.");

      // Clean up thumbnail URL on error
      // if (thumbnailUrl) {
      //   URL.revokeObjectURL(thumbnailUrl);
      // }
    } finally {
      setIsProcessing(false);
    }
  };

  const resetDocument = () => {
    setParsedPDF(null);
    setFileInfo(null);
    setClassification(null);
    setCleanedText(null);
    setProcessingMetadata(null);
    setError(null);

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
  };

  const startProcessing = () => {
    if (parsedPDF?.text) {
      cleanTextWithOpenAI(parsedPDF.text);
    }
  };

  const reprocessText = () => {
    if (parsedPDF?.text) {
      cleanTextWithOpenAI(parsedPDF.text);
    }
  };

  const handleTextUpdate = (newText: string) => {
    setCleanedText(newText);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">
            PDF to Speech with AI Processing
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Upload a PDF file for document classification and AI processing.
          </p>
        </div>

        {/* Conditional Upload Area or Document Overview */}
        {!parsedPDF ? (
          /* Upload Area */
          <PDFUploadArea
            isDragOver={isDragOver}
            isProcessing={isProcessing || isClassifying}
            error={error}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onFileSelect={handleFileSelect}
          />
        ) : (
          /* Document Overview */
          <PDFDocumentOverview
            parsedPDF={parsedPDF}
            fileInfo={fileInfo}
            classification={classification}
            isClassifying={isClassifying}
            onReset={resetDocument}
          />
        )}

        {/* Processing Controls - Only show after classification */}
        {parsedPDF && classification && (
          <>
            {/* Processing Level Selector */}
            <ProcessingLevelSelector
              level={preprocessingLevel}
              onLevelChange={setPreprocessingLevel}
              canReprocess={!!cleanedText}
              isProcessing={isCleaningText}
              onReprocess={reprocessText}
              handleProcessWithAi={startProcessing}
            />
          </>
        )}

        {/* Results Display */}
        {parsedPDF && cleanedText && (
          <div className="p-6">
            <PDFResultsDisplay
              parsedPDF={parsedPDF}
              cleanedText={cleanedText}
              processingMetadata={processingMetadata}
              isCleaningText={isCleaningText}
              audioUrl={audioUrl}
              isGeneratingAudio={isGeneratingAudio}
              error={error}
              onProcessText={startProcessing}
              onGenerateAudio={generateAudio}
              onTextUpdate={handleTextUpdate}
            />
          </div>
        )}
      </div>
    </div>
  );
}
