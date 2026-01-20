"use client";

import React, { useMemo, useState, use, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAudioState, AudioProvider } from "@/app/features/audio/context";
import { useAudioPlayer } from "@/app/features/audio/hooks/use-audio-player";
import { Plus, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { CreateVersionDialogLegacy as CreateVersionDialog } from "@/app/features/documents/components/create-version-dialog-legacy";
import { DocumentVersionLoader } from "@/app/features/documents/components/document-version-loader";
import { DocumentVersionContent } from "@/app/features/documents/components/document-version-content2";
import { generateWithAi } from "@/app/features/generate-with-ai";

// Document Detail View Component
function DocumentDetailView() {
  // All hooks must be called at the top, before any conditional logic
  const { audioVersions, loading, error, document } = useAudioState();
  const [isCreateVersionModalOpen, setCreateVersionModalOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Sort versions by creation date (newest first) - handle null document
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

  // Audio player hook
  const audioPlayer = useAudioPlayer({
    audioVersions: audioVersions || [],
    documentVersionId: activeVersionId,
  });

  // Get the active version from sorted versions
  const activeVersion = sortedVersions.find((v) => v.id === activeVersionId);

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
    <div className="flex-1 flex flex-col overflow-hidden">
      <Dialog
        open={isCreateVersionModalOpen}
        onOpenChange={setCreateVersionModalOpen}
      >
        <div className="relative gap-0 flex-1 flex flex-col overflow-hidden">
          {/* Active Version Content */}
          {activeVersion ? (
            <DocumentVersionContent
              document={document}
              documentVersion={activeVersion}
              audioVersions={audioVersions}
              audioPlayer={audioPlayer}
              documentVersions={sortedVersions}
              activeVersionId={activeVersionId}
              onVersionChange={handleVersionChange}
              onCreateNewVersion={() => setCreateVersionModalOpen(true)}
            />
          ) : (
            /* No versions state - Minimal screen */
            <div className="flex-1 p-8 pt-[10%]">
              <div className="max-w-md w-full mx-auto text-center space-y-6">
                {/* Document Thumbnail */}
                <div className="mx-auto w-32 h-40 bg-gray-100 rounded-lg border overflow-hidden shadow-sm">
                  {document.thumbnail_path ? (
                    <div
                      className="w-full h-full bg-cover bg-center"
                      style={{
                        backgroundImage: `url("${document.thumbnail_path}")`,
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Type className="w-12 h-12 text-gray-400" />
                    </div>
                  )}
                </div>

                {/* Document Title */}
                <div>
                  <h1 className="text-2xl font-semibold text-gray-900 mb-2">
                    {document.title}
                  </h1>
                  {document.author && (
                    <p className="text-gray-500">by {document.author}</p>
                  )}
                </div>

                {/* Call to Action */}
                <div className="space-y-3">
                  <Button
                    onClick={() => setCreateVersionModalOpen(true)}
                    size="lg"
                    className="w-full"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Create First Audio Version
                  </Button>
                </div>
              </div>
            </div>
          )}

          <CreateVersionDialog
            document={document}
            handleGenerateVersion={handleGenerateVersion}
            onClose={handleCloseCreateVersionModal}
          />

          {/* Hidden dialog trigger - controlled by header button */}
          <DialogTrigger className="hidden" />
        </div>
      </Dialog>

      {/* Footer - Audio Player Controls - Only show when sticky header is not present */}
    </div>
  );
}

// Main Document Detail Page Component
export default function DocumentDetailPage({
  params,
}: {
  params: Promise<{ document_id: string }>;
}) {
  // Unwrap the params Promise
  const resolvedParams = use(params);

  return (
    <AudioProvider documentId={resolvedParams.document_id}>
      <DocumentDetailView />
    </AudioProvider>
  );
}
