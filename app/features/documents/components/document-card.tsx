import { useState, useRef } from "react";
import type { DocumentWithVersions } from "@/app/features/documents/types";
import { useDocumentsActions } from "../context";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Bookmark, MoreVertical, Trash2, FileText, Globe, Type, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useSidebarData } from "@/app/features/sidebar/context";
interface DocumentCardProps {
  doc: DocumentWithVersions;
  onClick?: () => void;
  priority?: boolean; // For LCP optimization - set true for above-the-fold images
}

const SOURCE_LABELS: Record<string, { label: string; icon: typeof FileText }> = {
  pdf: { label: "PDF Upload", icon: FileText },
  url: { label: "Web Page", icon: Globe },
  text: { label: "Text Input", icon: Type },
  images: { label: "Image OCR", icon: Images },
};

function getSourceInfo(fileType: string) {
  return SOURCE_LABELS[fileType] || { label: fileType, icon: FileText };
}

function getRelativeTime(dateString: string): string {
  const now = new Date();
  const updatedDate = new Date(dateString);
  const diffInMs = updatedDate.getTime() - now.getTime();
  const diffInDays = Math.round(diffInMs / (1000 * 60 * 60 * 24));
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  // Choose appropriate unit based on time difference
  if (Math.abs(diffInDays) < 1) {
    const diffInHours = Math.round(diffInMs / (1000 * 60 * 60));
    if (Math.abs(diffInHours) < 1) {
      const diffInMinutes = Math.round(diffInMs / (1000 * 60));
      return formatter.format(diffInMinutes, "minute");
    }
    return formatter.format(diffInHours, "hour");
  } else if (Math.abs(diffInDays) < 30) {
    return formatter.format(diffInDays, "day");
  } else if (Math.abs(diffInDays) < 365) {
    const diffInMonths = Math.round(diffInDays / 30);
    return formatter.format(diffInMonths, "month");
  } else {
    const diffInYears = Math.round(diffInDays / 365);
    return formatter.format(diffInYears, "year");
  }
}

export function DocumentCard({
  doc,
  onClick,
  priority = false,
}: DocumentCardProps) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editValues, setEditValues] = useState({
    title: doc.title || "",
    author: doc.author || "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Track when dialog just closed to prevent click-through to card
  const justClosedDialogRef = useRef(false);

  const { updateDocument, deleteDocument } = useDocumentsActions();
  const { starredDocuments, refreshStarred } = useSidebarData();
  const isStarred = starredDocuments.some((s) => s.id === doc.id);

  const handleToggleStar = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const { toggleDocumentStarredAction } = await import("../actions");
    await toggleDocumentStarredAction(doc.id);
    await refreshStarred();
  };

  const handleCancel = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditValues({
      title: doc.title || "",
      author: doc.author || "",
    });
    setIsEditOpen(false);
  };

  const handleSave = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsSaving(true);
    try {
      const updates: any = {};

      // Only include changed values
      if (editValues.title !== (doc.title || "")) {
        updates.title = editValues.title;
      }
      if (editValues.author !== (doc.author || "")) {
        updates.author = editValues.author;
      }

      if (Object.keys(updates).length > 0) {
        const result = await updateDocument(doc.id, updates);
        if (result.success) {
          setIsEditOpen(false);
        } else {
          console.error("Failed to update document:", result.error);
        }
      } else {
        setIsEditOpen(false);
      }
    } catch (error) {
      console.error("Failed to update document:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const result = await deleteDocument(doc.id);
      if (!result.success) {
        console.error("Failed to delete document:", result.error);
      }
      setIsDeleteDialogOpen(false);
    } catch (error) {
      console.error("Failed to delete document:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCardClick = () => {
    if (justClosedDialogRef.current) {
      justClosedDialogRef.current = false;
      return;
    }
    onClick?.();
  };

  return (
    <div
      className={`flex flex-col gap-3 group ${onClick && "cursor-pointer"}`}
      onClick={handleCardClick}
    >
      <Card className="relative w-50 h-32 p-0 overflow-hidden bg-gray-200 group-hover:bg-gray-200 border-none">
        <button
          onClick={handleToggleStar}
          className={`absolute top-2 left-2 z-10 size-8 sm:size-6 flex items-center justify-center rounded transition-all ${
            isStarred
              ? "opacity-100 bg-transparent sm:group-hover:bg-white sm:group-hover:border sm:group-hover:border-gray-200"
              : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 bg-white border border-gray-200 sm:hover:bg-gray-50"
          }`}
        >
          <Bookmark
            className={`w-4 h-4 sm:w-3.5 sm:h-3.5 text-gray-600 ${
              isStarred ? "fill-current" : ""
            }`}
          />
        </button>
        {/* <Badge
          variant="outline"
          className="absolute text-xs bg-white top-2 left-2 z-1"
        >
          <GalleryHorizontalEnd className="w-3 h-3 mr-1" />
          {doc.versions.length} version
          {doc.versions.length > 1 ? "s" : ""}
        </Badge> */}
        <div className="flex h-full pt-8 group-hover:pt-6 transition-all duration-200">
          {doc?.thumbnail_path && (
            <div
              className="w-32 h-full rounded-tl-sm rounded-tr-sm shadow-[0px_2px_4px_0px_rgba(0,0,0,0.08)] bg-cover bg-no-repeat opacity-70 mx-auto group-hover:scale-115 transition-transform duration-200"
              style={{
                backgroundImage: `url("${doc.thumbnail_path}")`,
              }}
            />
          )}
        </div>

        {/* Hover Actions - Details Button (always visible on mobile) */}
        <div className="absolute top-2 right-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsEditOpen(true);
            }}
            className="size-8 sm:size-6 flex items-center justify-center rounded bg-white hover:bg-gray-50 border border-gray-200"
          >
            <MoreVertical className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-gray-600" />
          </button>
        </div>

        {/* Details Dialog */}
        <Dialog open={isEditOpen} onOpenChange={(open) => {
          if (!open) justClosedDialogRef.current = true;
          setIsEditOpen(open);
        }}>
          <DialogContent className="sm:max-w-xl" onClick={(e) => e.stopPropagation()} onPointerDownOutside={(e) => e.stopPropagation()}>
            <DialogHeader>
              <DialogTitle>Details</DialogTitle>
            </DialogHeader>
            <div className="grid gap-5 py-2">
              {/* Top section: Thumbnail + Metadata (stacked on mobile, side-by-side on desktop) */}
              <div className="flex flex-col sm:flex-row gap-4 sm:gap-5 min-w-0">
                {/* Thumbnail */}
                {doc.thumbnail_path && (
                  <div
                    className="w-24 h-32 sm:w-32 sm:h-44 rounded-md shadow-sm bg-cover bg-center bg-no-repeat border flex-shrink-0 mx-auto sm:mx-0"
                    style={{
                      backgroundImage: `url("${doc.thumbnail_path}")`,
                    }}
                  />
                )}

                {/* Read-only metadata */}
                <div className="flex-1 min-w-0 space-y-2 text-sm text-center sm:text-left">
                  {/* Source */}
                  <div className="flex items-center justify-center sm:justify-start gap-2">
                    {(() => {
                      const sourceInfo = getSourceInfo(doc.file_type);
                      const SourceIcon = sourceInfo.icon;
                      return (
                        <>
                          <SourceIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <span className="text-gray-600">{sourceInfo.label}</span>
                        </>
                      );
                    })()}
                  </div>

                  {/* Filename */}
                  <div
                    className="text-gray-500 line-clamp-2"
                    title={doc.filename}
                  >
                    {doc.filename}
                  </div>

                  {/* Pages - not shown for URL imports */}
                  {doc.page_count && doc.file_type !== "url" && (
                    <div className="text-gray-500">
                      {doc.page_count} {doc.page_count === 1 ? "page" : "pages"}
                    </div>
                  )}
                </div>
              </div>

              {/* Editable fields */}
              <div className="space-y-3 pt-2 border-t">
                {/* Title */}
                <div className="flex flex-col sm:grid sm:grid-cols-4 sm:items-center gap-1.5 sm:gap-4">
                  <Label htmlFor="title" className="text-sm">
                    Title
                  </Label>
                  <Input
                    id="title"
                    value={editValues.title}
                    onChange={(e) =>
                      setEditValues((prev) => ({
                        ...prev,
                        title: e.target.value,
                      }))
                    }
                    className="sm:col-span-3"
                    placeholder="Enter title"
                  />
                </div>

                {/* Author */}
                <div className="flex flex-col sm:grid sm:grid-cols-4 sm:items-center gap-1.5 sm:gap-4">
                  <Label htmlFor="author" className="text-sm">
                    Author
                  </Label>
                  <Input
                    id="author"
                    value={editValues.author}
                    onChange={(e) =>
                      setEditValues((prev) => ({
                        ...prev,
                        author: e.target.value,
                      }))
                    }
                    className="sm:col-span-3"
                    placeholder="Enter author"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2">
                {/* Delete - left side */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsDeleteDialogOpen(true);
                  }}
                  className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-600"
                  type="button"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>

                {/* Cancel/Save - right side */}
                <div className="flex gap-2">
                  <Button
                    onClick={handleCancel}
                    variant="outline"
                    type="button"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={isSaving}
                    type="button"
                  >
                    {isSaving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={(open) => {
          if (!open) justClosedDialogRef.current = true;
          setIsDeleteDialogOpen(open);
        }}>
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete document?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete &quot;{doc.title || doc.filename}&quot; and all its versions and audio. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={isDeleting}
                className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Card>
      <div className="flex flex-col gap-0 px-2">
        <h3
          className="text-sm text-gray-900 font-medium leading-tight truncate max-w-45"
          title={doc.filename}
        >
          {doc.title || doc.filename}
        </h3>
        <div className="flex items-center gap-1">
          <div className="text-xs text-gray-500">
            {getRelativeTime(doc.updated_at)}
          </div>
        </div>
      </div>
    </div>
  );
}
