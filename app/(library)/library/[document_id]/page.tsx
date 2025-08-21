"use client";

import { Card } from "@/components/ui/card";
import { useDocumentsState } from "../../../features/documents/context";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DocumentWithVersions } from "@/app/features/documents/types";
import { useAudioState } from "@/app/features/audio/context";
import React, { use } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { CreateVersionDialog } from "@/app/features/documents/components/create-version-dialog";
import { DocumentVersionLoader } from "@/app/features/documents/components/document-version-loader";
import { DocumentVersionContent } from "@/app/features/documents/components/document-version-content2";

// Thumbnail Image Component
function ThumbnailImage({
  thumbnailPath,
  filename,
  className = "max-h-full max-w-full object-contain",
}: {
  thumbnailPath: string | null;
  filename: string;
  className?: string;
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>();
  const [imageError, setImageError] = useState(false);

  if (!thumbnailPath || imageError || !thumbnailUrl) {
    return (
      <svg
        className="w-8 h-8 text-gray-400"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path d="M4 3a2 2 0 00-2 2v1.586l.293-.293a1 1 0 011.414 0L8 10.586l2.293-2.293a1 1 0 011.414 0L14 10.586V5a2 2 0 00-2-2H4zM2 13.414l2.293-2.293a1 1 0 011.414 0L8 13.414l2.293-2.293a1 1 0 011.414 0L14 13.414V17a2 2 0 01-2 2H4a2 2 0 01-2-2v-3.586z" />
      </svg>
    );
  }

  return (
    <img
      src={thumbnailUrl}
      alt={filename}
      className={className}
      onError={() => setImageError(true)}
    />
  );
}

// Document Detail View Component
function DocumentDetailView({ document }: { document: DocumentWithVersions }) {
  const [activeTab, setActiveTab] = useState(0);
  const [isCreateVersionModalOpen, setCreateVersionModalOpen] = useState(false);

  const { audioVersions } = useAudioState();
  const router = useRouter();

  // Sort versions by creation date (newest first)
  const sortedVersions = useMemo(() => {
    return [...document.versions].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [document.versions]);

  function handleGenerateVersion() {}

  function handleCloseCreateVersionModal() {
    setCreateVersionModalOpen(false);
  }

  return (
    <Dialog
      open={isCreateVersionModalOpen}
      onOpenChange={setCreateVersionModalOpen}
    >
      <div className="w-full flex justify-center p-4">
        <div className="max-w-7xl w-full space-y-6">
          {/* Header with back button */}
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.push("/library")}
              className="flex items-center space-x-2 text-gray-600 hover:text-gray-900"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              <span>Back to Library</span>
            </button>
          </div>

          {/* Document Header */}
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <div className="flex items-start space-x-4">
              <div className="w-16 h-20 flex items-center justify-center border rounded">
                {document.thumbnail_path ? (
                  <>
                    <ThumbnailImage
                      thumbnailPath={document.thumbnail_path}
                      filename={document.filename}
                    />
                  </>
                ) : (
                  <svg
                    className="w-8 h-8 text-gray-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M4 3a2 2 0 00-2 2v1.586l.293-.293a1 1 0 011.414 0L8 10.586l2.293-2.293a1 1 0 011.414 0L14 10.586V5a2 2 0 00-2-2H4zM2 13.414l2.293-2.293a1 1 0 011.414 0L8 13.414l2.293-2.293a1 1 0 011.414 0L14 13.414V17a2 2 0 01-2 2H4a2 2 0 01-2-2v-3.586z" />
                  </svg>
                )}
              </div>

              <div className="flex-1">
                <h1 className="text-2xl font-bold text-gray-900 mb-2">
                  {document.filename}
                </h1>
                <div className="flex items-center space-x-4 text-sm text-gray-600">
                  <span className="capitalize">
                    {document.document_type?.replace("_", " ") || "Unknown"}
                  </span>
                  {document.file_size && (
                    <span>
                      {(document.file_size / (1024 * 1024)).toFixed(1)} MB
                    </span>
                  )}
                  {document.page_count && (
                    <span>
                      {document.page_count} page
                      {document.page_count > 1 ? "s" : ""}
                    </span>
                  )}
                  <span>
                    Uploaded{" "}
                    {new Date(document.upload_date).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Version Tabs */}
          {sortedVersions.length > 0 && (
            <Tabs defaultValue={sortedVersions[0].id}>
              <div className="flex items-center justify-between">
                {/* Tab Headers */}
                {/* Only display the tabs list when there are more than 1 */}
                {sortedVersions.length > 1 ? (
                  <TabsList className="border-b border-gray-200">
                    {sortedVersions.map((version, index) => (
                      <TabsTrigger
                        value={version.id}
                        key={version.id}
                        onClick={() => setActiveTab(index)}
                      >
                        Version {sortedVersions.length - index}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                ) : (
                  <div></div>
                )}
                <DialogTrigger asChild>
                  <Button>
                    <Plus />
                    Create New Version
                  </Button>
                </DialogTrigger>
              </div>
              <div className="bg-white rounded-lg shadow-sm border">
                {sortedVersions.map((v) => (
                  <TabsContent className="p-6" value={v.id} key={v.id}>
                    <DocumentVersionContent
                      documentVersion={sortedVersions[activeTab]}
                      audioVersions={audioVersions}
                    />
                  </TabsContent>
                ))}
                {<TabsContent value={""}></TabsContent>}
              </div>
            </Tabs>
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
      </div>

      <CreateVersionDialog
        document={document}
        handleGenerateVersion={handleGenerateVersion}
        onClose={handleCloseCreateVersionModal}
      />
    </Dialog>
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

  return <DocumentDetailView document={document!} />;
}
