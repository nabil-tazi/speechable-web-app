"use client";

import { useRef, useState, useEffect, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocumentWithVersions } from "../types";
import { DocumentCard } from "./document-card";

interface HorizontalDocumentScrollProps {
  title?: string;
  icon?: ReactNode;
  documents: DocumentWithVersions[];
  emptyMessage?: string;
}

export function HorizontalDocumentScroll({
  title,
  icon,
  documents,
  emptyMessage = "No documents",
}: HorizontalDocumentScrollProps) {
  const router = useRouter();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  const checkScrollPosition = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;
    setShowLeftArrow(scrollLeft > 0);
    setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 1);
  };

  useEffect(() => {
    checkScrollPosition();
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener("scroll", checkScrollPosition);
      window.addEventListener("resize", checkScrollPosition);
    }
    return () => {
      if (container) {
        container.removeEventListener("scroll", checkScrollPosition);
      }
      window.removeEventListener("resize", checkScrollPosition);
    };
  }, [documents]);

  const scroll = (direction: "left" | "right") => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const scrollAmount = 300;
    container.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  if (documents.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      {title && (
        <h2 className="text-lg font-semibold text-gray-900">
          {icon && <span className="text-gray-500 mr-2">{icon}</span>}
          {title}
        </h2>
      )}

      <div className="relative">
        {/* Left Arrow */}
        {showLeftArrow && (
          <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center">
            <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-sidebar to-transparent pointer-events-none" />
            <Button
              variant="ghost"
              size="icon"
              className="relative h-8 w-8 rounded-full bg-white shadow-md hover:bg-gray-50 border border-gray-200"
              onClick={() => scroll("left")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Scroll Container */}
        <div
          ref={scrollContainerRef}
          className="flex gap-4 overflow-x-auto scrollbar-hide pb-2"
        >
          {documents.map((doc) => (
            <div key={doc.id} className="flex-shrink-0">
              <DocumentCard
                doc={doc}
                onClick={() => router.push(`/library/${doc.id}`)}
              />
            </div>
          ))}
        </div>

        {/* Right Arrow */}
        {showRightArrow && (
          <div className="absolute right-0 top-0 bottom-0 z-10 flex items-center">
            <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-sidebar to-transparent pointer-events-none" />
            <Button
              variant="ghost"
              size="icon"
              className="relative h-8 w-8 rounded-full bg-white shadow-md hover:bg-gray-50 border border-gray-200"
              onClick={() => scroll("right")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
