"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TransitionPanel } from "@/components/ui/transition-panel";
import { Upload, FileText, Loader2, Type, Images, Globe } from "lucide-react";
import Image from "next/image";
import { processPDFWithMuPDFAction } from "@/app/features/pdf/actions/mupdf-actions";
import { createDocumentAction, createDocumentVersionAction, updateDocumentAction } from "@/app/features/documents/actions";
import { convertTTSSectionsToBlocks, convertBlocksToProcessedText } from "@/app/features/block-editor";
import { REMOVABLE_HIGHLIGHT_TYPES } from "@/app/features/pdf/types";
import { getTTSSections, removeHighlightedSections } from "@/app/features/pdf/helpers/remove-highlights";
import type { TextHighlight } from "@/app/features/pdf/types";
import { useAppSettings } from "@/app/features/app-settings/context";

type CreationMode = "pdf" | "url" | "text" | "images";

// Document creation options
const CREATION_OPTIONS = [
  {
    id: "pdf",
    name: "PDF",
    icon: FileText,
    description: "Upload a PDF document",
  },
  {
    id: "url",
    name: "Website",
    icon: Globe,
    description: "Extract from URL",
  },
  {
    id: "text",
    name: "Text",
    icon: Type,
    description: "Paste or type text",
  },
  {
    id: "images",
    name: "Images",
    icon: Images,
    description: "Upload images for OCR",
  },
];

interface NewDocumentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewDocumentModal({
  open,
  onOpenChange,
}: NewDocumentModalProps) {
  const [selectedMode, setSelectedMode] = useState<CreationMode>("pdf");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const router = useRouter();
  const { debugMode } = useAppSettings();

  // Form states
  const [urlInput, setUrlInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [selectedImages, setSelectedImages] = useState<File[]>([]);

  // Get user on mount
  useEffect(() => {
    const getUser = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();
  }, []);

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setError(null);
      setUrlInput("");
      setTextInput("");
      setTitleInput("");
      setSelectedImages([]);
    }
  }, [open]);

  // Clear error when mode changes
  useEffect(() => {
    setError(null);
  }, [selectedMode]);

  // Convert file to base64 for server action
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
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

      if (!response.ok) return null;

      const data = await response.json();
      return {
        documentType: data.documentType,
        language: data.language,
      };
    } catch {
      return null;
    }
  };

  // Process PDF directly using MuPDF
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

      // Process with MuPDF
      const mupdfResult = await processPDFWithMuPDFAction(base64Data, file.name);

      if (mupdfResult.error || !mupdfResult.data) {
        throw new Error(mupdfResult.error || "Failed to process PDF");
      }

      const extractorData = mupdfResult.data;
      const highlights: TextHighlight[] = extractorData.documentHighlights || [];

      // Clean the text by removing all removable highlights
      const cleanedText = removeHighlightedSections(
        extractorData.text,
        highlights,
        [...REMOVABLE_HIGHLIGHT_TYPES]
      );

      const thumbnailDataUrl = await generatePDFThumbnail(file);

      // Extract metadata with proper type handling
      const metadata = extractorData.metadata || {};
      const docAuthor = String(metadata.Author || metadata.author || "");
      const docTitle = String(metadata.Title || metadata.title || file.name.replace(".pdf", ""));

      // Create document
      const { data: doc, error: docError } = await createDocumentAction({
        mime_type: file.type,
        file_type: "pdf",
        author: docAuthor,
        title: docTitle,
        filename: file.name,
        document_type: "",
        raw_text: cleanedText,
        page_count: extractorData.numPages,
        file_size: file.size,
        metadata: {
          extractedAt: new Date().toISOString(),
          processingMethod: "mupdf-verified-sections",
          ...metadata,
        },
      });

      if (docError || !doc) {
        throw new Error(docError || "Failed to create document");
      }

      // Upload thumbnail if generated
      if (thumbnailDataUrl) {
        try {
          const { uploadDocumentThumbnailAction } = await import(
            "@/app/features/documents/actions"
          );
          await uploadDocumentThumbnailAction(doc.id, thumbnailDataUrl);
        } catch (thumbError) {
          console.warn("Thumbnail upload failed:", thumbError);
        }
      }

      // Classify document
      if (cleanedText.trim().length > 0) {
        const classification = await classifyDocument(cleanedText.trim());
        if (classification) {
          await updateDocumentAction(doc.id, {
            language: classification.language,
            document_type: classification.documentType,
          });
        }
      }

      // Get verified sections from highlights
      const ttsSections = getTTSSections(extractorData.text, highlights);

      // Create blocks from sections
      const sectionsToConvert = ttsSections.length > 0
        ? ttsSections
        : [{ title: docTitle, level: 1, content: cleanedText }];

      const blocks = convertTTSSectionsToBlocks(sectionsToConvert);
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
          extractor: "mupdf",
        },
      });

      if (!versionError) {
        const processedTextObject = JSON.parse(processedTextJson);
        await updateDocumentAction(doc.id, {
          processed_text: processedTextObject,
        });
      }

      // Close modal and navigate to document
      onOpenChange(false);
      router.push(`/library/${doc.id}`);
    } catch (err) {
      console.error("Error processing PDF:", err);
      setError(err instanceof Error ? err.message : "Failed to process PDF");
    } finally {
      setIsProcessing(false);
    }
  };

  // PDF Upload handlers
  const handlePDFSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Please select a PDF file");
      return;
    }

    // In debug mode, redirect to page for comparison view
    if (debugMode) {
      onOpenChange(false);
      router.push("/library/new-document");
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

    // In debug mode, redirect to page for comparison view
    if (debugMode) {
      onOpenChange(false);
      router.push("/library/new-document");
      return;
    }

    await processPDFDocument(pdfFile);
  };

  // Image upload handlers
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/bmp",
      "image/webp",
    ];
    const imageFiles = files.filter((file) => allowedTypes.includes(file.type));

    if (imageFiles.length !== files.length) {
      setError("Please select only supported image files");
      return;
    }

    setSelectedImages((prev) => [...prev, ...imageFiles].slice(0, 10));
    setError(null);
  };

  const removeImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  };

  // For complex operations, redirect to full page
  const handleContinue = () => {
    onOpenChange(false);
    router.push(`/library/new-document?mode=${selectedMode}`);
  };

  const renderModeIcon = (option: (typeof CREATION_OPTIONS)[0]) => {
    const Icon = option.icon;
    return <Icon className="w-4 h-4" />;
  };

  // Check if Create button should be enabled based on current mode
  const isCreateEnabled = () => {
    switch (selectedMode) {
      case "pdf":
        return false; // PDF uses direct upload, not the Create button
      case "url":
        return urlInput.trim().length > 0;
      case "text":
        return titleInput.trim().length > 0 && textInput.trim().length > 0;
      case "images":
        return titleInput.trim().length > 0 && selectedImages.length > 0;
      default:
        return false;
    }
  };

  if (!user) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl bg-gray-100">
          <DialogTitle className="sr-only">New Document</DialogTitle>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl h-[600px] overflow-hidden bg-gray-100 flex flex-col"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">New Document</DialogTitle>
        {/* Mode Selection Tabs at top */}
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

        {/* Content Area */}
        <div className="flex-1 mt-4 overflow-y-auto px-1">
          <TransitionPanel
            activeIndex={CREATION_OPTIONS.findIndex(
              (opt) => opt.id === selectedMode
            )}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            variants={{
              enter: { opacity: 0, y: -20, filter: "blur(4px)" },
              center: { opacity: 1, y: 0, filter: "blur(0px)" },
              exit: { opacity: 0, y: 20, filter: "blur(4px)" },
            }}
          >
            {/* PDF Upload Mode */}
            <div className="space-y-4">
              {isProcessing ? (
                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                  <Loader2 className="w-12 h-12 animate-spin text-brand-primary-dark" />
                  <p className="text-gray-600 font-medium">Processing PDF...</p>
                  <p className="text-gray-500 text-sm">Extracting text and creating document</p>
                </div>
              ) : (
                <>
                  <div className="flex justify-center mb-4">
                    <Image
                      src="/doodles/ReadingDoodle.svg"
                      alt=""
                      width={200}
                      height={200}
                      className="opacity-80"
                    />
                  </div>
                  <p className="text-sm text-gray-600 text-center">
                    Upload a PDF document for text extraction
                  </p>

                  <div
                    className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-gray-400 transition-colors"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handlePDFDrop}
                  >
                    <div className="space-y-3">
                      <div className="mx-auto w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                        <FileText className="w-6 h-6 text-gray-600" />
                      </div>

                      <p className="text-gray-600 text-sm">
                        Drag and drop your PDF here, or click to browse
                      </p>

                      <label htmlFor="pdf-upload-modal">
                        <Button
                          variant="outline"
                          className="cursor-pointer"
                          asChild
                        >
                          <span>
                            <Upload className="w-4 h-4 mr-2" />
                            Choose PDF File
                          </span>
                        </Button>
                      </label>
                      <input
                        id="pdf-upload-modal"
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={handlePDFSelect}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Website URL Mode */}
            <div className="space-y-4">
              <div className="flex justify-center mb-4">
                <Image
                  src="/doodles/UnboxingDoodle.svg"
                  alt=""
                  width={200}
                  height={200}
                  className="opacity-80"
                />
              </div>
              <p className="text-sm text-gray-600 text-center">
                Enter a URL to extract web content
              </p>

              <div>
                <Label
                  htmlFor="url-input-modal"
                  className="text-sm font-medium"
                >
                  Website URL
                </Label>
                <Input
                  id="url-input-modal"
                  type="url"
                  placeholder="https://example.com/article"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  className="mt-1 bg-white"
                />
              </div>
            </div>

            {/* Text Input Mode */}
            <div className="space-y-4">
              <div className="flex justify-center mb-4">
                <Image
                  src="/doodles/FloatDoodle.svg"
                  alt=""
                  width={200}
                  height={200}
                  className="opacity-80"
                />
              </div>
              <p className="text-sm text-gray-600 text-center">
                Paste or type your text content
              </p>

              <div className="space-y-3">
                <div>
                  <Label
                    htmlFor="title-input-modal"
                    className="text-sm font-medium"
                  >
                    Title
                  </Label>
                  <Input
                    id="title-input-modal"
                    placeholder="Document title"
                    value={titleInput}
                    onChange={(e) =>
                      setTitleInput(e.target.value.slice(0, 200))
                    }
                    className="mt-1 bg-white"
                  />
                </div>

                <div>
                  <Label
                    htmlFor="text-input-modal"
                    className="text-sm font-medium"
                  >
                    Content
                  </Label>
                  <Textarea
                    id="text-input-modal"
                    placeholder="Paste or type your text content here..."
                    value={textInput}
                    onChange={(e) =>
                      setTextInput(e.target.value.slice(0, 35000))
                    }
                    className="mt-1 min-h-[120px] bg-white"
                  />
                </div>
              </div>
            </div>

            {/* Images OCR Mode */}
            <div className="space-y-4">
              <div className="flex justify-center mb-4">
                <Image
                  src="/doodles/SelfieDoodle.svg"
                  alt=""
                  width={200}
                  height={200}
                  className="opacity-80"
                />
              </div>
              <p className="text-sm text-gray-600 text-center">
                Upload images to extract text using OCR
              </p>

              <div className="space-y-3">
                <div>
                  <Label
                    htmlFor="title-input-images-modal"
                    className="text-sm font-medium"
                  >
                    Title
                  </Label>
                  <Input
                    id="title-input-images-modal"
                    placeholder="Document title"
                    value={titleInput}
                    onChange={(e) =>
                      setTitleInput(e.target.value.slice(0, 200))
                    }
                    className="mt-1 bg-white"
                  />
                </div>

                <div
                  className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const files = Array.from(e.dataTransfer.files);
                    const imageFiles = files.filter((f) =>
                      f.type.startsWith("image/")
                    );
                    setSelectedImages((prev) =>
                      [...prev, ...imageFiles].slice(0, 10)
                    );
                  }}
                >
                  <div className="space-y-2">
                    <Images className="w-8 h-8 text-gray-400 mx-auto" />
                    <p className="text-gray-600 text-sm">
                      Drag images here or click to browse
                    </p>
                    <label htmlFor="image-upload-modal">
                      <Button
                        variant="outline"
                        size="sm"
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
                      id="image-upload-modal"
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleImageSelect}
                    />
                  </div>
                </div>

                {selectedImages.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedImages.map((img, i) => (
                      <div key={i} className="relative">
                        <div className="w-16 h-16 bg-gray-100 rounded border overflow-hidden">
                          <img
                            src={URL.createObjectURL(img)}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <button
                          onClick={() => removeImage(i)}
                          className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TransitionPanel>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-between pt-0 mt-auto">
          <Button
            variant="outline"
            className="bg-white"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          {selectedMode !== "pdf" && (
            <Button
              onClick={handleContinue}
              disabled={!isCreateEnabled() || isProcessing}
              className="bg-brand-primary-dark hover:bg-brand-primary-dark/90"
            >
              Create
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
