"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";
import { createDocumentAction, createDocumentVersionAction, updateDocumentAction } from "@/app/features/documents/actions";
import { convertTTSSectionsToBlocks, convertBlocksToProcessedText, convertProcessedTextToBlocks } from "@/app/features/block-editor";
import { identifySections } from "@/app/features/pdf/helpers/identify-sections";
import { processText as processTextWithLLM } from "@/app/features/pdf/helpers/process-text";
import { processPDFFile } from "@/app/features/pdf/utils/pdf-processing";
import { processPDFWithMuPDFAction } from "@/app/features/pdf/actions/mupdf-actions";
import { processPDFWithPDFJSEnhanced } from "@/app/features/pdf/utils/pdfjs-processing";
import { extractSuperscriptsFromPDFJS, convertSuperscriptsToHighlights } from "@/app/features/pdf/utils/pdfjs-structured";
import type { ParsedPDF, ParsedPDFExtended, TextHighlight, HighlightType } from "@/app/features/pdf/types";
import { REMOVABLE_HIGHLIGHT_TYPES } from "@/app/features/pdf/types";
import { getTTSSections, removeHighlightedSections } from "@/app/features/pdf/helpers/remove-highlights";
import type { DetectedSection, DetectedSectionWithContent, SectionTree, CuratedSection } from "@/app/features/pdf/utils/section-detection";
import type { OutlineSectionWithContent } from "@/app/features/pdf/types";
import { processImagesWithOCR } from "@/app/features/ocr/utils/api-client";
import type { OCRProgress } from "@/app/features/ocr/types";
import { Button } from "@/components/ui/button";
import {
  Upload,
  FileText,
  Loader2,
  Link as LinkIcon,
  Type,
  Images,
  Globe,
  ArrowLeft,
  Check,
} from "lucide-react";
import { useAppSettings } from "@/app/features/app-settings/context";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TransitionPanel } from "@/components/ui/transition-panel";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

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

// Document creation options
const CREATION_OPTIONS = [
  {
    id: "pdf",
    name: "PDF",
    icon: FileText,
    description: "Upload a PDF document for text extraction and processing",
  },
  {
    id: "url",
    name: "Website",
    icon: Globe,
    description: "Extract content from a website URL",
  },
  {
    id: "text",
    name: "Text",
    icon: Type,
    description: "Paste or type text content directly",
  },
  {
    id: "images",
    name: "Images",
    icon: Images,
    description: "Upload images for OCR text extraction",
  },
];

type CreationMode = "pdf" | "url" | "text" | "images";

// Comparison result type
interface ExtractionComparison {
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

export default function NewDocumentPage() {
  const [selectedMode, setSelectedMode] = useState<CreationMode>("pdf");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const router = useRouter();
  const { debugMode } = useAppSettings();

  // Form states for different modes
  const [urlInput, setUrlInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [ocrProgress, setOcrProgress] = useState<OCRProgress | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // PDF extraction comparison state
  const [comparisonResult, setComparisonResult] = useState<ExtractionComparison | null>(null);
  const [selectedExtractor, setSelectedExtractor] = useState<"pdfjs" | "mupdf">("mupdf");

  // Toggle to hide all tagged sections (anomalies, legends, footnotes, figure labels)
  const [hideTaggedSections, setHideTaggedSections] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  // Toggle to hide unverified sections (those not matched to PDF outline)
  const [hideUnverified, setHideUnverified] = useState(false);

  // Use REMOVABLE_HIGHLIGHT_TYPES from types.ts - excludes section_start which should never be hidden

  // Get user on mount
  useEffect(() => {
    const getUser = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
      setIsLoadingUser(false);
    };
    getUser();
  }, []);

  // PDF Upload handlers
  const handlePDFSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Please select a PDF file");
      return;
    }

    await processPDFDocument(file);
  };

  const handlePDFDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const pdfFile = files.find((file) => file.type === "application/pdf");

    if (!pdfFile) {
      setError("Please upload a PDF file");
      return;
    }

    await processPDFDocument(pdfFile);
  };

  // Image upload handlers
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'];
    const imageFiles = files.filter((file) => allowedTypes.includes(file.type));
    const maxSize = 10 * 1024 * 1024; // 10MB
    const maxImages = 10; // Maximum number of images

    // Check file types
    if (imageFiles.length !== files.length) {
      setError("Please select only supported image files (JPEG, PNG, GIF, BMP, WebP)");
      return;
    }

    // Check file sizes
    const oversizedFiles = imageFiles.filter(file => file.size > maxSize);
    if (oversizedFiles.length > 0) {
      setError(`Image(s) too large: ${oversizedFiles.map(f => f.name).join(', ')}. Maximum size is 10MB per image.`);
      return;
    }

    // Check total number of images
    if (selectedImages.length + imageFiles.length > maxImages) {
      setError(`Too many images. Maximum is ${maxImages} images total.`);
      return;
    }

    setSelectedImages((prev) => [...prev, ...imageFiles]);
    setError(null);
  };

  const handleImageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'];
    const imageFiles = files.filter((file) => allowedTypes.includes(file.type));
    const maxSize = 10 * 1024 * 1024; // 10MB
    const maxImages = 10; // Maximum number of images

    // Check file types
    if (imageFiles.length !== files.length) {
      setError("Please drop only supported image files (JPEG, PNG, GIF, BMP, WebP)");
      return;
    }

    // Check file sizes
    const oversizedFiles = imageFiles.filter(file => file.size > maxSize);
    if (oversizedFiles.length > 0) {
      setError(`Image(s) too large: ${oversizedFiles.map(f => f.name).join(', ')}. Maximum size is 10MB per image.`);
      return;
    }

    // Check total number of images
    if (selectedImages.length + imageFiles.length > maxImages) {
      setError(`Too many images. Maximum is ${maxImages} images total.`);
      return;
    }

    setSelectedImages((prev) => [...prev, ...imageFiles]);
    setError(null);
  };

  const removeImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  };

  // Drag and drop sorting functions
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    
    const newImages = [...selectedImages];
    const draggedImage = newImages[draggedIndex];
    newImages.splice(draggedIndex, 1);
    newImages.splice(index, 0, draggedImage);
    
    setSelectedImages(newImages);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // Generate image preview URL
  const getImagePreviewUrl = (file: File): string => {
    return URL.createObjectURL(file);
  };

  // Convert file to base64 for server action
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Remove the data URL prefix (e.g., "data:application/pdf;base64,")
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  // Helper function to create document from extraction data
  const createDocumentFromExtraction = async (
    file: File,
    extractorData: {
      text: string;
      numPages: number;
      metadata: any;
      highlights?: TextHighlight[];
    },
    extractorName: "pdfjs" | "mupdf"
  ) => {
    const highlights = extractorData.highlights || [];

    // Step 1: Clean the text by removing all removable highlights
    const cleanedText = removeHighlightedSections(
      extractorData.text,
      highlights,
      [...REMOVABLE_HIGHLIGHT_TYPES]
    );

    const thumbnailDataUrl = await generatePDFThumbnail(file);

    // Step 2: Create document with CLEANED text
    const doc = await createDocumentFromData({
      title: extractorData.metadata?.Title || extractorData.metadata?.title || file.name.replace(".pdf", ""),
      author: extractorData.metadata?.Author || extractorData.metadata?.author || "",
      text: cleanedText,
      file_type: "pdf",
      mime_type: file.type,
      filename: file.name,
      page_count: extractorData.numPages,
      file_size: file.size,
      metadata: {
        extractedAt: new Date().toISOString(),
        processingMethod: `${extractorName}-verified-sections`,
        ...extractorData.metadata,
      },
      thumbnailDataUrl,
    });

    // Step 3: Get verified sections from highlights (no LLM)
    const ttsSections = getTTSSections(extractorData.text, highlights);

    // Step 4: Create blocks directly from TTSSections (simpler flow)
    const documentTitle = extractorData.metadata?.Title || extractorData.metadata?.title || file.name.replace(".pdf", "");

    // If no sections detected, create a default section with all content
    const sectionsToConvert = ttsSections.length > 0
      ? ttsSections
      : [{ title: documentTitle, level: 1, content: cleanedText }];

    // Generate blocks directly from TTSSections
    const blocks = convertTTSSectionsToBlocks(sectionsToConvert);

    // Generate processed_text from blocks (for backward compatibility with TTS)
    const processedTextJson = convertBlocksToProcessedText(blocks);

    const { error: versionError } = await createDocumentVersionAction({
      document_id: doc.id,
      version_name: "Original",
      processed_text: processedTextJson,
      blocks,
      processing_type: "1",
      processing_metadata: {
        sectionsCount: sectionsToConvert.length,
        blocksCount: blocks.length,
        highlightsRemoved: highlights?.length || 0,
        source: ttsSections.length > 0 ? "verified-sections" : "full-document",
        extractor: extractorName,
      },
    });

    if (versionError) {
      console.error("[createDocumentFromExtraction] Failed to create version:", versionError);
    } else {
      // Update document with processed_text for block regeneration
      const processedTextObject = JSON.parse(processedTextJson);
      const { error: updateError } = await updateDocumentAction(doc.id, {
        processed_text: processedTextObject,
      });

      if (updateError) {
        console.error("[createDocumentFromExtraction] Failed to update document processed_text:", updateError);
      }
    }

    return doc;
  };

  // Process PDF document - runs extractors based on debug mode
  const processPDFDocument = async (file: File) => {
    if (!user) {
      setError("You must be logged in to create documents");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Convert file to base64 for server action
      const base64Data = await fileToBase64(file);

      // In non-debug mode, only run MuPDF and create document directly
      if (!debugMode) {
        const mupdfResult = await processPDFWithMuPDFAction(base64Data, file.name);

        if (mupdfResult.error || !mupdfResult.data) {
          throw new Error(mupdfResult.error || "Failed to process PDF with MuPDF");
        }

        const doc = await createDocumentFromExtraction(
          file,
          {
            text: mupdfResult.data.text,
            numPages: mupdfResult.data.numPages,
            metadata: mupdfResult.data.metadata,
            highlights: mupdfResult.data.documentHighlights || [],
          },
          "mupdf"
        );

        router.push(`/library/${doc.id}`);
        return;
      }

      // Debug mode: Run both extractors in parallel for comparison
      const [pdfjsResult, mupdfResult, fontBasedSuperscripts] = await Promise.all([
        // PDF.js runs client-side with enhanced processing
        (async () => {
          const result = await processPDFWithPDFJSEnhanced(file);
          return {
            data: result.data,
            processingTime: result.processingTime,
            error: result.error,
          };
        })(),
        // MuPDF runs server-side
        (async () => {
          const result = await processPDFWithMuPDFAction(base64Data, file.name);
          return {
            data: result.data,
            processingTime: result.processingTime,
            error: result.error,
          };
        })(),
        // Extract font-based superscripts from PDF.js (to enhance MuPDF results)
        extractSuperscriptsFromPDFJS(file),
      ]);

      // Check for extraction failures
      const mupdfFailed = mupdfResult.error === "FONT_ENCODING_UNSUPPORTED" || !mupdfResult.data;
      const pdfjsFailed = !pdfjsResult.data;

      // If both failed, throw error
      if (mupdfFailed && pdfjsFailed) {
        throw new Error("Both extractors failed to process the PDF");
      }

      // MuPDF now has native span-level superscript detection in paragraph-joining.ts
      // No need to merge PDF.js superscripts - they can cause false positives
      const mupdfHighlights = mupdfResult.data?.documentHighlights || [];
      const pdfjsHighlights = pdfjsResult.data?.documentHighlights || [];

      // Store comparison result
      setComparisonResult({
        pdfjs: pdfjsFailed ? {
          text: "",
          numPages: 0,
          metadata: {},
          processingTime: pdfjsResult.processingTime,
          error: pdfjsResult.error || "PDF.js processing failed",
        } : {
          text: pdfjsResult.data!.text,
          numPages: pdfjsResult.data!.numPages,
          metadata: pdfjsResult.data!.metadata,
          processingTime: pdfjsResult.processingTime,
          averageFontSize: pdfjsResult.data!.averageFontSize,
          removedArtifacts: pdfjsResult.data!.removedArtifacts,
          detectedSections: pdfjsResult.data!.detectedSections,
          sectionTree: pdfjsResult.data!.sectionTree,
          highlights: pdfjsHighlights,
          pdfOutline: pdfjsResult.data!.pdfOutline,
          outlineSections: pdfjsResult.data!.outlineSections,
        },
        mupdf: mupdfFailed ? {
          text: "",
          numPages: 0,
          metadata: {},
          processingTime: mupdfResult.processingTime,
          error: mupdfResult.error || "MuPDF processing failed",
        } : (() => {
          // Target debug: check text received from server
          const text = mupdfResult.data!.text;
          if (text.includes('Outside')) {
            const idx = text.indexOf('Outside');
            console.log(`[CLIENT_RECEIVED] mupdf.text around "Outside": "${text.slice(Math.max(0, idx-10), idx+60).replace(/\n/g, '\\n')}"`);
          }
          return {
          text: mupdfResult.data!.text,
          numPages: mupdfResult.data!.numPages,
          metadata: mupdfResult.data!.metadata,
          processingTime: mupdfResult.processingTime,
          averageFontSize: mupdfResult.data!.averageFontSize,
          removedArtifacts: mupdfResult.data!.removedArtifacts,
          detectedSections: mupdfResult.data!.detectedSections,
          sectionTree: mupdfResult.data!.sectionTree,
          highlights: mupdfHighlights,
          pdfOutline: mupdfResult.data!.pdfOutline,
          outlineSections: mupdfResult.data!.outlineSections,
        };})(),
        file,
      });

      // Auto-select working extractor if one failed
      if (mupdfFailed && !pdfjsFailed) {
        setSelectedExtractor("pdfjs");
      } else if (pdfjsFailed && !mupdfFailed) {
        setSelectedExtractor("mupdf");
      }
    } catch (err) {
      console.error("Error processing PDF:", err);
      setError(err instanceof Error ? err.message : "Failed to process PDF");
    } finally {
      setIsProcessing(false);
    }
  };

  // Create document from selected extractor result (used in debug mode comparison view)
  const createDocumentFromComparison = async () => {
    if (!comparisonResult || !user) return;

    setIsProcessing(true);
    setError(null);

    try {
      // Use data from the selected extractor (pdfjs or mupdf)
      const extractorData = selectedExtractor === "pdfjs"
        ? comparisonResult.pdfjs
        : comparisonResult.mupdf;

      const doc = await createDocumentFromExtraction(
        comparisonResult.file,
        {
          text: extractorData.text,
          numPages: extractorData.numPages,
          metadata: extractorData.metadata,
          highlights: extractorData.highlights,
        },
        selectedExtractor
      );

      router.push(`/library/${doc.id}`);
    } catch (err) {
      console.error("Error creating document:", err);
      setError(err instanceof Error ? err.message : "Failed to create document");
    } finally {
      setIsProcessing(false);
    }
  };

  // Go back to upload from comparison view
  const resetComparison = () => {
    setComparisonResult(null);
    setSelectedExtractor("mupdf");
  };

  // Process URL
  const processURL = async () => {
    if (!user || !urlInput.trim()) {
      setError("Please enter a valid URL");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // TODO: Implement URL content extraction
      // This would involve calling an API endpoint that extracts content from URLs
      const response = await fetch("/api/extract-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput }),
      });

      if (!response.ok) {
        throw new Error("Failed to extract content from URL");
      }

      const data = await response.json();

      const doc = await createDocumentFromData({
        title: data.title || "Website Content",
        author: data.author || "",
        text: data.text,
        file_type: "url",
        mime_type: "text/html",
        filename: `${data.title || "website"}.html`,
        metadata: {
          extractedAt: new Date().toISOString(),
          processingMethod: "url-extraction",
          sourceUrl: urlInput,
          domain: new URL(urlInput).hostname,
        },
      });

      // Create document version with processed_text and blocks
      if (data.processed_text) {
        const processedTextJson = JSON.stringify(data.processed_text);
        const blocks = convertProcessedTextToBlocks(processedTextJson);

        const { error: versionError } = await createDocumentVersionAction({
          document_id: doc.id,
          version_name: "Original",
          processed_text: processedTextJson,
          blocks,
          processing_type: "1",
          processing_metadata: {
            sectionsCount: data.processed_text.processed_text?.sections?.length || 1,
            blocksCount: blocks.length,
            source: "url-extraction",
          },
        });

        if (versionError) {
          console.error("[processURL] Failed to create version:", versionError);
        } else {
          // Update document with processed_text for block regeneration
          const { error: updateError } = await updateDocumentAction(doc.id, {
            processed_text: data.processed_text,
            language: data.lang || undefined,
          });

          if (updateError) {
            console.error("[processURL] Failed to update document:", updateError);
          }
        }
      }

      router.push(`/library/${doc.id}`);
    } catch (err) {
      console.error("Error processing URL:", err);
      setError(err instanceof Error ? err.message : "Failed to process URL");
    } finally {
      setIsProcessing(false);
    }
  };

  // Process text input
  const processText = async () => {
    if (!user || !textInput.trim() || !titleInput.trim()) {
      setError("Please enter both title and text content");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const doc = await createDocumentFromData({
        title: titleInput.trim(),
        text: textInput.trim(),
        file_type: "text",
        mime_type: "text/plain",
        filename: `${titleInput.trim()}.txt`,
        metadata: {
          extractedAt: new Date().toISOString(),
          processingMethod: "direct-input",
          characterCount: textInput.length,
        },
      });

      router.push(`/library/${doc.id}`);
    } catch (err) {
      console.error("Error processing text:", err);
      setError(err instanceof Error ? err.message : "Failed to process text");
    } finally {
      setIsProcessing(false);
    }
  };

  // Generate thumbnail from first image
  const generateImageThumbnail = async (file: File): Promise<string | null> => {
    try {
      return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        img.onload = () => {
          // Set thumbnail dimensions (maintaining aspect ratio)
          const maxWidth = 400;
          const maxHeight = 600;
          let { width, height } = img;
          
          if (width > height) {
            if (width > maxWidth) {
              height = height * (maxWidth / width);
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = width * (maxHeight / height);
              height = maxHeight;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          
          // Draw scaled image
          ctx?.drawImage(img, 0, 0, width, height);
          
          // Convert to data URL
          const dataUrl = canvas.toDataURL('image/png', 0.8);
          resolve(dataUrl);
        };
        
        img.onerror = () => resolve(null);
        img.src = URL.createObjectURL(file);
      });
    } catch (error) {
      console.warn('Failed to generate thumbnail:', error);
      return null;
    }
  };

  // Process images with OCR
  const processImages = async () => {
    if (!user || selectedImages.length === 0 || !titleInput.trim()) {
      setError("Please enter a title and select at least one image");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setOcrProgress(null);

    try {
      // Process images with PaddleOCR
      const result = await processImagesWithOCR(selectedImages, (progress) => {
        setOcrProgress(progress);
      });

      // Check if we got meaningful text
      if (!result.combinedText.trim()) {
        throw new Error("No text could be extracted from the images. Please ensure the images contain clear, readable text.");
      }

      // Generate thumbnail from first image
      const thumbnailDataUrl = await generateImageThumbnail(selectedImages[0]);

      const doc = await createDocumentFromData({
        title: titleInput.trim(),
        text: result.combinedText,
        file_type: "images",
        mime_type: "image/mixed",
        filename: `${titleInput.trim()}.txt`,
        metadata: {
          extractedAt: new Date().toISOString(),
          processingMethod: "ocr-paddleocr",
          imageCount: selectedImages.length,
          imageNames: selectedImages.map((img) => img.name),
          averageConfidence: result.totalConfidence,
          characterCount: result.combinedText.length,
        },
        thumbnailDataUrl,
      });

      router.push(`/library/${doc.id}`);
    } catch (err) {
      console.error("Error processing images:", err);
      setError(err instanceof Error ? err.message : "Failed to process images");
    } finally {
      setIsProcessing(false);
      setOcrProgress(null);
    }
  };

  // Common document creation function
  const createDocumentFromData = async (data: {
    title: string;
    author?: string;
    text: string;
    file_type: string;
    mime_type: string;
    filename: string;
    page_count?: number;
    file_size?: number;
    metadata: any;
    thumbnailDataUrl?: string | null;
  }) => {
    const { data: doc, error: docError } = await createDocumentAction({
      mime_type: data.mime_type,
      file_type: data.file_type,
      author: data.author || "",
      title: data.title,
      filename: data.filename,
      document_type: "",
      raw_text: data.text,
      page_count: data.page_count || 1,
      file_size: data.file_size || data.text.length,
      metadata: data.metadata,
    });

    if (docError || !doc) {
      throw new Error(docError || "Failed to create document");
    }

    // Upload thumbnail if provided
    if (data.thumbnailDataUrl) {
      try {
        const { uploadDocumentThumbnailAction } = await import(
          "@/app/features/documents/actions"
        );
        await uploadDocumentThumbnailAction(doc.id, data.thumbnailDataUrl);
      } catch (thumbError) {
        console.warn("Thumbnail upload failed:", thumbError);
      }
    }

    // Classify document if we have text
    if (data.text.trim().length > 0) {
      try {
        const classification = await classifyDocument(data.text.trim());
        if (classification) {
          const { updateDocumentAction } = await import(
            "@/app/features/documents/actions"
          );
          await updateDocumentAction(doc.id, {
            language: classification.language,
            document_type: classification.documentType,
          });
        }
      } catch (classifyError) {
        console.warn("Document classification failed:", classifyError);
      }
    }

    return doc;
  };

  // Generate PDF thumbnail
  const generatePDFThumbnail = async (file: File): Promise<string | null> => {
    try {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      const scale = 0.5;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return null;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({
        canvasContext: context,
        viewport: viewport,
        canvas: canvas,
      }).promise;

      return canvas.toDataURL("image/png");
    } catch (error) {
      console.error("Error generating PDF thumbnail:", error);
      return null;
    }
  };

  // Classify document
  const classifyDocument = async (
    text: string
  ): Promise<{ documentType: string; language: string } | null> => {
    try {
      const response = await fetch("/api/classify-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Classification failed: ${response.status}`
        );
      }

      const data = await response.json();
      return {
        documentType: data.documentType,
        language: data.language,
      };
    } catch (err) {
      console.error("Error classifying document:", err);
      return null;
    }
  };

  // Handle create action based on selected mode
  const handleCreate = async () => {
    switch (selectedMode) {
      case "url":
        await processURL();
        break;
      case "text":
        await processText();
        break;
      case "images":
        await processImages();
        break;
      default:
        // PDF mode is handled by file input
        break;
    }
  };

  // Clear error when mode changes
  useEffect(() => {
    setError(null);
  }, [selectedMode]);

  if (isLoadingUser) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-gray-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-4">
            You must be logged in to create documents
          </p>
          <Button onClick={() => router.push("/login")}>Go to Login</Button>
        </div>
      </div>
    );
  }

  const renderModeIcon = (option: (typeof CREATION_OPTIONS)[0]) => {
    const Icon = option.icon;
    return <Icon className="w-4 h-4" />;
  };

  // Render comparison view
  if (comparisonResult) {
    const pdfjs = comparisonResult.pdfjs;
    const mupdf = comparisonResult.mupdf;

    return (
      <div className="flex-1 p-8">
        <div className="w-full max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={resetComparison}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <div>
                <h1 className="text-2xl font-semibold">Extraction Comparison</h1>
                <p className="text-gray-500 text-sm">{comparisonResult.file.name}</p>
              </div>
            </div>
            <Button onClick={createDocumentFromComparison} disabled={isProcessing}>
              {isProcessing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-2" />
              )}
              Use {selectedExtractor === "pdfjs" ? "PDF.js" : "MuPDF"} Result
            </Button>
          </div>

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

          {/* Error Display */}
          {error && (
            <div className="mt-6 bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-8">
      <div className="w-full max-w-4xl mx-auto">
        {/* Mode Selection Tabs */}
        <div className="mb-8">
          <Tabs
            value={selectedMode}
            onValueChange={(value) => setSelectedMode(value as CreationMode)}
          >
            <TabsList className="grid w-full grid-cols-4">
              {CREATION_OPTIONS.map((option) => (
                <TabsTrigger
                  key={option.id}
                  value={option.id}
                  className="flex items-center gap-2"
                >
                  {renderModeIcon(option)}
                  {option.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {/* Content Area */}
        <div className="min-h-[400px]">
          <TransitionPanel
            activeIndex={CREATION_OPTIONS.findIndex(
              (opt) => opt.id === selectedMode
            )}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            variants={{
              enter: { opacity: 0, y: -50, filter: "blur(4px)" },
              center: { opacity: 1, y: 0, filter: "blur(0px)" },
              exit: { opacity: 0, y: 50, filter: "blur(4px)" },
            }}
          >
            {/* PDF Upload Mode */}
            <div className="space-y-6">
              <div className="text-center mb-6">
                <h2 className="text-2xl font-semibold mb-2">
                  Upload PDF Document
                </h2>
                <p className="text-gray-600">
                  Extract text and create an audio-ready document from your PDF
                </p>
              </div>

              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-gray-400 transition-colors"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handlePDFDrop}
              >
                <div className="space-y-4">
                  <div className="mx-auto w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center">
                    {isProcessing ? (
                      <Loader2 className="w-8 h-8 text-gray-600 animate-spin" />
                    ) : (
                      <FileText className="w-8 h-8 text-gray-600" />
                    )}
                  </div>

                  <div>
                    <p className="text-gray-600 mb-4">
                      Drag and drop your PDF file here, or click to browse
                    </p>
                  </div>

                  <div>
                    <label htmlFor="pdf-upload">
                      <Button
                        variant="outline"
                        disabled={isProcessing}
                        className="cursor-pointer"
                        asChild
                      >
                        <span>
                          <Upload className="w-4 h-4 mr-2" />
                          {isProcessing ? "Processing..." : "Choose PDF File"}
                        </span>
                      </Button>
                    </label>
                    <input
                      id="pdf-upload"
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={handlePDFSelect}
                      disabled={isProcessing}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Website URL Mode */}
            <div className="space-y-6">
              <div className="text-center mb-6">
                <h2 className="text-2xl font-semibold mb-2">
                  Extract from Website
                </h2>
                <p className="text-gray-600">
                  Enter a URL to extract and process web content
                </p>
              </div>

              <div className="max-w-xl mx-auto space-y-4">
                <div>
                  <Label htmlFor="url-input" className="text-sm font-medium">
                    Website URL
                  </Label>
                  <Input
                    id="url-input"
                    type="url"
                    placeholder="https://example.com/article"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    className="mt-1"
                  />
                </div>

                <Button
                  onClick={handleCreate}
                  disabled={isProcessing || !urlInput.trim()}
                  className="w-full"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Extracting Content...
                    </>
                  ) : (
                    <>
                      <Globe className="w-4 h-4 mr-2" />
                      Extract Content
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Text Input Mode */}
            <div className="space-y-6">
              <div className="text-center mb-6">
                <h2 className="text-2xl font-semibold mb-2">
                  Create from Text
                </h2>
                <p className="text-gray-600">
                  Paste or type your text content directly
                </p>
              </div>

              <div className="max-w-2xl mx-auto space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <Label htmlFor="title-input" className="text-sm font-medium">
                      Title
                    </Label>
                    <span className="text-xs text-gray-500">
                      {titleInput.length}/200 characters
                    </span>
                  </div>
                  <Input
                    id="title-input"
                    placeholder="Document title"
                    value={titleInput}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value.length <= 200) {
                        setTitleInput(value);
                      }
                    }}
                    className="mt-1"
                    maxLength={200}
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <Label htmlFor="text-input" className="text-sm font-medium">
                      Content
                    </Label>
                    <span className="text-xs text-gray-500">
                      {textInput.length.toLocaleString()}/35,000 characters
                    </span>
                  </div>
                  <Textarea
                    id="text-input"
                    placeholder="Paste or type your text content here..."
                    value={textInput}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value.length <= 35000) {
                        setTextInput(value);
                      }
                    }}
                    className="mt-1 min-h-[200px]"
                    maxLength={35000}
                  />
                </div>

                <Button
                  onClick={handleCreate}
                  disabled={isProcessing || !textInput.trim() || !titleInput.trim()}
                  className="w-full"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating Document...
                    </>
                  ) : (
                    <>
                      <Type className="w-4 h-4 mr-2" />
                      Create Document
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Images OCR Mode */}
            <div className="space-y-6">
              <div className="text-center mb-6">
                <h2 className="text-2xl font-semibold mb-2">
                  Extract from Images
                </h2>
                <p className="text-gray-600">
                  Upload images to extract text using OCR technology
                </p>
                <p className="text-sm text-gray-500">
                  Maximum 10 images, 10MB each. Supports JPEG, PNG, GIF, BMP, WebP
                </p>
              </div>

              <div className="max-w-2xl mx-auto space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <Label
                      htmlFor="title-input-images"
                      className="text-sm font-medium"
                    >
                      Title
                    </Label>
                    <span className="text-xs text-gray-500">
                      {titleInput.length}/200 characters
                    </span>
                  </div>
                  <Input
                    id="title-input-images"
                    placeholder="Document title"
                    value={titleInput}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value.length <= 200) {
                        setTitleInput(value);
                      }
                    }}
                    className="mt-1"
                    maxLength={200}
                  />
                </div>

                <div
                  className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-gray-400 transition-colors"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleImageDrop}
                >
                  <div className="space-y-4">
                    <div className="mx-auto w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                      <Images className="w-6 h-6 text-gray-600" />
                    </div>

                    <p className="text-gray-600">
                      Drag and drop images here, or click to browse
                    </p>

                    <label htmlFor="image-upload">
                      <Button
                        variant="outline"
                        className="cursor-pointer"
                        asChild
                      >
                        <span>
                          <Upload className="w-4 h-4 mr-2" />
                          Choose Images
                        </span>
                      </Button>
                    </label>
                    <input
                      id="image-upload"
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleImageSelect}
                    />
                  </div>
                </div>

                {selectedImages.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">
                        Selected Images ({selectedImages.length})
                      </Label>
                      <span className="text-xs text-gray-500">
                        Drag to reorder • First image will be the thumbnail
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-96 overflow-y-auto p-2">
                      {selectedImages.map((image, index) => (
                        <div
                          key={index}
                          draggable
                          onDragStart={(e) => handleDragStart(e, index)}
                          onDragOver={(e) => handleDragOver(e, index)}
                          onDragEnd={handleDragEnd}
                          className={`relative group cursor-move border-2 rounded-lg overflow-hidden transition-all ${
                            draggedIndex === index 
                              ? 'opacity-50 border-blue-400' 
                              : 'border-gray-200 hover:border-gray-300'
                          } ${index === 0 ? 'ring-2 ring-blue-200' : ''}`}
                        >
                          {/* Image Preview */}
                          <div className="aspect-[4/3] bg-gray-100">
                            <img
                              src={getImagePreviewUrl(image)}
                              alt={`Preview ${index + 1}`}
                              className="w-full h-full object-cover"
                              onLoad={(e) => {
                                // Clean up object URL after loading
                                const img = e.target as HTMLImageElement;
                                setTimeout(() => {
                                  if (img.src.startsWith('blob:')) {
                                    URL.revokeObjectURL(img.src);
                                  }
                                }, 100);
                              }}
                            />
                          </div>
                          
                          {/* Image Info Overlay */}
                          <div className="absolute inset-x-0 bottom-0 bg-black bg-opacity-70 text-white p-2">
                            <div className="flex items-center justify-between">
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium truncate">
                                  {image.name}
                                </div>
                                <div className="text-xs opacity-75">
                                  {Math.round(image.size / 1024)}KB
                                </div>
                              </div>
                              <div className="flex items-center space-x-1 ml-2">
                                {index === 0 && (
                                  <span className="text-xs bg-blue-600 px-1 py-0.5 rounded">
                                    Thumb
                                  </span>
                                )}
                                <span className="text-xs opacity-75">
                                  #{index + 1}
                                </span>
                              </div>
                            </div>
                          </div>
                          
                          {/* Remove Button */}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => removeImage(index)}
                            className="absolute top-1 right-1 h-6 w-6 p-0 bg-red-500 hover:bg-red-600 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            ×
                          </Button>
                          
                          {/* Drag Handle */}
                          <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="h-6 w-6 bg-black bg-opacity-50 rounded flex items-center justify-center">
                              <div className="w-3 h-3 grid grid-cols-2 gap-0.5">
                                <div className="w-1 h-1 bg-white rounded-full"></div>
                                <div className="w-1 h-1 bg-white rounded-full"></div>
                                <div className="w-1 h-1 bg-white rounded-full"></div>
                                <div className="w-1 h-1 bg-white rounded-full"></div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {selectedImages.length >= 10 && (
                      <div className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
                        Maximum of 10 images reached. Remove images to add more.
                      </div>
                    )}
                  </div>
                )}

                {/* OCR Progress Bar */}
                {isProcessing && ocrProgress && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>
                        {ocrProgress.stage === 'loading' && 'Loading image...'}
                        {ocrProgress.stage === 'recognizing' && 'Extracting text...'}
                        {ocrProgress.stage === 'completed' && 'Completed!'}
                        {ocrProgress.stage === 'error' && 'Error processing image'}
                      </span>
                      <span>{ocrProgress.imageIndex + 1} of {ocrProgress.totalImages}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ 
                          width: `${ocrProgress.progress}%`
                        }}
                      />
                    </div>
                    <div className="text-xs text-gray-500 text-center">
                      {ocrProgress.currentImageName}
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleCreate}
                  disabled={isProcessing || selectedImages.length === 0 || !titleInput.trim()}
                  className="w-full"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {ocrProgress ? (
                        <>
                          Processing {ocrProgress.currentImageName} ({ocrProgress.imageIndex + 1}/{ocrProgress.totalImages})
                          {ocrProgress.progress > 0 && ` - ${ocrProgress.progress}%`}
                        </>
                      ) : (
                        "Processing Images..."
                      )}
                    </>
                  ) : (
                    <>
                      <Images className="w-4 h-4 mr-2" />
                      Extract Text from Images
                    </>
                  )}
                </Button>
              </div>
            </div>
          </TransitionPanel>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
