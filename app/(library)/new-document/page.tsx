"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";
import { createDocumentAction } from "@/app/features/documents/actions";
import { processPDFFile } from "@/app/features/pdf/utils/pdf-processing";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Loader2 } from "lucide-react";

export default function CreatePage() {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const router = useRouter();

  // Get user on mount
  useEffect(() => {
    const getUser = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      setIsLoadingUser(false);
    };
    getUser();
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Please select a PDF file");
      return;
    }

    await uploadDocument(file);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const pdfFile = files.find((file) => file.type === "application/pdf");

    if (!pdfFile) {
      setError("Please upload a PDF file");
      return;
    }

    await uploadDocument(pdfFile);
  };

  const uploadDocument = async (file: File) => {
    if (!user) {
      setError("You must be logged in to upload documents");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      // Process PDF to extract text and metadata
      const pdfData = await processPDFFile(file);

      // Generate PDF thumbnail
      const thumbnailDataUrl = await generatePDFThumbnail(file);

      // Create document record
      const { data: doc, error: docError } = await createDocumentAction({
        mime_type: file.type,
        file_type: "pdf",
        author: pdfData.metadata.Author || "",
        title: pdfData.metadata.Title || file.name.replace('.pdf', ''),
        filename: file.name,
        document_type: "",
        raw_text: pdfData.text,
        page_count: pdfData.numPages,
        file_size: file.size,
        metadata: {
          extractedAt: new Date().toISOString(),
          processingMethod: "client-side",
          ...pdfData.metadata,
        },
      });

      if (docError || !doc) {
        throw new Error(docError || "Failed to create document");
      }

      // Upload thumbnail if generated
      if (thumbnailDataUrl) {
        try {
          const { uploadDocumentThumbnailAction } = await import("@/app/features/documents/actions");
          await uploadDocumentThumbnailAction(doc.id, thumbnailDataUrl);
        } catch (thumbError) {
          console.warn("Thumbnail upload failed:", thumbError);
          // Don't fail the whole process for thumbnail issues
        }
      }

      // Classify document if we have text
      if (pdfData.text.trim().length > 0) {
        try {
          const classification = await classifyDocument(pdfData.text.trim());
          if (classification) {
            const { updateDocumentAction } = await import("@/app/features/documents/actions");
            await updateDocumentAction(doc.id, {
              language: classification.language,
              document_type: classification.documentType,
            });
          }
        } catch (classifyError) {
          console.warn("Document classification failed:", classifyError);
          // Don't fail the whole process for classification issues
        }
      }

      // Now redirect to the document page
      router.push(`/library/${doc.id}`);

    } catch (err) {
      console.error("Error uploading document:", err);
      setError(err instanceof Error ? err.message : "Failed to upload document");
    } finally {
      setIsUploading(false);
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

  // Function to classify document
  const classifyDocument = async (text: string): Promise<{ documentType: string; language: string } | null> => {
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
      return {
        documentType: data.documentType,
        language: data.language,
      };
    } catch (err) {
      console.error("Error classifying document:", err);
      return null;
    }
  };

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
          <p className="text-gray-500 mb-4">You must be logged in to upload documents</p>
          <Button onClick={() => router.push('/login')}>
            Go to Login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        {/* Upload Area */}
        <div
          className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-gray-400 transition-colors"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <div className="space-y-4">
            <div className="mx-auto w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
              {isUploading ? (
                <Loader2 className="w-6 h-6 text-gray-600 animate-spin" />
              ) : (
                <Upload className="w-6 h-6 text-gray-600" />
              )}
            </div>
            
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Upload PDF Document
              </h3>
              <p className="text-gray-600 mb-4">
                Drag and drop your PDF file here, or click to browse
              </p>
            </div>

            <div>
              <label htmlFor="file-upload">
                <Button 
                  variant="outline" 
                  disabled={isUploading}
                  className="cursor-pointer"
                  asChild
                >
                  <span>
                    <FileText className="w-4 h-4 mr-2" />
                    {isUploading ? "Uploading..." : "Choose File"}
                  </span>
                </Button>
              </label>
              <input
                id="file-upload"
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleFileSelect}
                disabled={isUploading}
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 text-center text-sm text-gray-500">
          <p>Supported format: PDF files only</p>
        </div>
      </div>
    </div>
  );
}