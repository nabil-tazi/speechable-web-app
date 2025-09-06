"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";
import { createDocumentAction } from "@/app/features/documents/actions";
import { processPDFFile } from "@/app/features/pdf/utils/pdf-processing";
import { Button } from "@/components/ui/button";
import {
  Upload,
  FileText,
  Loader2,
  Link as LinkIcon,
  Type,
  Images,
  Globe,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TransitionPanel } from "@/components/ui/transition-panel";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

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

export default function NewDocumentPage() {
  const [selectedMode, setSelectedMode] = useState<CreationMode>("pdf");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const router = useRouter();

  // Form states for different modes
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
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));

    if (imageFiles.length !== files.length) {
      setError("Please select only image files");
      return;
    }

    setSelectedImages((prev) => [...prev, ...imageFiles]);
    setError(null);
  };

  const handleImageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));

    if (imageFiles.length !== files.length) {
      setError("Please upload only image files");
      return;
    }

    setSelectedImages((prev) => [...prev, ...imageFiles]);
    setError(null);
  };

  const removeImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  };

  // Process PDF document
  const processPDFDocument = async (file: File) => {
    if (!user) {
      setError("You must be logged in to create documents");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const pdfData = await processPDFFile(file);
      const thumbnailDataUrl = await generatePDFThumbnail(file);

      const doc = await createDocumentFromData({
        title: pdfData.metadata.Title || file.name.replace(".pdf", ""),
        author: pdfData.metadata.Author || "",
        text: pdfData.text,
        file_type: "pdf",
        mime_type: file.type,
        filename: file.name,
        page_count: pdfData.numPages,
        file_size: file.size,
        metadata: {
          extractedAt: new Date().toISOString(),
          processingMethod: "client-side",
          ...pdfData.metadata,
        },
        thumbnailDataUrl,
      });

      router.push(`/library/${doc.id}`);
    } catch (err) {
      console.error("Error processing PDF:", err);
      setError(err instanceof Error ? err.message : "Failed to process PDF");
    } finally {
      setIsProcessing(false);
    }
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
    if (!user || !textInput.trim()) {
      setError("Please enter some text content");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const doc = await createDocumentFromData({
        title: titleInput.trim() || "Text Document",
        text: textInput.trim(),
        file_type: "text",
        mime_type: "text/plain",
        filename: `${titleInput.trim() || "text-document"}.txt`,
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

  // Process images with OCR
  const processImages = async () => {
    if (!user || selectedImages.length === 0) {
      setError("Please select at least one image");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // TODO: Implement OCR processing for images
      // This would involve calling an OCR service API
      const ocrPromises = selectedImages.map(async (image) => {
        // Mock OCR processing - replace with actual OCR service
        return new Promise<string>((resolve) => {
          setTimeout(() => {
            resolve(`OCR text extracted from ${image.name}`);
          }, 1000);
        });
      });

      const ocrResults = await Promise.all(ocrPromises);
      const combinedText = ocrResults.join("\n\n");

      const doc = await createDocumentFromData({
        title: titleInput.trim() || "OCR Document",
        text: combinedText,
        file_type: "images",
        mime_type: "image/mixed",
        filename: `${titleInput.trim() || "ocr-document"}.txt`,
        metadata: {
          extractedAt: new Date().toISOString(),
          processingMethod: "ocr",
          imageCount: selectedImages.length,
          imageNames: selectedImages.map((img) => img.name),
        },
      });

      router.push(`/library/${doc.id}`);
    } catch (err) {
      console.error("Error processing images:", err);
      setError(err instanceof Error ? err.message : "Failed to process images");
    } finally {
      setIsProcessing(false);
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
                  <Label htmlFor="title-input" className="text-sm font-medium">
                    Title (Optional)
                  </Label>
                  <Input
                    id="title-input"
                    placeholder="Document title"
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="text-input" className="text-sm font-medium">
                    Content
                  </Label>
                  <Textarea
                    id="text-input"
                    placeholder="Paste or type your text content here..."
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    className="mt-1 min-h-[200px]"
                  />
                </div>

                <Button
                  onClick={handleCreate}
                  disabled={isProcessing || !textInput.trim()}
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
              </div>

              <div className="max-w-2xl mx-auto space-y-4">
                <div>
                  <Label
                    htmlFor="title-input-images"
                    className="text-sm font-medium"
                  >
                    Title (Optional)
                  </Label>
                  <Input
                    id="title-input-images"
                    placeholder="Document title"
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    className="mt-1"
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
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Selected Images
                    </Label>
                    <div className="space-y-2 max-h-32 overflow-y-auto">
                      {selectedImages.map((image, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between bg-gray-50 p-2 rounded"
                        >
                          <span className="text-sm text-gray-700 truncate">
                            {image.name}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeImage(index)}
                            className="h-6 w-6 p-0"
                          >
                            ×
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleCreate}
                  disabled={isProcessing || selectedImages.length === 0}
                  className="w-full"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing Images...
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
