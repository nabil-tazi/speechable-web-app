"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import type { TextHighlight, HighlightType } from "@/app/features/pdf/types";
import { REMOVABLE_HIGHLIGHT_TYPES } from "@/app/features/pdf/types";
import type { CuratedSection, SectionTree } from "@/app/features/pdf/utils/section-detection";
import type { OutlineSectionWithContent } from "@/app/features/pdf/types";

/**
 * Render text with colored highlights using range-based highlighting
 * Takes clean text and an array of highlight ranges
 * hiddenTypes: array of highlight types to completely remove from display
 * When hiding, adjacent text segments are reconciled (joined) to fix broken paragraphs
 */
function HighlightedText({
  text,
  highlights,
  hiddenTypes = []
}: {
  text: string;
  highlights?: TextHighlight[];
  hiddenTypes?: HighlightType[];
}) {
  if (!text) return <span>(No text extracted)</span>;

  // If no highlights, return plain text
  if (!highlights || highlights.length === 0) {
    return <span>{text}</span>;
  }

  // Sort all highlights by start position, then by length (longer first to prioritize section highlights)
  const sortedHighlights = [...highlights].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return (b.end - b.start) - (a.end - a.start); // Longer highlights first
  });

  // Build segments from highlights
  // Hidden types will be marked for removal
  // Handle overlapping highlights by skipping already-covered regions
  const segments: Array<{ type: HighlightType | "text" | "hidden"; content: string }> = [];
  let lastEnd = 0;

  for (const highlight of sortedHighlights) {
    // Skip highlights that are completely inside already-processed region
    if (highlight.end <= lastEnd) {
      continue;
    }

    // Calculate effective start (skip any overlap with already-processed region)
    const effectiveStart = Math.max(highlight.start, lastEnd);

    // Add plain text before this highlight (if any)
    if (effectiveStart > lastEnd) {
      segments.push({ type: "text", content: text.slice(lastEnd, effectiveStart) });
    }

    // Add highlighted segment (or mark as hidden if type is in hiddenTypes)
    if (hiddenTypes.includes(highlight.type)) {
      segments.push({ type: "hidden", content: "" }); // Empty content for hidden types
    } else {
      // For section_start, use the formatted sectionTitle if available
      const content = highlight.type === 'section_start' && highlight.sectionTitle
        ? highlight.sectionTitle
        : text.slice(effectiveStart, highlight.end);
      segments.push({ type: highlight.type, content });
    }
    lastEnd = highlight.end;
  }

  // Add remaining text after last highlight
  if (lastEnd < text.length) {
    segments.push({ type: "text", content: text.slice(lastEnd) });
  }

  const styleMap: Record<HighlightType | "text" | "hidden", string> = {
    text: "",
    anomaly: "bg-red-100 text-red-900 px-1 rounded", // Red for position anomalies
    legend: "bg-amber-100 text-amber-900 px-1 rounded", // Amber for legends/captions
    footnote: "bg-blue-100 text-blue-900 px-1 rounded", // Blue for footnotes
    figure_label: "bg-purple-100 text-purple-900 px-1 rounded", // Purple for figure labels
    reference: "bg-cyan-100 text-cyan-900 px-1 rounded", // Cyan for references/citations
    header: "bg-slate-200 text-slate-700 px-1 rounded", // Slate for repeating headers
    footer: "bg-slate-200 text-slate-700 px-1 rounded", // Slate for repeating footers
    page_number: "bg-slate-300 text-slate-600 px-1 rounded", // Darker slate for page numbers
    author: "bg-green-100 text-green-900 px-1 rounded", // Green for author names
    heading: "block font-bold text-indigo-800 bg-indigo-50 px-2 py-1 my-2 rounded border-l-4 border-indigo-500", // Sequential headings
    section_start: "block font-bold text-blue-800 bg-blue-50 px-2 py-1 my-2 rounded border-l-4 border-blue-500", // Section markers (never hidden)
    url: "bg-rose-100 text-rose-900 px-1 rounded", // Rose for URLs
    email: "bg-pink-100 text-pink-900 px-1 rounded", // Pink for email addresses
    toc: "bg-teal-100 text-teal-900 px-1 rounded", // Teal for table of contents
    bibliography: "bg-orange-100 text-orange-900 px-1 rounded", // Orange for bibliography/references section
    hidden: "hidden", // Hidden segments are not rendered
  };

  // Filter out hidden segments and reconcile adjacent text segments
  // When highlights are hidden, we need to intelligently join the surrounding text
  const visibleSegments: Array<{ type: HighlightType | "text"; content: string }> = [];

  for (const segment of segments) {
    if (segment.type === "hidden") {
      continue; // Skip hidden segments
    }

    const lastVisible = visibleSegments[visibleSegments.length - 1];

    // If both current and previous are plain text, merge them
    if (lastVisible && lastVisible.type === "text" && segment.type === "text") {
      const prevText = lastVisible.content.trimEnd();
      const currText = segment.content.trimStart();

      // When joining text after hiding content, be aggressive about joining:
      // Only keep paragraph breaks if prev ACTUALLY ends a sentence
      // (The \n\n might have been there because of the now-hidden content)
      const endsWithSentence = /[.!?]\s*$/.test(prevText);
      const currStartsWithCapital = /^[A-Z]/.test(currText);

      if (endsWithSentence && currStartsWithCapital) {
        // Natural paragraph break: sentence end + new sentence starting with capital
        lastVisible.content = prevText + "\n\n" + currText;
      } else {
        // Join with space - either mid-sentence or continuation
        lastVisible.content = prevText + " " + currText;
      }
    } else {
      visibleSegments.push({ ...segment } as typeof visibleSegments[0]);
    }
  }

  return (
    <>
      {visibleSegments.map((segment, i) => (
        <span key={i} className={styleMap[segment.type]}>
          {segment.content}
        </span>
      ))}
    </>
  );
}

/**
 * Clean text by removing common highlighted patterns
 * (footnote markers, superscript references, inline citations)
 * This is applied as a backup to catch anything missed by highlight-based removal
 */
function cleanHighlightedPatterns(text: string): string {
  return text
    // Remove superscript-style numbers (e.g., "word¹²³")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, '')
    // Remove bracketed references (e.g., "[1]", "[1,2]", "[1-3]")
    .replace(/\s*\[\d+(?:[,\-–]\d+)*\]\s*/g, ' ')
    // Remove parenthetical citations (e.g., "(Smith, 2020)", "(Smith et al., 2020)")
    .replace(/\s*\([A-Z][a-z]+(?:\s+(?:et\s+al\.?|and\s+[A-Z][a-z]+))?,?\s*\d{4}[a-z]?\)\s*/g, ' ')
    // Remove standalone footnote-style numbers attached to words (e.g., "text1" or "word 2")
    .replace(/(\w)\s*(\d{1,2})(?=\s|$|[.,;:!?)])/g, '$1')
    // Remove asterisks that might be footnote markers
    .replace(/\s*\*+/g, '')
    // Remove figure/table labels (e.g., "Fig. 1", "Table 2", "Figure 3")
    .replace(/\b(?:Fig\.?|Figure|Table|Tableau)\s*\d+[a-z]?\b\.?/gi, '')
    // Remove page references (e.g., "p. 12", "pp. 12-15", "page 5")
    .replace(/\b(?:p\.?|pp\.?|page|pages)\s*\d+(?:\s*[-–]\s*\d+)?\b/gi, '')
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Merge unverified section content into preceding verified sections
 * When hiding unverified sections:
 * - Only verified section titles are shown as headers
 * - Unverified section title+content becomes part of preceding verified section's content
 * - All content (both verified and unverified) is cleaned using pattern-based removal
 *   as a backup to catch anything missed by highlight-based removal
 */
function mergeSectionsForDisplay(sections: CuratedSection[]): CuratedSection[] {
  const result: CuratedSection[] = [];
  let pendingContent: string[] = [];

  for (const section of sections) {
    if (section.verified) {
      // If we have pending content from unverified sections, append to previous verified
      if (pendingContent.length > 0 && result.length > 0) {
        const lastVerified = result[result.length - 1];
        lastVerified.content = cleanHighlightedPatterns(
          lastVerified.content + '\n\n' + pendingContent.join('\n\n')
        );
        pendingContent = [];
      }
      // Add this verified section with cleaned content
      result.push({
        ...section,
        content: cleanHighlightedPatterns(section.content)
      });
    } else {
      // Unverified: title becomes content (cleaned), then append section content (cleaned)
      const cleanedTitle = cleanHighlightedPatterns(section.title);
      const cleanedContent = cleanHighlightedPatterns(section.content);
      const mergedText = cleanedTitle + (cleanedContent ? '\n\n' + cleanedContent : '');
      if (mergedText.trim()) {
        pendingContent.push(mergedText.trim());
      }
    }
  }

  // Handle any remaining pending content (unverified sections at the end)
  if (pendingContent.length > 0 && result.length > 0) {
    const lastVerified = result[result.length - 1];
    lastVerified.content = cleanHighlightedPatterns(
      lastVerified.content + '\n\n' + pendingContent.join('\n\n')
    );
  }

  return result;
}

// Comparison result type
export interface ExtractionComparison {
  pdfjs: {
    text: string;
    numPages: number;
    metadata: any;
    processingTime: number;
    averageFontSize?: number;
    removedArtifacts?: any[];
    detectedSections?: CuratedSection[];
    sectionTree?: SectionTree;
    highlights?: TextHighlight[];
    pdfOutline?: Array<{ title: string; page: number; level: number }>;
    outlineSections?: OutlineSectionWithContent[];
    error?: string;
  };
  mupdf: {
    text: string;
    numPages: number;
    metadata: any;
    processingTime: number;
    averageFontSize?: number;
    removedArtifacts?: any[];
    detectedSections?: CuratedSection[];
    sectionTree?: SectionTree;
    highlights?: TextHighlight[];
    pdfOutline?: Array<{ title: string; page: number; level: number }>;
    outlineSections?: OutlineSectionWithContent[];
    error?: string;
  };
  file: File;
}

interface PDFComparisonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comparisonResult: ExtractionComparison;
  onCreateDocument: (extractor: "pdfjs" | "mupdf") => Promise<void>;
  isCreating: boolean;
}

export function PDFComparisonModal({
  open,
  onOpenChange,
  comparisonResult,
  onCreateDocument,
  isCreating,
}: PDFComparisonModalProps) {
  const [selectedExtractor, setSelectedExtractor] = useState<"pdfjs" | "mupdf">(() => {
    // Auto-select working extractor if one failed
    if (comparisonResult.mupdf.error && !comparisonResult.pdfjs.error) {
      return "pdfjs";
    }
    return "mupdf";
  });
  const [hideTaggedSections, setHideTaggedSections] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [hideUnverified, setHideUnverified] = useState(false);

  const pdfjs = comparisonResult.pdfjs;
  const mupdf = comparisonResult.mupdf;

  const handleCreateDocument = async () => {
    await onCreateDocument(selectedExtractor);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-none sm:max-w-none h-[90vh] overflow-hidden bg-white flex flex-col p-0">
        <DialogTitle className="sr-only">PDF Extraction Comparison</DialogTitle>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div>
              <h1 className="text-xl font-semibold">Extraction Comparison</h1>
              <p className="text-gray-500 text-sm">{comparisonResult.file.name}</p>
            </div>
          </div>
          <Button onClick={handleCreateDocument} disabled={isCreating}>
            {isCreating ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Check className="w-4 h-4 mr-2" />
            )}
            Use {selectedExtractor === "pdfjs" ? "PDF.js" : "MuPDF"} Result
          </Button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Stats Summary */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {/* PDF.js Stats */}
            <div
              className={`p-4 rounded-lg border-2 transition-all ${
                pdfjs.error
                  ? "border-red-200 bg-red-50 cursor-not-allowed opacity-60"
                  : selectedExtractor === "pdfjs"
                    ? "border-blue-500 bg-blue-50 cursor-pointer"
                    : "border-gray-200 hover:border-gray-300 cursor-pointer"
              }`}
              onClick={() => !pdfjs.error && setSelectedExtractor("pdfjs")}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-lg">PDF.js (Enhanced)</h3>
                {pdfjs.error ? (
                  <span className="text-xs bg-red-500 text-white px-2 py-1 rounded">Error</span>
                ) : selectedExtractor === "pdfjs" ? (
                  <span className="text-xs bg-blue-500 text-white px-2 py-1 rounded">Selected</span>
                ) : null}
              </div>
              {pdfjs.error ? (
                <div className="text-sm text-red-600">
                  <p className="font-medium">Processing failed</p>
                  <p className="text-xs text-red-500 mt-1">{pdfjs.error}</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Characters</span>
                      <p className="font-medium">{pdfjs.text.length.toLocaleString()}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Pages</span>
                      <p className="font-medium">{pdfjs.numPages}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Time</span>
                      <p className="font-medium">{Math.round(pdfjs.processingTime)}ms</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Artifacts</span>
                      <p className="font-medium">{pdfjs.removedArtifacts?.length || 0}</p>
                    </div>
                  </div>
                  {pdfjs.averageFontSize && (
                    <p className="text-xs text-gray-500 mt-2">
                      Avg font size: {pdfjs.averageFontSize.toFixed(1)}pt
                    </p>
                  )}
                </>
              )}
            </div>

            {/* MuPDF Stats */}
            <div
              className={`p-4 rounded-lg border-2 transition-all ${
                mupdf.error
                  ? "border-red-200 bg-red-50 cursor-not-allowed opacity-60"
                  : selectedExtractor === "mupdf"
                    ? "border-green-500 bg-green-50 cursor-pointer"
                    : "border-gray-200 hover:border-gray-300 cursor-pointer"
              }`}
              onClick={() => !mupdf.error && setSelectedExtractor("mupdf")}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-lg">MuPDF.js</h3>
                {mupdf.error ? (
                  <span className="text-xs bg-red-500 text-white px-2 py-1 rounded">Unsupported</span>
                ) : selectedExtractor === "mupdf" ? (
                  <span className="text-xs bg-green-500 text-white px-2 py-1 rounded">Selected</span>
                ) : null}
              </div>
              {mupdf.error ? (
                <div className="text-sm text-red-600">
                  <p className="font-medium">Font encoding not supported</p>
                  <p className="text-xs text-red-500 mt-1">This PDF uses custom font encodings that MuPDF cannot decode. PDF.js has been auto-selected.</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-5 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Characters</span>
                      <p className="font-medium">{mupdf.text.length.toLocaleString()}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Pages</span>
                      <p className="font-medium">{mupdf.numPages}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Time</span>
                      <p className="font-medium">{Math.round(mupdf.processingTime)}ms</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Artifacts</span>
                      <p className="font-medium">{mupdf.removedArtifacts?.length || 0}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Sections</span>
                      <p className="font-medium">{mupdf.detectedSections?.length || 0}</p>
                    </div>
                  </div>
                  {mupdf.averageFontSize && (
                    <p className="text-xs text-gray-500 mt-2">
                      Avg font size: {mupdf.averageFontSize.toFixed(1)}pt
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Removed Artifacts Info */}
          {mupdf.removedArtifacts && mupdf.removedArtifacts.length > 0 && (
            <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <h4 className="font-medium text-amber-800 mb-2">
                Artifacts Removed by MuPDF ({mupdf.removedArtifacts.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {mupdf.removedArtifacts.slice(0, 10).map((artifact: any, i: number) => (
                  <span
                    key={i}
                    className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded"
                  >
                    {artifact.type}: "{artifact.text.slice(0, 20)}{artifact.text.length > 20 ? '...' : ''}" (p.{artifact.pageNumber})
                  </span>
                ))}
                {mupdf.removedArtifacts.length > 10 && (
                  <span className="text-xs text-amber-600">
                    +{mupdf.removedArtifacts.length - 10} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Section Comparison: PDF Outline vs Detected */}
          {(mupdf.pdfOutline || mupdf.detectedSections) && (
            <div className="mb-6">
              <h4 className="font-medium text-gray-800 mb-3">
                Section Comparison
              </h4>
              <div className="grid grid-cols-2 gap-4">
                {/* PDF Outline (embedded TOC) - just entries, no content */}
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <h5 className="font-medium text-green-800 mb-3 flex items-center gap-2">
                    <span>PDF Outline</span>
                    <span className="text-xs font-normal bg-green-100 px-2 py-0.5 rounded">
                      {mupdf.pdfOutline?.length || 0} items
                    </span>
                    <span className="text-xs font-normal text-green-600">
                      (embedded TOC)
                    </span>
                  </h5>
                  <div className="space-y-1 max-h-[600px] overflow-y-auto">
                    {mupdf.pdfOutline && mupdf.pdfOutline.length > 0 ? (
                      mupdf.pdfOutline.map((item, i) => (
                        <div
                          key={i}
                          className="text-sm flex items-center gap-2"
                          style={{ paddingLeft: `${(item.level - 1) * 16}px` }}
                        >
                          <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-xs font-medium ${
                            item.level === 1
                              ? "bg-green-600 text-white"
                              : item.level === 2
                              ? "bg-green-400 text-white"
                              : "bg-green-200 text-green-800"
                          }`}>
                            {item.level}
                          </span>
                          <span className="flex-1 truncate text-gray-800">
                            {item.title}
                          </span>
                          <span className="text-xs text-gray-500">
                            p.{item.page}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-500 italic">
                        No embedded outline in this PDF
                      </p>
                    )}
                  </div>
                </div>

                {/* Detected Sections (font-based, curated with outline) with expandable content */}
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="font-medium text-blue-800 flex items-center gap-2">
                      <span>Curated Sections</span>
                      {mupdf.detectedSections && mupdf.detectedSections.length > 0 && (
                        <>
                          <span className="text-xs font-normal bg-green-100 text-green-700 px-2 py-0.5 rounded">
                            {mupdf.detectedSections.filter(s => s.verified).length} verified
                          </span>
                          <span className="text-xs font-normal bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                            {mupdf.detectedSections.filter(s => !s.verified).length} unverified
                          </span>
                        </>
                      )}
                    </h5>
                    {mupdf.detectedSections && mupdf.detectedSections.some(s => !s.verified) && (
                      <button
                        onClick={() => setHideUnverified(!hideUnverified)}
                        className={`px-2 py-1 text-xs rounded border transition-colors ${
                          hideUnverified
                            ? 'bg-blue-200 border-blue-300 text-blue-700'
                            : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}
                        title={hideUnverified ? 'Show all sections' : 'Hide unverified sections'}
                      >
                        {hideUnverified ? 'Show All' : 'Hide Unverified'}
                      </button>
                    )}
                  </div>
                  <div className="space-y-1 max-h-[600px] overflow-y-auto">
                    {mupdf.detectedSections && mupdf.detectedSections.length > 0 ? (
                      (hideUnverified
                        ? mergeSectionsForDisplay(mupdf.detectedSections)
                        : mupdf.detectedSections
                      ).map((section, i) => {
                          const hasContent = section.content && section.content.length > 0;
                          return (
                            <div
                              key={i}
                              className="text-sm"
                              style={{ paddingLeft: `${(section.level - 1) * 16}px` }}
                            >
                              <div className="flex items-center gap-2">
                                {/* Expand/collapse button */}
                                {hasContent ? (
                                  <button
                                    onClick={() => {
                                      const newExpanded = new Set(expandedSections);
                                      if (newExpanded.has(i)) {
                                        newExpanded.delete(i);
                                      } else {
                                        newExpanded.add(i);
                                      }
                                      setExpandedSections(newExpanded);
                                    }}
                                    className="w-5 h-5 flex items-center justify-center text-blue-600 hover:bg-blue-100 rounded"
                                  >
                                    {expandedSections.has(i) ? '▼' : '▶'}
                                  </button>
                                ) : (
                                  <span className="w-5 h-5"></span>
                                )}
                                {/* Verification badge */}
                                <span
                                  className={`inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold ${
                                    section.verified
                                      ? "bg-green-500 text-white"
                                      : "bg-gray-300 text-gray-600"
                                  }`}
                                  title={section.verified ? 'Verified (matched to PDF outline)' : 'Unverified (font-based only)'}
                                >
                                  {section.verified ? '✓' : '?'}
                                </span>
                                {/* Level indicator */}
                                <span
                                  className={`inline-flex items-center justify-center w-5 h-5 rounded text-xs font-medium ${
                                    section.level === 1
                                      ? "bg-blue-600 text-white"
                                      : section.level === 2
                                      ? "bg-blue-400 text-white"
                                      : "bg-blue-200 text-blue-800"
                                  }`}
                                >
                                  {section.level}
                                </span>
                                <span className="flex-1 truncate font-medium text-gray-800">
                                  {section.title}
                                  {section.originalTitle && section.originalTitle !== section.title && (
                                    <span className="text-xs text-gray-400 ml-1" title={`Originally: ${section.originalTitle}`}>
                                      *
                                    </span>
                                  )}
                                </span>
                                <span className="text-xs text-gray-500 whitespace-nowrap">
                                  p.{section.pageNumber} • {section.fontSize.toFixed(1)}pt
                                  {section.fontWeight === "bold" && " • bold"}
                                </span>
                                {hasContent && (
                                  <span className="text-xs text-blue-500">
                                    {section.content.length.toLocaleString()} chars
                                  </span>
                                )}
                                {!section.verified && (
                                  <span
                                    className={`text-xs px-1.5 py-0.5 rounded ${
                                      section.confidence >= 0.7
                                        ? "bg-green-100 text-green-700"
                                        : section.confidence >= 0.5
                                        ? "bg-yellow-100 text-yellow-700"
                                        : "bg-gray-100 text-gray-600"
                                    }`}
                                  >
                                    {Math.round(section.confidence * 100)}%
                                  </span>
                                )}
                              </div>
                              {/* Expandable full content */}
                              {hasContent && expandedSections.has(i) && (
                                <div className="mt-2 ml-10 p-3 bg-white border border-blue-100 rounded text-sm text-gray-700 max-h-80 overflow-y-auto">
                                  <div className="whitespace-pre-wrap font-sans leading-relaxed">
                                    {section.content}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })
                    ) : (
                      <p className="text-sm text-gray-500 italic">
                        No sections detected
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Highlight Legend (shared between both outputs) */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between">
              <div className={`flex items-center gap-1.5 text-xs flex-wrap ${hideTaggedSections ? 'opacity-40' : ''}`}>
                <span className="text-gray-600 font-medium mr-2">Highlight Legend:</span>
                <span className="w-3 h-3 rounded bg-red-100 border border-red-200"></span>
                <span className="text-gray-500">Anomaly</span>
                <span className="w-3 h-3 rounded bg-amber-100 border border-amber-200 ml-2"></span>
                <span className="text-gray-500">Legend</span>
                <span className="w-3 h-3 rounded bg-blue-100 border border-blue-200 ml-2"></span>
                <span className="text-gray-500">Footnote</span>
                <span className="w-3 h-3 rounded bg-purple-100 border border-purple-200 ml-2"></span>
                <span className="text-gray-500">Fig Label</span>
                <span className="w-3 h-3 rounded bg-cyan-100 border border-cyan-200 ml-2"></span>
                <span className="text-gray-500">Reference</span>
                <span className="w-3 h-3 rounded bg-slate-200 border border-slate-300 ml-2"></span>
                <span className="text-gray-500">Header/Footer</span>
                <span className="w-3 h-3 rounded bg-slate-300 border border-slate-400 ml-2"></span>
                <span className="text-gray-500">Page #</span>
                <span className="w-3 h-3 rounded bg-green-100 border border-green-200 ml-2"></span>
                <span className="text-gray-500">Author/Refs</span>
                <span className="w-3 h-3 rounded bg-teal-100 border border-teal-200 ml-2"></span>
                <span className="text-gray-500">TOC</span>
                <span className="w-3 h-3 rounded bg-orange-100 border border-orange-200 ml-2"></span>
                <span className="text-gray-500">Bibliography</span>
              </div>
              <button
                onClick={() => setHideTaggedSections(!hideTaggedSections)}
                className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                  hideTaggedSections
                    ? 'bg-gray-200 border-gray-300 text-gray-700'
                    : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
                title={hideTaggedSections ? 'Show tagged sections' : 'Hide tagged sections'}
              >
                {hideTaggedSections ? 'Show All' : 'Hide Tagged'}
              </button>
            </div>
          </div>

          {/* Side by Side Text Comparison */}
          <div className="grid grid-cols-2 gap-4">
            {/* PDF.js Text */}
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-100 px-4 py-2 border-b flex items-center justify-between">
                <h4 className="font-medium">PDF.js Output</h4>
                <span className="text-xs text-gray-500">
                  {pdfjs.text.length.toLocaleString()} chars
                  {pdfjs.highlights && pdfjs.highlights.length > 0 && (
                    <span className="ml-2 text-gray-400">
                      ({pdfjs.highlights.length} highlights)
                    </span>
                  )}
                </span>
              </div>
              <div className="p-4 h-[500px] overflow-y-auto">
                <pre className="text-sm whitespace-pre-wrap font-mono text-gray-700">
                  <HighlightedText text={pdfjs.text} highlights={pdfjs.highlights} hiddenTypes={hideTaggedSections ? [...REMOVABLE_HIGHLIGHT_TYPES] : []} />
                </pre>
              </div>
            </div>

            {/* MuPDF Text */}
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-100 px-4 py-2 border-b flex items-center justify-between">
                <h4 className="font-medium">MuPDF.js Output</h4>
                <span className="text-xs text-gray-500">
                  {mupdf.text.length.toLocaleString()} chars
                  {mupdf.highlights && mupdf.highlights.length > 0 && (
                    <span className="ml-2 text-gray-400">
                      ({mupdf.highlights.length} highlights)
                    </span>
                  )}
                </span>
              </div>
              <div className="p-4 h-[500px] overflow-y-auto">
                <pre className="text-sm whitespace-pre-wrap font-mono text-gray-700">
                  <HighlightedText text={mupdf.text} highlights={mupdf.highlights} hiddenTypes={hideTaggedSections ? [...REMOVABLE_HIGHLIGHT_TYPES] : []} />
                </pre>
              </div>
            </div>
          </div>

          {/* Character Difference */}
          <div className="mt-4 p-3 bg-gray-50 rounded-lg text-center text-sm text-gray-600">
            Character difference: {Math.abs(pdfjs.text.length - mupdf.text.length).toLocaleString()} chars
            ({pdfjs.text.length > mupdf.text.length ? "PDF.js has more" : pdfjs.text.length < mupdf.text.length ? "MuPDF has more" : "Equal"})
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
