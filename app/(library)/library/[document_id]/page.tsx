"use client";

import React, { useMemo, use, useEffect, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAudioState, AudioProvider } from "@/app/features/audio/context";
import { useHeader } from "../../components/header-context";
import { DocumentVersionLoader } from "@/app/features/documents/components/document-version-loader";
import { CreateVersionDialog } from "@/app/features/documents/components/create-version-dialog";
import { generateWithAi } from "@/app/features/generate-with-ai";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import {
  TTSProvider,
  TTSPlayer,
  SentenceDisplay,
  parseSegmentsFromProcessedText,
} from "@/app/features/tts";

// Document Text View Component
function DocumentTextView() {
  const { loading, error, document } = useAudioState();
  const [isCreateVersionModalOpen, setCreateVersionModalOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setContent } = useHeader();

  // Sort versions by creation date (newest first)
  const sortedVersions = useMemo(() => {
    if (!document?.versions) return [];
    return [...document.versions].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [document?.versions]);

  // Get the active version ID from URL or default to first version
  const activeVersionId = useMemo(() => {
    const versionFromUrl = searchParams.get("version");
    if (versionFromUrl && sortedVersions.find((v) => v.id === versionFromUrl)) {
      return versionFromUrl;
    }
    return sortedVersions[0]?.id || "";
  }, [searchParams, sortedVersions]);

  // Get the active version from sorted versions
  const activeVersion = sortedVersions.find((v) => v.id === activeVersionId);

  // Parse segments from processed_text using the new utility
  const segments = useMemo(() => {
    if (!activeVersion) return [];
    return parseSegmentsFromProcessedText(activeVersion.processed_text);
  }, [activeVersion]);

  // Function to update URL with version parameter
  const updateVersionInUrl = useCallback(
    (versionId: string) => {
      if (!document) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set("version", versionId);
      router.push(`/library/${document.id}?${params.toString()}`);
    },
    [document, searchParams, router]
  );

  // Auto-update URL with version parameter if not present
  useEffect(() => {
    const versionFromUrl = searchParams.get("version");
    const firstVersionId = sortedVersions[0]?.id;

    // If no version in URL but we have versions, add the first version to URL
    if (!versionFromUrl && firstVersionId && sortedVersions.length > 0) {
      updateVersionInUrl(firstVersionId);
    }
  }, [searchParams, sortedVersions, updateVersionInUrl]);

  // Handle version change from header
  const handleVersionChange = useCallback(
    (versionId: string) => {
      updateVersionInUrl(versionId);
    },
    [updateVersionInUrl]
  );

  // Update header content when document changes
  useEffect(() => {
    if (document) {
      const category = searchParams.get("category");
      const backUrl = category ? `/library?category=${category}` : "/library";

      setContent({
        documentTitle: document.title,
        backUrl,
        documentVersions: sortedVersions,
        activeVersionId: activeVersionId,
        onVersionChange: handleVersionChange,
      });
    }

    // Cleanup on unmount
    return () => {
      setContent({});
    };
  }, [
    document,
    searchParams,
    setContent,
    sortedVersions,
    activeVersionId,
    handleVersionChange,
  ]);

  // Early returns after all hooks are called
  if (loading) {
    return <DocumentVersionLoader />;
  }

  if (error || !document) {
    return (
      <div className="w-full flex justify-center p-4">
        <div className="max-w-7xl w-full">
          <div className="text-center py-12">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Document not found
            </h2>
            <p className="text-gray-500 mb-4">
              The document you're looking for doesn't exist or has been removed.
            </p>
            <button
              onClick={() => router.push("/library")}
              className="text-blue-600 hover:text-blue-800"
            >
              Back to Library
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!activeVersion) {
    return (
      <div className="w-full flex justify-center p-4">
        <div className="max-w-7xl w-full">
          <div className="text-center py-12">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              No versions available
            </h2>
            <p className="text-gray-500 mb-4">
              This document doesn't have any versions yet.
            </p>
            <button
              onClick={() => router.push(`/library/${document.id}`)}
              className="text-blue-600 hover:text-blue-800"
            >
              Back to Document
            </button>
          </div>
        </div>
      </div>
    );
  }

  function handleGenerateVersion(
    processingLevel: 0 | 1 | 2 | 3,
    voiceArray: string[],
    _language: string
  ) {
    if (document && document.raw_text)
      generateWithAi({
        documentId: document.id,
        existingDocumentVersions: document.versions,
        rawInputText: document.raw_text,
        voicesArray: voiceArray,
        processingLevel,
      });
    else console.log("empty text");
  }

  function handleCloseCreateVersionModal() {
    setCreateVersionModalOpen(false);
  }

  return (
    <Dialog
      open={isCreateVersionModalOpen}
      onOpenChange={setCreateVersionModalOpen}
    >
      <TTSProvider segments={segments}>
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {/* Header */}
            <div className="max-w-4xl mx-auto px-8 pt-8">
              <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-semibold text-gray-900">
                  {document.title}
                </h1>
                <div className="flex items-center gap-1">
                  {sortedVersions.length > 0 && (
                    <Select
                      value={activeVersionId}
                      onValueChange={handleVersionChange}
                    >
                      <SelectTrigger className="text-gray-800">
                        <SelectValue placeholder="Select version" />
                      </SelectTrigger>
                      <SelectContent>
                        {sortedVersions.map((version) => (
                          <SelectItem
                            key={version.id}
                            value={version.id}
                            className="cursor-pointer"
                          >
                            {version.version_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button
                    variant="outline"
                    className="relative"
                    onClick={() => setCreateVersionModalOpen(true)}
                    title="Create new version"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* TTS Player - Sticky */}
            <div className="sticky top-0 z-10 bg-white border-b border-gray-200 mb-8">
              <div className="max-w-4xl mx-auto px-8">
                <TTSPlayer />
              </div>
            </div>

            {/* Sentence Display with Highlighting */}
            <div className="max-w-4xl mx-auto px-8 pb-8">
              <div className="prose prose-lg max-w-none">
                <SentenceDisplay />
              </div>
            </div>
          </div>
        </div>
      </TTSProvider>

      <CreateVersionDialog
        document={document}
        handleGenerateVersion={handleGenerateVersion}
        onClose={handleCloseCreateVersionModal}
      />
      <DialogTrigger className="hidden" />
    </Dialog>
  );
}

// Main Document Text Page Component
export default function DocumentTextPage({
  params,
}: {
  params: Promise<{ document_id: string }>;
}) {
  // Unwrap the params Promise
  const resolvedParams = use(params);

  return (
    <AudioProvider documentId={resolvedParams.document_id}>
      <DocumentTextView />
    </AudioProvider>
  );
}
