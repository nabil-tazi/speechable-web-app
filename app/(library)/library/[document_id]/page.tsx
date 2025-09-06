"use client";

import React, { useMemo, useState, use, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAudioState, AudioProvider } from "@/app/features/audio/context";
import { useAudioPlayer } from "@/app/features/audio/hooks/use-audio-player";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { CreateVersionDialog } from "@/app/features/documents/components/create-version-dialog";
import { DocumentVersionLoader } from "@/app/features/documents/components/document-version-loader";
import { DocumentVersionContent } from "@/app/features/documents/components/document-version-content2";
import { AudioPlayerControls } from "@/app/features/audio/components/audio-player-controls";
import { generateWithAi } from "@/app/features/generate-with-ai";
import { GlowEffect } from "@/components/ui/glow-effect";
import { useHeader } from "../../components/header-context";

// Document Detail View Component
function DocumentDetailView() {
  // All hooks must be called at the top, before any conditional logic
  const { audioVersions, loading, error, document } = useAudioState();
  const [isCreateVersionModalOpen, setCreateVersionModalOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setContent } = useHeader();

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
        // activeVersionId: activeVersionId,
        //         onVersionChange: handleVersionChange,
        // actions: undefined,
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

  // Get the active version from sorted versions
  const activeVersion = sortedVersions.find((v) => v.id === activeVersionId);

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
            /* No versions state */
            <div className="flex-1 flex items-center justify-center">
              <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
                <p className="text-gray-500">
                  No versions available for this document.
                </p>
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

      {/* Footer - Audio Player Controls */}
      <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 max-w-[800px] w-[80%] border-1 rounded-sm border-gray-200 bg-white overflow-hidden shadow-sm">
        {audioVersions.length > 0 &&
          document &&
          activeVersionId &&
          (audioPlayer.isLoading ? (
            <div className="bg-white">
              <div className="w-full h-14.25 flex items-center">
                <div className="flex items-center gap-2 px-4">
                  {/* Skip backward skeleton */}
                  <div className="h-6 w-6 bg-gray-200 rounded animate-pulse" />
                  {/* Play button skeleton */}
                  <div className="h-8 w-8 bg-gray-200 rounded-full animate-pulse" />
                  {/* Skip forward skeleton */}
                  <div className="h-6 w-6 bg-gray-200 rounded animate-pulse" />
                  {/* Speed selector skeleton */}
                  <div className="h-6 w-12 bg-gray-200 rounded animate-pulse ml-1" />
                </div>
                {/* Waveform skeleton */}
                <div className="relative w-full px-4">
                  <div className="w-full h-10 bg-gray-200 rounded animate-pulse" />
                </div>
                {/* Time display skeleton */}
                <div className="px-4 flex gap-2">
                  <div className="h-4 w-12 bg-gray-200 rounded animate-pulse" />
                </div>
              </div>
            </div>
          ) : (
            <AudioPlayerControls audioPlayer={audioPlayer} />
          ))}
      </div>
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
