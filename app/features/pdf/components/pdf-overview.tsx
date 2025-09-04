import { LANGUAGE_MAP } from "@/app/api/classify-document/constants";
import { ParsedPDF } from "../types";
import Image from "next/image";

// Helper function to get language name from code
const getLanguageName = (code: string): string => {
  return LANGUAGE_MAP.get(code.toLowerCase()) || code.toUpperCase();
};

// Add types for document classification and file info
type DocumentClassification = {
  documentType: string;
  language: string;
};

type FileInfo = {
  name: string;
  size: number;
  thumbnailUrl: string | null;
};

interface PDFDocumentOverviewProps {
  parsedPDF: ParsedPDF;
  fileInfo: FileInfo | null;
  classification: DocumentClassification | null;
  isClassifying: boolean;
  onReset: () => void;
}

export default function PDFDocumentOverview({
  parsedPDF,
  fileInfo,
  classification,
  isClassifying,
  onReset,
}: PDFDocumentOverviewProps) {
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Get emoji for document type
  const getDocumentTypeEmoji = (type: string) => {
    const emojiMap: { [key: string]: string } = {
      academic_paper: "📚",
      business_report: "📊",
      legal_document: "⚖️",
      technical_manual: "🔧",
      book_chapter: "📖",
      news_article: "📰",
      general: "📄",
    };
    return emojiMap[type.toLowerCase()] || emojiMap.general;
  };

  return (
    <div className="p-6 border-b border-gray-100">
      {/* Modern Card with Subtle Shadow and Rounded Corners */}
      <div className="bg-gradient-to-br from-white to-gray-50/50 border border-gray-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all duration-300">
        {/* Header removed - no title needed */}

        <div className="flex items-start gap-6">
          {/* Enhanced Thumbnail with Playful Hover Effect */}
          <div className="flex-shrink-0 group">
            <div className="relative">
              {fileInfo?.thumbnailUrl ? (
                <Image
                  src={fileInfo.thumbnailUrl}
                  alt="PDF thumbnail"
                  className="w-40 h-60 object-cover rounded-xl border-1 border-gray-200 "
                />
              ) : (
                <div className="w-32 h-40 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl border-2 border-gray-200 flex items-center justify-center group-hover:from-blue-50 group-hover:to-purple-50 transition-all duration-300">
                  <svg
                    className="w-12 h-12 text-gray-400 group-hover:text-blue-500 transition-colors duration-300"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
              )}
            </div>
          </div>

          {/* File Details with Modern Typography and Spacing */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* File Name with Truncation */}
            <div className="flex items-center justify-between">
              <h4
                className="text-lg font-semibold text-gray-900 truncate max-w-md"
                title={fileInfo?.name}
              >
                {fileInfo?.name}
              </h4>

              {/* Modern Replace Button */}
              <button
                onClick={onReset}
                className="group inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 bg-white/80 backdrop-blur-sm border border-gray-200 rounded-xl hover:bg-gray-50 hover:text-gray-700 hover:border-gray-300 transition-all duration-200 hover:scale-105 active:scale-95"
              >
                <svg
                  className="w-4 h-4 transition-transform duration-200 group-hover:rotate-12"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Replace
              </button>
            </div>

            {/* File Stats in Pills */}
            <div className="flex items-center gap-3 flex-wrap">
              {classification && classification.documentType !== "general" && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-700 rounded-full text-sm font-medium">
                  <span className="text-base leading-none">
                    {getDocumentTypeEmoji(classification.documentType)}
                  </span>
                  {classification.documentType
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (l) => l.toUpperCase())}{" "}
                </span>
              )}

              {parsedPDF.pages && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-sm font-medium">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  {parsedPDF.pages.length} page
                  {parsedPDF.pages.length !== 1 ? "s" : ""}
                </span>
              )}

              {/* Document Type - Only show if not general */}

              {/* Language */}
              {classification?.language && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-full text-sm font-medium">
                  <span className="text-base leading-none">🌐</span>
                  {getLanguageName(classification.language)}
                </span>
              )}
              {/* <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-sm font-medium">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
                {fileInfo ? formatFileSize(fileInfo.size) : ""}
              </span> */}

              {/* Loading states */}
              {isClassifying && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 text-orange-700 rounded-full text-sm font-medium">
                  <div className="animate-spin rounded-full h-3 w-3 border-2 border-orange-300 border-t-orange-600"></div>
                  Analyzing...
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
