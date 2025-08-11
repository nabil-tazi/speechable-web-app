"use client";

import { useState, useRef } from "react";

// Text cleaning function to improve PDF text extraction
function cleanTextContent(text: string): string {
  return (
    text
      // Remove excessive whitespace
      .replace(/\s+/g, " ")
      // Fix common PDF extraction issues
      .replace(/([a-z])([A-Z])/g, "$1 $2") // Add space between camelCase
      .replace(/(\w)([.!?])(\w)/g, "$1$2 $3") // Add space after punctuation
      .replace(/([a-zA-Z])(\d)/g, "$1 $2") // Add space between letters and numbers
      .replace(/(\d)([a-zA-Z])/g, "$1 $2") // Add space between numbers and letters
      // Fix hyphenated words that got split across lines
      .replace(/(\w)-\s*\n\s*(\w)/g, "$1$2")
      // Clean up multiple newlines
      .replace(/\n\s*\n\s*\n/g, "\n\n")
      // Remove leading/trailing whitespace from each line
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n")
      // Final cleanup
      .trim()
  );
}

interface ParsedPDF {
  text: string;
  numPages: number;
  metadata?: any;
  pages: Array<{
    pageNumber: number;
    text: string;
  }>;
}

export default function PDFUploader() {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsedPDF, setParsedPDF] = useState<ParsedPDF | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const processPDF = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setParsedPDF(null);

    try {
      // Dynamic import PDF.js only when needed
      const pdfjsLib = await import("pdfjs-dist");

      // Configure worker
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();

      // Suppress PDF.js metadata warnings
      const originalWarn = console.warn;
      console.warn = (...args) => {
        const message = args[0];
        if (
          typeof message === "string" &&
          (message.includes("Warning: Bad value") ||
            message.includes("AAPL:") ||
            message.includes("Warning: Unknown"))
        ) {
          return;
        }
        originalWarn.apply(console, args);
      };

      // Convert file to ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();

      // Load PDF document
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      // Get metadata
      const metadata = await pdf.getMetadata();

      // Extract text from all pages with better formatting
      const pages: Array<{ pageNumber: number; text: string }> = [];
      let fullText = "";

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();

        // Process text items with position awareness
        const textItems = textContent.items as any[];
        let pageText = "";
        let lastY = 0;
        let lastX = 0;

        for (let i = 0; i < textItems.length; i++) {
          const item = textItems[i];
          const currentY = item.transform[5]; // Y position
          const currentX = item.transform[4]; // X position

          // Check if we're on a new line (significant Y change)
          if (lastY !== 0 && Math.abs(currentY - lastY) > 5) {
            pageText += "\n";
          }
          // Check if there's a significant horizontal gap (new word/sentence)
          else if (lastX !== 0 && currentX - lastX > item.width) {
            pageText += " ";
          }

          // Clean up the text
          let cleanText = item.str;

          // Remove excessive spaces
          cleanText = cleanText.replace(/\s+/g, " ");

          // Add the text
          pageText += cleanText;

          lastY = currentY;
          lastX = currentX + item.width;
        }

        // Final cleanup for the page
        pageText = cleanTextContent(pageText);

        pages.push({
          pageNumber: pageNum,
          text: pageText,
        });

        fullText += pageText + "\n\n";
      }

      // Clean up the full text
      fullText = cleanTextContent(fullText.trim());

      setParsedPDF({
        text: fullText.trim(),
        numPages: pdf.numPages,
        metadata: metadata.info,
        pages,
      });
    } catch (err) {
      console.error("Error processing PDF:", err);
      setError("Failed to process PDF. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">
            PDF Upload & Parser
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Upload a PDF file to extract and analyze its text content.
          </p>
        </div>

        {/* Upload Area */}
        <div className="p-6">
          <div
            className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragOver
                ? "border-blue-400 bg-blue-50"
                : "border-gray-300 hover:border-gray-400"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={handleFileSelect}
              className="hidden"
            />

            {isProcessing ? (
              <div className="flex flex-col items-center">
                <svg
                  className="animate-spin h-12 w-12 text-blue-600 mb-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <p className="text-gray-600">Processing PDF...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <svg
                  className="h-12 w-12 text-gray-400 mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="text-lg font-medium text-gray-900 mb-2">
                  Drop your PDF here
                </p>
                <p className="text-sm text-gray-500 mb-4">
                  or click to browse files
                </p>
                <button
                  onClick={triggerFileInput}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                >
                  Select PDF File
                </button>
              </div>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <div className="mt-4 rounded-md bg-red-50 border border-red-200 p-4">
              <div className="flex">
                <svg
                  className="h-5 w-5 text-red-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
                <div className="ml-3">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Results Display */}
          {parsedPDF && (
            <div className="mt-6 space-y-6">
              {/* PDF Info */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-lg font-medium text-gray-900 mb-3">
                  PDF Information
                </h3>
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-gray-500">Pages:</dt>
                    <dd className="text-gray-900 font-medium">
                      {parsedPDF.numPages}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Characters:</dt>
                    <dd className="text-gray-900 font-medium">
                      {parsedPDF.text.length}
                    </dd>
                  </div>
                  {parsedPDF.metadata?.Title && (
                    <div className="col-span-2">
                      <dt className="text-gray-500">Title:</dt>
                      <dd className="text-gray-900 font-medium">
                        {parsedPDF.metadata.Title}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Extracted Text */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">
                  Extracted Text
                </h3>
                <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto">
                  <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono text-left">
                    {parsedPDF.text}
                  </pre>
                </div>
              </div>

              {/* Page by Page */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">
                  Page-by-Page Content
                </h3>
                <div className="space-y-4">
                  {parsedPDF.pages.map((page) => (
                    <div
                      key={page.pageNumber}
                      className="border border-gray-200 rounded-lg"
                    >
                      <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                        <h4 className="text-sm font-medium text-gray-900">
                          Page {page.pageNumber}
                        </h4>
                      </div>
                      <div className="p-4">
                        <p className="text-sm text-gray-700 line-clamp-3">
                          {page.text.substring(0, 200)}
                          {page.text.length > 200 && "..."}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
