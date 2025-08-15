import { useState, useCallback, useRef } from "react";
import {
  PREPROCESSING_LEVELS,
  type ParsedPDF,
  type ProcessingMetadata,
  type PreprocessingLevel,
} from "@/app/features/pdf/types";
import AudioPlayer from "@/app/features/speech/components/audio-player";

interface PDFResultsDisplayProps {
  parsedPDF: ParsedPDF;
  cleanedText: string | null;
  processingMetadata: ProcessingMetadata | null;
  isCleaningText: boolean;
  audioUrl: string | null;
  isGeneratingAudio: boolean;
  error: string | null;
  onProcessText: () => void;
  onGenerateAudio: (text?: string) => void;
  onTextUpdate?: (newText: string) => void; // New prop to update the cleaned text
}

export default function PDFResultsDisplay({
  parsedPDF,
  cleanedText,
  processingMetadata,
  isCleaningText,
  audioUrl,
  isGeneratingAudio,
  error,
  onProcessText,
  onGenerateAudio,
  onTextUpdate,
}: PDFResultsDisplayProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState("");
  const [useOriginalText, setUseOriginalText] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Debounce text changes to prevent excessive logging
  const debouncedSetEditedText = useCallback((value: string) => {
    // Use requestAnimationFrame to batch updates
    requestAnimationFrame(() => {
      setEditedText(value);
    });
  }, []);

  const handleEditToggle = () => {
    if (!isEditing) {
      // If AI processing failed, start with original text
      if (!cleanedText && parsedPDF?.text) {
        const initialText = parsedPDF.text.substring(0, 2000);
        setEditedText(initialText);
      } else {
        setEditedText(cleanedText || "");
      }
    }
    setIsEditing(!isEditing);
  };

  const handleSaveEdit = () => {
    setIsEditing(false);

    // Update the cleaned text without generating audio
    if (onTextUpdate) {
      onTextUpdate(editedText);
    }

    // If we were using original text as fallback, clear that flag
    if (useOriginalText) {
      setUseOriginalText(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedText(cleanedText || "");
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    debouncedSetEditedText(value);
  };

  const handleGenerateWithCurrent = () => {
    if (isEditing) {
      onGenerateAudio(editedText);
    } else if (useOriginalText) {
      onGenerateAudio(parsedPDF.text.substring(0, 2000));
    } else {
      onGenerateAudio(cleanedText || undefined);
    }
  };

  const handleUseOriginalText = () => {
    setUseOriginalText(true);
    const originalTextSample = parsedPDF.text.substring(0, 2000);
    setEditedText(originalTextSample);
    setIsEditing(true);
  };

  const currentDisplayText = useOriginalText
    ? parsedPDF.text.substring(0, 2000)
    : cleanedText;

  return (
    <div className="mt-6 space-y-6">
      {/* PDF Info */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="text-lg font-medium text-gray-900 mb-3">
          PDF Information
        </h3>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-gray-500">Pages:</dt>
            <dd className="text-gray-900 font-medium">{parsedPDF.numPages}</dd>
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

      {/* Processing Metadata */}
      {processingMetadata && (
        <div className="bg-blue-50 rounded-lg p-4">
          <h3 className="text-lg font-medium text-blue-900 mb-3">
            Processing Information
          </h3>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-blue-600">Level:</dt>
              <dd className="text-blue-900 font-medium">
                {processingMetadata.level} -{" "}
                {processingMetadata.level >= 0 &&
                processingMetadata.level <= 4 &&
                Number.isInteger(processingMetadata.level)
                  ? PREPROCESSING_LEVELS[
                      processingMetadata.level as PreprocessingLevel
                    ].name
                  : "Unknown Level"}
              </dd>
            </div>
            {processingMetadata.detectedDocumentType && (
              <div>
                <dt className="text-blue-600">Document Type:</dt>
                <dd className="text-blue-900 font-medium">
                  {processingMetadata.detectedDocumentType.replace("_", " ")}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-blue-600">Processing Method:</dt>
              <dd className="text-blue-900 font-medium">
                {processingMetadata.processingMethod || "Single call"}
              </dd>
            </div>
            <div>
              <dt className="text-blue-600">Text Reduction:</dt>
              <dd className="text-blue-900 font-medium">
                {Math.round(
                  (1 -
                    processingMetadata.processedLength /
                      processingMetadata.originalLength) *
                    100
                )}
                %
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/* AI Processed Text with Enhanced Error Handling */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-medium text-gray-900">
            {useOriginalText ? "Original Text (Fallback)" : "AI-Processed Text"}
          </h3>
          <div className="flex items-center gap-2">
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
                Processing text...
              </div>
            )}

            {(currentDisplayText || isEditing) && !isCleaningText && (
              <div className="flex gap-2">
                {isEditing ? (
                  <>
                    <button
                      onClick={handleSaveEdit}
                      className="inline-flex items-center px-2 py-1 border border-transparent text-xs font-medium rounded text-green-700 bg-green-100 hover:bg-green-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                    >
                      <svg
                        className="h-3 w-3 mr-1"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      Save
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="inline-flex items-center px-2 py-1 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                    >
                      <svg
                        className="h-3 w-3 mr-1"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleEditToggle}
                    className="inline-flex items-center px-2 py-1 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                  >
                    <svg
                      className="h-3 w-3 mr-1"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                    Edit
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {currentDisplayText ? (
          <div className="space-y-4">
            {isEditing ? (
              <div
                className={`border rounded-lg p-4 ${
                  useOriginalText
                    ? "bg-orange-50 border-orange-200"
                    : "bg-yellow-50 border-yellow-200"
                }`}
              >
                <textarea
                  ref={textareaRef}
                  value={editedText}
                  onChange={handleTextChange}
                  className="w-full h-64 p-3 border border-gray-300 rounded-md resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  placeholder="Edit your text here..."
                  spellCheck={false} // Disable spellcheck to reduce console noise
                />
                <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                  <span>Characters: {editedText.length}</span>
                  <span>
                    {useOriginalText
                      ? "Editing original text - save to update"
                      : "Editing mode - save to update text"}
                  </span>
                </div>
              </div>
            ) : (
              <div
                className={`border rounded-lg p-4 max-h-96 overflow-y-auto ${
                  useOriginalText
                    ? "bg-orange-50 border-orange-200"
                    : "bg-green-50 border-green-200"
                }`}
              >
                <p
                  className={`text-sm whitespace-pre-wrap ${
                    useOriginalText ? "text-orange-800" : "text-green-800"
                  }`}
                >
                  {currentDisplayText}
                </p>
              </div>
            )}

            {/* TTS Controls */}
            <AudioPlayer
              audioUrl={audioUrl}
              isGenerating={isGeneratingAudio}
              onGenerate={handleGenerateWithCurrent}
              onRegenerate={handleGenerateWithCurrent}
            />
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
                Processing text with AI...
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={onProcessText}
                className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-blue-700 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                {error ? "Retry AI Processing" : "Process Text with AI"}
              </button>

              {error && (
                <button
                  onClick={handleUseOriginalText}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                >
                  Use Original Text Instead
                </button>
              )}
            </div>
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
  );
}
