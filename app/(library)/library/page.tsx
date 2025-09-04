"use client";

import { useRouter, useSearchParams } from "next/navigation";
import React, { useMemo, useState, useTransition, Suspense, useEffect } from "react";
import { NoDocuments } from "@/app/features/documents/components/no-documents";
import { LibraryLoader } from "@/app/features/documents/components/library-loader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useGroupedDocuments,
  formatDocumentType,
  getDocumentCount,
  useDocumentsActions,
} from "@/app/features/documents/context";
import { Badge } from "@/components/ui/badge";
import { DocumentCard } from "@/app/features/documents/components/document-card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
} from "@/components/ui/breadcrumb";

// Separate component that uses useSearchParams
function LibraryContent() {
  const { groupedDocuments, loading } = useGroupedDocuments();
  const { refreshDocuments } = useDocumentsActions();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Add state for tracking the active tab locally
  const [localActiveTab, setLocalActiveTab] = useState<string>("");
  const [, startTransition] = useTransition();

  // Load documents when component mounts
  useEffect(() => {
    refreshDocuments();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Get category filter from URL
  const categoryFilter = searchParams.get("category");

  // Create tab data from grouped documents
  const availableCategories = useMemo(() => {
    return Object.keys(groupedDocuments).filter(
      (category) => groupedDocuments[category].length > 0
    );
  }, [groupedDocuments]);

  // Current active tab (use 'all' when no filter is applied)
  const urlActiveTab = categoryFilter || "all";
  const activeTab = localActiveTab || urlActiveTab;

  // Handle tab change with instant UI update
  const handleTabChange = (value: string) => {
    // Update local state immediately for instant UI feedback
    setLocalActiveTab(value);

    // Update URL in a transition to avoid blocking the UI
    startTransition(() => {
      if (value === "all") {
        router.push("/library");
      } else {
        router.push(`/library?category=${value}`);
      }
      // Reset local state once URL is updated
      setLocalActiveTab("");
    });
  };

  // Get documents for current tab
  const currentDocuments = useMemo(() => {
    if (activeTab === "all") {
      return groupedDocuments;
    }

    if (groupedDocuments[activeTab]) {
      return { [activeTab]: groupedDocuments[activeTab] };
    }

    return {};
  }, [groupedDocuments, activeTab]);

  // Handle document selection - preserve category filter in URL
  const handleDocumentClick = (docId: string) => {
    if (activeTab !== "all") {
      router.push(`/library/${docId}?category=${activeTab}`);
    } else {
      router.push(`/library/${docId}`);
    }
  };

  // Show loading state
  if (loading) {
    return <LibraryLoader />;
  }

  // Check if we have any documents
  const hasDocuments = Object.keys(groupedDocuments).length > 0;

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <header className="flex items-center gap-2 border-b">
        <div className="flex w-full items-center gap-3 px-6 py-4">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>Library</BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <Separator
            orientation="vertical"
            className="mx-2 data-[orientation=vertical]:h-4"
          />
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            {availableCategories.map((category) => (
              <TabsTrigger key={category} value={category}>
                {formatDocumentType(category)}{" "}
                <Badge
                  variant="secondary"
                  className="rounded-full bg-gray-300 text-xs"
                >
                  {groupedDocuments[category].length}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </header>
      <div className="w-full flex justify-center p-16 pt-8">
        <div className="max-w-7xl w-full space-y-6">
          {hasDocuments && (
            <>
              {/* All Documents Tab */}
              <TabsContent value="all" className="space-y-8">
                {Object.entries(currentDocuments).map(
                  ([documentType, docs]) => (
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
                          <DocumentCard
                            key={doc.id}
                            doc={doc}
                            onClick={() => handleDocumentClick(doc.id)}
                          />
                        ))}
                      </div>
                    </section>
                  )
                )}
              </TabsContent>

              {availableCategories.map((category) => (
                <TabsContent
                  key={category}
                  value={category}
                  className="space-y-6"
                >
                  <div className="flex flex-wrap gap-4">
                    {(currentDocuments[category] || []).map((doc) => (
                      <DocumentCard
                        key={doc.id}
                        doc={doc}
                        onClick={() => handleDocumentClick(doc.id)}
                      />
                    ))}
                  </div>
                </TabsContent>
              ))}
            </>
          )}

          {/* Empty state - show when no documents at all */}
          {!loading && !hasDocuments && <NoDocuments />}
        </div>
      </div>
    </Tabs>
  );
}

// Main Library Page Component with Suspense wrapper
export default function LibraryPage() {
  return (
    <Suspense fallback={<LibraryLoader />}>
      <LibraryContent />
    </Suspense>
  );
}
