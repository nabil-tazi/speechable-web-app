import { useState } from "react";
import type {
  DocumentType,
  DocumentWithVersions,
} from "@/app/features/documents/types";
import { useDocumentsActions } from "../context";
import { Card } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { File, GalleryHorizontalEnd, Globe, Pen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  getLanguageName,
  LANGUAGE_MAP,
} from "@/app/api/classify-document/constants";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DOCUMENT_TYPES } from "../constants";
import { useRouter } from "next/navigation";
import Image from "next/image";
interface DocumentCardProps {
  doc: DocumentWithVersions;
  onClick?: () => void;
  priority?: boolean; // For LCP optimization - set true for above-the-fold images
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
  const [isOpen, setIsOpen] = useState(false);
  const [editValues, setEditValues] = useState({
    filename: doc.filename,
    language: doc.language || "",
    document_type: doc.document_type as DocumentType,
  });
  const [isSaving, setIsSaving] = useState(false);

  const { updateDocument } = useDocumentsActions();
  const router = useRouter();

  const handleCancel = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditValues({
      filename: doc.filename,
      language: doc.language || "",
      document_type: doc.document_type as DocumentType,
    });
    setIsOpen(false);
  };

  const handleSave = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsSaving(true);
    try {
      const updates: any = {};

      // Only include changed values
      if (editValues.filename !== doc.filename) {
        updates.filename = editValues.filename;
      }
      if (editValues.language !== (doc.language || "")) {
        updates.language = editValues.language || null;
      }
      if (editValues.document_type !== doc.document_type) {
        updates.document_type = editValues.document_type;
      }

      if (Object.keys(updates).length > 0) {
        const result = await updateDocument(doc.id, updates);
        if (result.success) {
          if (updates.document_type)
            router.push(`/library?category=${updates.document_type}`);
          setIsOpen(false);
        } else {
          console.error("Failed to update document:", result.error);
        }
      } else {
        setIsOpen(false);
      }
    } catch (error) {
      console.error("Failed to update document:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className={`flex flex-col gap-3 group ${onClick && "cursor-pointer"}`}
      onClick={onClick}
    >
      <Card className="relative w-50 h-32 p-0 overflow-hidden bg-gray-50 group-hover:bg-gray-100 border-none">
        {/* <Badge
          variant="outline"
          className="absolute text-xs bg-white top-2 left-2 z-1"
        >
          <GalleryHorizontalEnd className="w-3 h-3 mr-1" />
          {doc.versions.length} version
          {doc.versions.length > 1 ? "s" : ""}
        </Badge> */}
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <div className="flex h-full pt-4">
            {doc?.thumbnail_path && (
              <div
                className="w-32 h-full rounded-tl-sm rounded-tr-sm shadow-[0px_2px_4px_0px_rgba(0,0,0,0.08)] bg-cover bg-no-repeat opacity-70 mx-auto"
                style={{
                  backgroundImage: `url("${doc.thumbnail_path}")`,
                }}
              />
            )}
            {/* Left section - Thumbnail (full height) */}
            {/* <div className="w-24 h-full flex items-center justify-center border-r shrink-0"></div> */}

            {/* Right section - File Info (full height) */}
            {/* <div className="flex-1 p-3 flex flex-col justify-between">
            <div className="min-w-0">
              <h3
                style={{ maxWidth: "180px" }}
                className="font-medium text-sm text-gray-900 leading-tight mb-2 truncate"
                title={doc.filename}
              >
                {doc.filename}
              </h3>

              <div className="text-xs text-gray-600 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    <File className="w-3 h-3 mr-1" />
                    {doc.file_type}
                  </Badge>

                  {doc.page_count && (
                    <div>
                      {doc.page_count} page
                      {doc.page_count > 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {doc.language && (
                <Badge variant="secondary" className="text-xs">
                  <Globe className="w-3 h-3 mr-1" />
                  {getLanguageName(doc.language)}
                </Badge>
              )}
              {doc.versions.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  <GalleryHorizontalEnd className="w-3 h-3 mr-1" />
                  {doc.versions.length} version
                  {doc.versions.length > 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            <div className="text-xs text-gray-500">
              {new Date(doc.updated_at).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "numeric",
              })}
            </div>
          </div> */}
          </div>

          {/* Hover Actions */}
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <PopoverTrigger asChild>
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(true);
                }}
                variant="secondary"
                size="icon"
                className="size-8 bg-white hover:bg-gray-50 border-1 border-gray-200"
              >
                <Pen className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
          </div>

          <PopoverContent
            className="w-80"
            align="end"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(true);
            }}
          >
            <div className="grid gap-4">
              <div className="grid gap-3">
                {/* Filename */}
                <div className="grid grid-cols-3 items-center gap-3">
                  <Label htmlFor="filename" className="text-sm">
                    Filename
                  </Label>
                  <Input
                    id="filename"
                    value={editValues.filename}
                    onChange={(e) =>
                      setEditValues((prev) => ({
                        ...prev,
                        filename: e.target.value,
                      }))
                    }
                    className="col-span-2 h-8"
                    placeholder="Enter filename"
                  />
                </div>

                {/* Document Type */}
                <div className="grid grid-cols-3 items-center gap-3">
                  <Label htmlFor="document-type" className="text-sm">
                    Type
                  </Label>
                  <Select
                    value={editValues.document_type}
                    onValueChange={(value: DocumentType) =>
                      setEditValues((prev) => ({
                        ...prev,
                        document_type: value,
                      }))
                    }
                  >
                    <SelectTrigger className="col-span-2 h-8">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(DOCUMENT_TYPES).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Language */}
                <div className="grid grid-cols-3 items-center gap-3">
                  <Label htmlFor="language" className="text-sm">
                    Language
                  </Label>
                  <Select
                    value={editValues.language || "none"}
                    onValueChange={(value) =>
                      setEditValues((prev) => ({
                        ...prev,
                        language: value === "none" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger className="col-span-2 h-8">
                      <SelectValue placeholder="Select language" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        No language specified
                      </SelectItem>
                      {Array.from(LANGUAGE_MAP.entries())
                        .sort((a, b) => a[1].localeCompare(b[1]))
                        .map(([code, name]) => (
                          <SelectItem key={code} value={code}>
                            {name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleCancel}
                  variant="outline"
                  className="flex-1 h-8"
                  type="button"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex-1 h-8"
                  type="button"
                >
                  {isSaving ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </Card>
      <div className="flex flex-col gap-0 px-2">
        <h3
          className="text-sm text-gray-900 font-medium leading-tight truncate max-w-45"
          title={doc.filename}
        >
          {doc.filename}
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
