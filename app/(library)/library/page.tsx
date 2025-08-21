"use client";

import { Card } from "@/components/ui/card";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Document } from "@/app/features/documents/types";
import React from "react";
import { NoDocuments } from "@/app/features/documents/components/no-documents";
import { LibraryLoader } from "@/app/features/documents/components/library-loader";
import { useDocumentsState } from "@/app/features/documents/context";

// Define valid document types
const validDocumentTypes = [
  "academic_paper",
  "business_report",
  "legal_document",
  "technical_manual",
  "book_chapter",
  "news_article",
];

// Thumbnail Image Component for private storage
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

  // useEffect(() => {
  //   if (!thumbnailPath) return;

  //   const loadThumbnailUrl = async () => {
  //     const url = await getThumbnailUrl(thumbnailPath);
  //     setThumbnailUrl(url);
  //   };

  //   loadThumbnailUrl();
  // }, [thumbnailPath]);

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

// Main Library Page Component
export default function LibraryPage() {
  const { documents, loading } = useDocumentsState();
  const router = useRouter();

  // Group documents by document_type
  const groupedDocuments = useMemo(() => {
    const groups: Record<string, Document[]> = {};

    documents.forEach((doc) => {
      let type = doc.document_type;

      // If document type is not in our valid list, put it in "others"
      if (!type || !validDocumentTypes.includes(type)) {
        type = "others";
      }

      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(doc);
    });

    // Define sort order: valid types first (in order), then "others"
    const sortOrder = [...validDocumentTypes, "others"];

    // Sort groups by the defined order and sort documents within each group by upload date (newest first)
    const sortedGroups: Record<string, Document[]> = {};
    sortOrder.forEach((type) => {
      if (groups[type]) {
        sortedGroups[type] = groups[type].sort(
          (a, b) =>
            new Date(b.upload_date).getTime() -
            new Date(a.upload_date).getTime()
        );
      }
    });

    return sortedGroups;
  }, [documents]);

  // Handle document selection - now navigates to separate page
  const handleDocumentClick = (docId: string) => {
    router.push(`/library/${docId}`);
  };

  // Helper functions
  function truncateFilename(filename: string, maxLength: number = 20) {
    if (filename.length <= maxLength) return filename;

    const extension = filename.split(".").pop();
    const nameWithoutExt = filename.replace(`.${extension}`, "");
    const truncatedName = nameWithoutExt.slice(
      0,
      maxLength - 3 - (extension?.length || 0)
    );

    return `${truncatedName}...${extension ? `.${extension}` : ""}`;
  }

  const formatDocumentType = (type: string) => {
    const typeMap: Record<string, string> = {
      academic_paper: "Academic paper",
      business_report: "Business report",
      legal_document: "Legal document",
      technical_manual: "Technical manual",
      book_chapter: "Book chapter",
      news_article: "News article",
      others: "Other",
    };

    return typeMap[type] || "Other";
  };

  const getDocumentCount = (docs: Document[]) => {
    return docs.length === 1 ? "1 document" : `${docs.length} documents`;
  };

  // Show loading state
  if (loading) {
    return <LibraryLoader />;
  }

  return (
    <div className="w-full flex justify-center p-4">
      <div className="max-w-7xl w-full space-y-8">
        {Object.entries(groupedDocuments).map(([documentType, docs]) => (
          <section key={documentType} className="space-y-4">
            {/* Section Header */}
            <div className="flex items-center justify-between border-b border-gray-200 pb-2">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {formatDocumentType(documentType)}
                  {docs.length > 1 ? "s" : ""}
                </h2>
                <p className="text-sm text-gray-500">
                  {getDocumentCount(docs)}
                </p>
              </div>
            </div>

            {/* Documents Grid */}
            <div className="flex flex-wrap gap-4">
              {docs.map((doc) => (
                <Card
                  key={doc.id}
                  className="w-80 h-32 p-0 relative group overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
                  onClick={() => handleDocumentClick(doc.id)}
                >
                  <div className="flex h-full">
                    {/* Left section - Thumbnail (full height) */}
                    <div className="w-24 h-full flex items-center justify-center border-r">
                      <ThumbnailImage
                        thumbnailPath={doc.thumbnail_path || null}
                        filename={doc.filename}
                      />
                    </div>

                    {/* Right section - File Info (full height) */}
                    <div className="flex-1 p-3 flex flex-col justify-between">
                      <div>
                        <h3
                          className="font-medium text-sm text-gray-900 leading-tight mb-2"
                          title={doc.filename}
                        >
                          {truncateFilename(doc.filename, 20)}
                        </h3>

                        <div className="text-xs text-gray-600 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="uppercase font-medium">
                              {doc.document_type || "Unknown"}
                            </span>
                            {doc.file_size && (
                              <span>
                                {(doc.file_size / (1024 * 1024)).toFixed(1)} MB
                              </span>
                            )}
                          </div>

                          {doc.page_count && (
                            <div>
                              {doc.page_count} page
                              {doc.page_count > 1 ? "s" : ""}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="text-xs text-gray-500">
                        {new Date(doc.upload_date).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  {/* Hover Actions */}
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="p-1 rounded-full bg-white shadow-md hover:bg-gray-50">
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                        />
                      </svg>
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ))}

        {/* Empty state - only show when not loading and no documents */}
        {!loading && documents.length === 0 && <NoDocuments />}
      </div>
    </div>
  );
}
