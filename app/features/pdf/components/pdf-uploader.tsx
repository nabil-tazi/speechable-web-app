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
  const [isCleaningText, setIsCleaningText] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [parsedPDF, setParsedPDF] = useState<ParsedPDF | null>(null);
  const [cleanedText, setCleanedText] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

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

  const cleanTextWithOpenAI = async (text: string) => {
    setIsCleaningText(true);
    setError(null);

    try {
      // Get first 500 characters
      const textToClean = text.substring(0, 500);

      const response = await fetch("/api/openai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: textToClean,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to clean text");
      }

      const data = await response.json();
      setCleanedText(data.message);
    } catch (err) {
      console.error("Error cleaning text:", err);
      setError(
        err instanceof Error ? err.message : "Failed to clean text with OpenAI"
      );
    } finally {
      setIsCleaningText(false);
    }
  };

  const generateAudio = async () => {
    if (!cleanedText) return;

    setIsGeneratingAudio(true);
    setError(null);

    try {
      // const response = await fetch("/api/lemonfox", {
      //   method: "POST",
      //   headers: {
      //     "Content-Type": "application/json",
      //   },
      //   body: JSON.stringify({
      //     input: cleanedText,
      //     voice: "onyx", //"nicole",
      //     response_format: "mp3",
      //   }),
      // });

      const response = await fetch("/api/gtts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: parsedPDF?.text, lang: "en" }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate audio");
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      setAudioUrl(audioUrl);
    } catch (err) {
      console.error("Error generating audio:", err);
      setError(err instanceof Error ? err.message : "Failed to generate audio");
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const playAudio = () => {
    if (audioRef.current && audioUrl) {
      audioRef.current.play();
    }
  };

  const downloadAudio = () => {
    if (audioUrl) {
      const link = document.createElement("a");
      link.href = audioUrl;
      link.download = "cleaned-text-speech.mp3";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const processPDF = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setParsedPDF(null);
    setCleanedText(null);
    setAudioUrl(null);

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

      const pdfData = {
        text: fullText.trim(),
        numPages: pdf.numPages,
        metadata: metadata.info,
        pages,
      };

      setParsedPDF(pdfData);

      // Automatically clean the first 500 characters with OpenAI
      if (fullText.trim().length > 0) {
        await cleanTextWithOpenAI(fullText.trim());
      }
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
            PDF Upload & Text-to-Speech
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Upload a PDF file to extract text, clean it with AI, and convert to
            speech.
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

              {/* OpenAI Cleaned Text */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-medium text-gray-900">
                    AI-Cleaned Text (First 500 characters)
                  </h3>
                  {isCleaningText && (
                    <div className="flex items-center text-sm text-blue-600">
                      <svg
                        className="animate-spin h-4 w-4 mr-2"
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
                      Cleaning text...
                    </div>
                  )}
                </div>
                {cleanedText ? (
                  <div className="space-y-4">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <p className="text-sm text-green-800 whitespace-pre-wrap">
                        {cleanedText}
                      </p>
                    </div>

                    {/* TTS Controls */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-md font-medium text-blue-900">
                          Text-to-Speech
                        </h4>
                        {isGeneratingAudio && (
                          <div className="flex items-center text-sm text-blue-600">
                            <svg
                              className="animate-spin h-4 w-4 mr-2"
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
                            Generating audio...
                          </div>
                        )}
                      </div>

                      {!audioUrl && !isGeneratingAudio && (
                        <button
                          onClick={generateAudio}
                          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                        >
                          <svg
                            className="h-4 w-4 mr-2"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M9 12a3 3 0 106 0v-5a3 3 0 00-6 0v5z"
                            />
                          </svg>
                          Convert to Speech
                        </button>
                      )}

                      {audioUrl && (
                        <div className="space-y-4">
                          {/* Audio Player */}
                          <audio
                            ref={audioRef}
                            src={audioUrl}
                            controls
                            className="w-full"
                          />

                          {/* Action Buttons */}
                          <div className="flex gap-3">
                            <button
                              onClick={playAudio}
                              className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors"
                            >
                              <svg
                                className="h-4 w-4 mr-2"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h8m2-4a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                              </svg>
                              Play
                            </button>

                            <button
                              onClick={downloadAudio}
                              className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                            >
                              <svg
                                className="h-4 w-4 mr-2"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                />
                              </svg>
                              Download MP3
                            </button>

                            <button
                              onClick={generateAudio}
                              className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                            >
                              <svg
                                className="h-4 w-4 mr-2"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                />
                              </svg>
                              Regenerate
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : isCleaningText ? (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center">
                      <svg
                        className="animate-spin h-4 w-4 text-blue-600 mr-2"
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
                      <p className="text-sm text-blue-800">
                        Cleaning text with AI...
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <button
                      onClick={() => cleanTextWithOpenAI(parsedPDF.text)}
                      className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-blue-700 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      Clean Text with AI
                    </button>
                  </div>
                )}
              </div>

              {/* Original Text Preview */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">
                  Original Text (First 500 characters)
                </h3>
                <div className="bg-gray-50 rounded-lg p-4">
                  <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono text-left">
                    {parsedPDF.text.substring(0, 500)}
                    {parsedPDF.text.length > 500 && "..."}
                  </pre>
                </div>
              </div>

              {/* Full Extracted Text */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">
                  Full Extracted Text
                </h3>
                <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto">
                  <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono text-left">
                    {parsedPDF.text}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
