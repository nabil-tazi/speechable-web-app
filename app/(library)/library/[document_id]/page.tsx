"use client";

import React, { useMemo, useState, useTransition, use, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAudioState, AudioProvider } from "@/app/features/audio/context";
import { useAudioPlayer } from "@/app/features/audio/hooks/use-audio-player";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { CreateVersionDialog } from "@/app/features/documents/components/create-version-dialog";
import { DocumentVersionLoader } from "@/app/features/documents/components/document-version-loader";
import { DocumentVersionContent } from "@/app/features/documents/components/document-version-content2";
import { AudioPlayerControls } from "@/app/features/audio/components/audio-player-controls";
import { generateWithAi } from "@/app/features/generate-with-ai";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { GlowEffect } from "@/components/ui/glow-effect";

// Document Detail View Component
function DocumentDetailView() {
  // All hooks must be called at the top, before any conditional logic
  const { audioVersions, loading, error, document } = useAudioState();
  const [localActiveTab, setLocalActiveTab] = useState<string>("");
  const [, startTransition] = useTransition();
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

  // Function to update URL with version parameter
  const updateVersionInUrl = (versionId: string) => {
    if (!document) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("version", versionId);
    router.push(`/library/${document.id}?${params.toString()}`);
  };

  // Auto-update URL with version parameter if not present
  useEffect(() => {
    const versionFromUrl = searchParams.get("version");
    const firstVersionId = sortedVersions[0]?.id;

    // If no version in URL but we have versions, add the first version to URL
    if (!versionFromUrl && firstVersionId && sortedVersions.length > 0) {
      updateVersionInUrl(firstVersionId);
    }
  }, [searchParams, sortedVersions]);

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

  // function handleTabChange(versionId: string, index: number) {
  //   // setActiveTab(index);
  //   updateVersionInUrl(versionId);
  // }

  function handleTabChange(value: string) {
    // Update local state immediately for instant UI feedback
    setLocalActiveTab(value);

    // Update URL in a transition to avoid blocking the UI
    startTransition(() => {
      updateVersionInUrl(value);
      // Reset local state once URL is updated
      setLocalActiveTab("");
    });
  }

  const activeTab = localActiveTab || activeVersionId;

  const category = searchParams.get("category");
  const backUrl = category ? `/library?category=${category}` : "/library";

  return (
    <div className="h-full flex flex-col">
      <Dialog
        open={isCreateVersionModalOpen}
        onOpenChange={setCreateVersionModalOpen}
      >
        <Tabs
          // value={activeVersionId}
          // onValueChange={(versionId) => {
          //   const index = sortedVersions.findIndex((v) => v.id === versionId);
          //   handleTabChange(versionId, index);
          // }}
          value={activeTab}
          onValueChange={handleTabChange}
          className="relative gap-0 flex-1 flex flex-col overflow-hidden"
        >
          <>
            <header className="flex items-center gap-2 border-b">
              <div className="flex w-full items-center px-6 py-4 justify-between">
                {/* <h1 className="text-base font-medium">Library</h1> */}
                <div className="flex w-full items-center gap-3">
                  <Breadcrumb>
                    <BreadcrumbList>
                      <BreadcrumbItem>
                        <BreadcrumbLink asChild>
                          <Link
                            href={backUrl}
                            className="flex items-center space-x-2 text-gray-600 hover:text-gray-900"
                          >
                            Library
                          </Link>
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        <BreadcrumbPage className="truncate max-w-96">
                          {document.title}
                        </BreadcrumbPage>
                      </BreadcrumbItem>
                      {/* <BreadcrumbSeparator /> */}

                      {/* {sortedVersions.length === 1 && (
                        <>
                          <BreadcrumbItem>
                        <BreadcrumbPage className="truncate max-w-48">
                          {sortedVersions[0].version_name}
                        </BreadcrumbPage>
                      </BreadcrumbItem>
                        </>
                      )} */}
                    </BreadcrumbList>
                  </Breadcrumb>
                </div>
                <DialogTrigger asChild>
                  <div className="relative">
                    <GlowEffect
                      colors={["#FF5733", "#33FF57", "#3357FF", "#F1C40F"]}
                      mode="breathe"
                      blur="medium"
                      duration={3}
                      scale={0.9}
                    />
                    <Button variant="outline" className="relative">
                      <Plus />
                      Create New Version
                    </Button>
                  </div>
                </DialogTrigger>
              </div>
            </header>
            <div className="relative w-full flex-1 overflow-hidden flex flex-col">
              {sortedVersions.length > 0 && (
                <>
                  <div className="flex items-center justify-center border-b-1 border-gray-200 p-2">
                    {/* Tab Headers */}
                    {/* Only display the tabs list when there are more than 1 */}
                    {sortedVersions.length > 1 ? (
                      <>
                        <TabsList className="border-b border-gray-200">
                          {sortedVersions.map((version) => (
                            <TabsTrigger
                              value={version.id}
                              key={version.id}
                              // className="data-[state=active]:bg-blue-500 data-[state=active]:text-white"
                            >
                              {version.version_name}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </>
                    ) : (
                      <div></div>
                    )}
                  </div>
                </>
              )}

              {/* Version Tabs */}
              {sortedVersions.length > 0 && (
                <>
                  {sortedVersions.map((v) => (
                    // <div className="p-6" key={v.id}>
                    <TabsContent
                      value={v.id}
                      key={v.id}
                      className="flex-1 overflow-hidden flex flex-col"
                    >
                      <DocumentVersionContent
                        document={document}
                        documentVersion={v}
                        audioVersions={audioVersions}
                        audioPlayer={
                          activeVersionId === v.id ? audioPlayer : null
                        }
                      />
                    </TabsContent>
                    // </div>
                  ))}
                  {<TabsContent value={""}></TabsContent>}
                </>
              )}

              {/* No versions state */}
              {sortedVersions.length === 0 && (
                <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
                  <p className="text-gray-500">
                    No versions available for this document.
                  </p>
                </div>
              )}
            </div>

            <CreateVersionDialog
              document={document}
              handleGenerateVersion={handleGenerateVersion}
              onClose={handleCloseCreateVersionModal}
            />
          </>
        </Tabs>
      </Dialog>

      {/* Footer - Audio Player Controls */}
      <div className="border-t border-gray-200 bg-white">
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
