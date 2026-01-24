"use client";

import React, { useMemo, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";
import Image from "next/image";
import { NoDocuments } from "@/app/features/documents/components/no-documents";
import { LibraryLoader } from "@/app/features/documents/components/library-loader";
import {
  DocumentsProvider,
  useDocuments,
} from "@/app/features/documents/context";
import { DocumentCard } from "@/app/features/documents/components/document-card";
import { HorizontalDocumentScroll } from "@/app/features/documents/components/horizontal-document-scroll";
import { NewDocumentModal } from "@/app/features/documents/components/new-document-modal";
import { useSidebarData } from "@/app/features/sidebar/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HeaderUserMenu } from "@/components/header-user-menu";
import CreditDisplay from "@/app/features/credits/components/credit-display";
import { APP_VERSION } from "@/lib/version";

function LibraryContent() {
  const router = useRouter();
  const { documents, loading } = useDocuments();
  const { starredDocuments } = useSidebarData();
  const [searchQuery, setSearchQuery] = useState("");
  const [newDocModalOpen, setNewDocModalOpen] = useState(false);

  // Handle new document button click - always open modal
  // (debug mode PDF comparison is handled inside the modal)
  const handleNewDocument = () => {
    setNewDocModalOpen(true);
  };

  // Filter documents by search query
  const filteredDocuments = useMemo(() => {
    if (!searchQuery.trim()) return documents;
    const query = searchQuery.toLowerCase();
    return documents.filter(
      (doc) =>
        doc.title?.toLowerCase().includes(query) ||
        doc.filename.toLowerCase().includes(query)
    );
  }, [documents, searchQuery]);

  // Get full document objects for starred documents
  const starredDocs = useMemo(() => {
    return starredDocuments
      .map((s) => documents.find((d) => d.id === s.id))
      .filter((doc): doc is NonNullable<typeof doc> => doc !== undefined);
  }, [starredDocuments, documents]);

  // Sort all documents by updated_at (newest first)
  const sortedDocuments = useMemo(() => {
    return [...filteredDocuments].sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }, [filteredDocuments]);

  // Show loading state
  if (loading) {
    return <LibraryLoader />;
  }

  // Check if we have any documents
  const hasDocuments = documents.length > 0;

  return (
    <div className="bg-sidebar min-h-screen flex flex-col">
      {/* Header - sticky at top */}
      <div className="sticky top-0 z-20">
        <div className="px-4 h-12 flex items-center bg-sidebar">
          {/* Left section - Logo */}
          <div className="flex items-center gap-1 flex-1">
            <Image src="/logo.svg" alt="Speechable" width={32} height={32} />
            <span className="text-lg text-gray-900 font-semibold">
              Speechable
            </span>
          </div>

          {/* Center section - Search + New button (only when documents exist) */}
          {hasDocuments && (
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search library..."
                  className="pl-9 pr-9 h-8 bg-white border-gray-200 text-sm"
                />
                {searchQuery && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded"
                    onClick={() => setSearchQuery("")}
                  >
                    <X className="h-3 w-3 text-gray-400" />
                  </button>
                )}
              </div>
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-brand-primary-dark hover:bg-brand-primary-dark/90"
                onClick={handleNewDocument}
              >
                <Plus className="h-4 w-4" />
                New
              </Button>
            </div>
          )}

          {/* Right section - Credits + User menu */}
          <div className="flex items-center gap-3 flex-1 justify-end">
            <CreditDisplay />
            <HeaderUserMenu />
          </div>
        </div>
        {/* Gradient fade */}
        <div className="h-4 bg-gradient-to-b from-sidebar to-transparent" />
      </div>

      {/* Content */}
      <div className="w-full flex justify-center p-8 pt-6 flex-1">
        <div className="max-w-5xl w-full space-y-8">
          {/* Favorites Section */}
          {starredDocs.length > 0 && (
            <>
              <HorizontalDocumentScroll documents={starredDocs} />
              <hr className="border-gray-200" />
            </>
          )}

          {/* All Documents Grid */}
          {hasDocuments ? (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">
                All Documents{" "}
                <span className="text-gray-500 font-normal">
                  ({sortedDocuments.length})
                </span>
              </h2>

              {sortedDocuments.length > 0 ? (
                <div className="flex flex-wrap gap-8">
                  {sortedDocuments.map((doc, index) => (
                    <DocumentCard
                      key={doc.id}
                      doc={doc}
                      onClick={() => router.push(`/library/${doc.id}`)}
                      priority={index < 6}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <p>No documents match your search.</p>
                </div>
              )}
            </section>
          ) : (
            <NoDocuments onCreateNew={handleNewDocument} />
          )}
        </div>
      </div>

      {/* Version */}
      <div className="text-center pb-6">
        <p className="text-xs text-gray-400">v{APP_VERSION}</p>
      </div>

      {/* New Document Modal */}
      <NewDocumentModal
        open={newDocModalOpen}
        onOpenChange={setNewDocModalOpen}
      />
    </div>
  );
}

// Main Library Page Component with Suspense wrapper
export default function LibraryPage() {
  return (
    <DocumentsProvider>
      <Suspense fallback={<LibraryLoader />}>
        <LibraryContent />
      </Suspense>
    </DocumentsProvider>
  );
}
