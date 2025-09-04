"use client";

import { Card } from "@/components/ui/card";
import { useDocumentsState } from "../../../features/documents/context";
import { useMemo, useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { DocumentWithVersions } from "@/app/features/documents/types";
import {
  useAudioState,
  useAudioActions,
  AudioProvider,
} from "@/app/features/audio/context";
import React, { use } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { CreateVersionDialog } from "@/app/features/documents/components/create-version-dialog";
import { DocumentVersionLoader } from "@/app/features/documents/components/document-version-loader";
import { DocumentVersionContent } from "@/app/features/documents/components/document-version-content2";
import { generateWithAi } from "@/app/features/generate-with-ai";
import Link from "next/link";
import { DocumentCard } from "@/app/features/documents/components/document-card";
import { Separator } from "@/components/ui/separator";
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
function DocumentDetailView({ document }: { document: DocumentWithVersions }) {
  // const [activeTab, setActiveTab] = useState(0);
  const [localActiveTab, setLocalActiveTab] = useState<string>("");
  const [, startTransition] = useTransition();

  const [isCreateVersionModalOpen, setCreateVersionModalOpen] = useState(false);

  const { audioVersions } = useAudioState();
  const { loadAudioVersions, loadAudioSegments } = useAudioActions();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Sort versions by creation date (newest first)
  const sortedVersions = useMemo(() => {
    return [...document.versions].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [document.versions]);

  // Get the active version ID from URL or default to first version
  const activeVersionId = useMemo(() => {
    const versionFromUrl = searchParams.get("version");
    if (versionFromUrl && sortedVersions.find((v) => v.id === versionFromUrl)) {
      return versionFromUrl;
    }
    return sortedVersions[0]?.id || "";
  }, [searchParams, sortedVersions]);

  // Load audio data for all document versions when component mounts
  useEffect(() => {
    const loadAudioForDocument = async () => {
      // Load audio versions for each document version
      // These will be added to the existing audioVersions array (not replaced)
      for (const version of document.versions) {
        await loadAudioVersions(version.id);
      }
    };

    loadAudioForDocument();
  }, [document.versions]);

  // Load segments when audio versions are available or when active version changes
  useEffect(() => {
    async function loadSegmentsForActiveVersion() {
      // Find the active version
      const activeVersion = sortedVersions.find(
        (v) => v.id === activeVersionId
      );

      if (!activeVersion) return;

      // Find audio versions for the active document version
      const activeAudioVersions = audioVersions.filter(
        (av) => av.document_version_id === activeVersion.id
      );

      // Load segments for each audio version of the active document version
      for (const audioVersion of activeAudioVersions) {
        await loadAudioSegments(audioVersion.id);
      }
    }

    if (activeVersionId && audioVersions.length > 0) {
      // console.log("loading segments for: ");
      // console.log(activeVersionId);
      loadSegmentsForActiveVersion();
    }
  }, [activeVersionId, audioVersions.length, sortedVersions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update activeTab index when activeVersionId changes
  // useEffect(() => {
  //   const index = sortedVersions.findIndex((v) => v.id === activeVersionId);
  //   if (index !== -1) {
  //     setActiveTab(index);
  //   }
  // }, [activeVersionId, sortedVersions]);

  // Auto-update URL with version parameter if not present
  useEffect(() => {
    const versionFromUrl = searchParams.get("version");
    const firstVersionId = sortedVersions[0]?.id;

    // If no version in URL but we have versions, add the first version to URL
    if (!versionFromUrl && firstVersionId && sortedVersions.length > 0) {
      updateVersionInUrl(firstVersionId);
    }
  }, [searchParams, sortedVersions]);

  // Function to update URL with version parameter
  const updateVersionInUrl = (versionId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("version", versionId);
    router.push(`/library/${document.id}?${params.toString()}`);
  };

  function handleGenerateVersion(
    processingLevel: 0 | 1 | 2 | 3,
    voiceArray: string[],
    language: string
  ) {
    if (document.raw_text)
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
    <div className="h-full">
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
          className="relative gap-0 h-full flex flex-col"
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
                        <BreadcrumbPage className="truncate max-w-48">
                          {document.title}
                        </BreadcrumbPage>
                      </BreadcrumbItem>
                      {sortedVersions.length === 1 && (
                        <>
                          <BreadcrumbSeparator />
                          <BreadcrumbItem>
                            <BreadcrumbPage className="truncate max-w-48">
                              {sortedVersions[0].version_name}
                            </BreadcrumbPage>
                          </BreadcrumbItem>
                        </>
                      )}
                    </BreadcrumbList>
                  </Breadcrumb>

                  {sortedVersions.length > 0 && (
                    <>
                      <div className="flex items-center justify-between">
                        {/* Tab Headers */}
                        {/* Only display the tabs list when there are more than 1 */}
                        {sortedVersions.length > 1 ? (
                          <>
                            <Separator
                              orientation="vertical"
                              className="mx-2 data-[orientation=vertical]:h-4"
                            />
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
            <div className="relative w-full flex-1 min-h-0">
              {/* Version Tabs */}
              {sortedVersions.length > 0 && (
                <>
                  {sortedVersions.map((v) => (
                    // <div className="p-6" key={v.id}>
                    <TabsContent
                      value={v.id}
                      key={v.id}
                      className="h-full min-h-0"
                    >
                      <DocumentVersionContent
                        document={document}
                        documentVersion={v}
                        audioVersions={audioVersions}
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
    </div>
  );
}

// Main Document Detail Page Component
export default function DocumentDetailPage({
  params,
}: {
  params: Promise<{ document_id: string }>;
}) {
  const { documents, loading } = useDocumentsState();
  const router = useRouter();

  // Unwrap the params Promise
  const resolvedParams = use(params);

  // Find the document by ID
  const document = useMemo(() => {
    return documents.find((doc) => doc.id === resolvedParams.document_id);
  }, [documents, resolvedParams.document_id]);

  // Show loading state
  if (loading) {
    return <DocumentVersionLoader />;
  }

  // Handle document not found
  if (!loading && !document) {
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

  return (
    <AudioProvider autoLoad={false}>
      <DocumentDetailView document={document!} />
    </AudioProvider>
  );
}
