import { useState, useCallback, useRef } from "react";
import {
  PREPROCESSING_LEVELS,
  type ParsedPDF,
  type ProcessingMetadata,
  type PreprocessingLevel,
  PROCESSING_ARRAY,
} from "@/app/features/pdf/types";
import AudioPlayer from "@/app/features/speech/components/audio-player";

// Add new types for the structured content
interface SpeechObject {
  text: string;
  reader_id: string;
}

interface SectionContent {
  speech: SpeechObject[];
}

interface ProcessedSection {
  title: string;
  content: SectionContent;
}

interface ProcessedText {
  processed_text: {
    sections: ProcessedSection[];
  };
}

interface PDFResultsDisplayProps {
  parsedPDF: ParsedPDF;
  cleanedText: string | ProcessedText | null;
  processingMetadata: ProcessingMetadata | null;
  isCleaningText: boolean;
  error: string | null;
  onProcessText: () => void;
  onTextUpdate?: (newText: string) => void;
  // New section-based props
  sectionAudioUrls: Record<number, string>;
  generatingAudioSections: Set<number>;
  onGenerateAudioForSection: (sectionIndex: number) => void;
  onGenerateAllAudio: () => void;
}

export default function PDFResultsDisplay({
  parsedPDF,
  cleanedText,
  processingMetadata,
  isCleaningText,
  error,
  onProcessText,
  onTextUpdate,
  sectionAudioUrls,
  generatingAudioSections,
  onGenerateAudioForSection,
  onGenerateAllAudio,
}: PDFResultsDisplayProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState("");
  const [useOriginalText, setUseOriginalText] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(
    new Set()
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Helper function to determine if cleanedText is structured
  const isStructuredContent = (content: any): content is ProcessedText => {
    return (
      content && typeof content === "object" && content.processed_text?.sections
    );
  };

  // Helper function to convert structured content to plain text
  const structuredToPlainText = (structured: ProcessedText): string => {
    return structured.processed_text.sections
      .map((section) => {
        const speechTexts = section.content.speech
          .map((speech) => speech.text)
          .join(" ");
        return `${section.title}\n\n${speechTexts}`;
      })
      .join("\n\n---\n\n");
  };

  // Get plain text version for editing and fallbacks
  const getPlainTextContent = (): string => {
    if (!cleanedText) return "";
    if (typeof cleanedText === "string") return cleanedText;
    if (isStructuredContent(cleanedText))
      return structuredToPlainText(cleanedText);
    return "";
  };

  const toggleSection = (index: number) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedSections(newExpanded);
  };

  const debouncedSetEditedText = useCallback((value: string) => {
    requestAnimationFrame(() => {
      setEditedText(value);
    });
  }, []);

  const handleEditToggle = () => {
    if (!isEditing) {
      if (!cleanedText && parsedPDF?.text) {
        const initialText = parsedPDF.text.substring(0, 2000);
        setEditedText(initialText);
      } else {
        setEditedText(getPlainTextContent());
      }
    }
    setIsEditing(!isEditing);
  };

  const handleSaveEdit = () => {
    setIsEditing(false);
    if (onTextUpdate) {
      onTextUpdate(editedText);
    }
    if (useOriginalText) {
      setUseOriginalText(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedText(getPlainTextContent());
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    debouncedSetEditedText(value);
  };

  const handleUseOriginalText = () => {
    setUseOriginalText(true);
    const originalTextSample = parsedPDF.text.substring(0, 2000);
    setEditedText(originalTextSample);
    setIsEditing(true);
  };

  const currentDisplayText = useOriginalText
    ? parsedPDF.text.substring(0, 2000)
    : getPlainTextContent();

  // Render structured content with individual audio players
  const renderStructuredContent = (structured: ProcessedText) => {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-medium text-gray-700">
            {structured.processed_text.sections.length} sections processed
          </h4>
          <div className="flex gap-2">
            <button
              onClick={onGenerateAllAudio}
              disabled={generatingAudioSections.size > 0}
              className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generatingAudioSections.size > 0
                ? `Generating ${generatingAudioSections.size}...`
                : "Generate All Audio"}
            </button>
            <button
              onClick={() => {
                if (
                  expandedSections.size ===
                  structured.processed_text.sections.length
                ) {
                  setExpandedSections(new Set());
                } else {
                  setExpandedSections(
                    new Set(structured.processed_text.sections.map((_, i) => i))
                  );
                }
              }}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              {expandedSections.size ===
              structured.processed_text.sections.length
                ? "Collapse All"
                : "Expand All"}
            </button>
          </div>
        </div>

        {structured.processed_text.sections.map((section, sectionIndex) => (
          <div
            key={sectionIndex}
            className="border border-gray-200 rounded-lg overflow-hidden"
          >
            {/* Section Header */}
            <button
              onClick={() => toggleSection(sectionIndex)}
              className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between text-left transition-colors"
            >
              <div className="flex items-center space-x-3">
                <span className="text-xs font-mono text-gray-500 bg-white px-2 py-1 rounded">
                  {sectionIndex + 1}
                </span>
                <h3 className="font-medium text-gray-900 truncate">
                  {section.title}
                </h3>
                <span className="text-xs text-gray-500">
                  {section.content.speech.length} speech
                  {section.content.speech.length !== 1 ? "s" : ""}
                </span>
                {sectionAudioUrls[sectionIndex] && (
                  <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
                    Audio Ready
                  </span>
                )}
                {generatingAudioSections.has(sectionIndex) && (
                  <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
                    Generating...
                  </span>
                )}
              </div>
              <svg
                className={`w-4 h-4 text-gray-500 transition-transform ${
                  expandedSections.has(sectionIndex) ? "rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {/* Section Content */}
            {expandedSections.has(sectionIndex) && (
              <div className="border-t border-gray-200">
                {/* Section Audio Player */}
                <div className="p-4 bg-gray-50 border-b border-gray-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">
                      Section Audio
                    </span>
                    {generatingAudioSections.has(sectionIndex) && (
                      <div className="flex items-center text-xs text-blue-600">
                        <svg
                          className="animate-spin h-3 w-3 mr-1"
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
                  <AudioPlayer
                    audioUrl={sectionAudioUrls[sectionIndex] || null}
                    isGenerating={generatingAudioSections.has(sectionIndex)}
                    onGenerate={() => onGenerateAudioForSection(sectionIndex)}
                    onRegenerate={() => onGenerateAudioForSection(sectionIndex)}
                  />
                </div>

                {/* Speech Content */}
                {section.content.speech.map((speech, speechIndex) => (
                  <div
                    key={speechIndex}
                    className={`p-4 ${
                      speechIndex > 0 ? "border-t border-gray-100" : ""
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <span className="text-xs font-mono text-blue-600 bg-blue-50 px-2 py-1 rounded flex-shrink-0">
                        {speechIndex + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                          {speech.text}
                        </p>
                        <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                          <span>Reader: {speech.reader_id}</span>
                          <span>{speech.text.length} chars</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

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
                  ? PROCESSING_ARRAY[processingMetadata.level].name
                  : "Unknown Level"}
              </dd>
            </div>
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

      {/* AI Processed Text */}
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
            spellCheck={false}
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
                  spellCheck={false}
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
                className={`border rounded-lg ${
                  useOriginalText
                    ? "bg-orange-50 border-orange-200"
                    : "bg-green-50 border-green-200"
                }`}
              >
                {/* Check if content is structured and render accordingly */}
                {cleanedText && isStructuredContent(cleanedText) ? (
                  <div className="p-4">
                    {renderStructuredContent(cleanedText)}
                  </div>
                ) : (
                  <div className="p-4 max-h-96 overflow-y-auto">
                    <p
                      className={`text-sm whitespace-pre-wrap ${
                        useOriginalText ? "text-orange-800" : "text-green-800"
                      }`}
                    >
                      {currentDisplayText}
                    </p>
                  </div>
                )}
              </div>
            )}
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
