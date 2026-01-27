"use client";

import {
  useProcessingVersions,
  ProcessingVersion,
} from "../context/processing-context";
import {
  Loader2,
  CheckCircle,
  AlertCircle,
  X,
  FileText,
  ExternalLink,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

export function ProcessingToast() {
  const { processingVersions, removeProcessingVersion } =
    useProcessingVersions();

  if (processingVersions.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {processingVersions.map((version) => (
        <ProcessingItem
          key={version.versionId}
          version={version}
          onDismiss={() => removeProcessingVersion(version.versionId)}
        />
      ))}
    </div>
  );
}

interface ProcessingItemProps {
  version: ProcessingVersion;
  onDismiss: () => void;
}

function ProcessingItem({ version, onDismiss }: ProcessingItemProps) {
  const router = useRouter();
  const isCompleted = version.status === "completed";
  const isFailed = version.status === "failed";
  const isProcessing =
    version.status === "processing" || version.status === "pending";

  // Only show progress bar for Natural mode
  const showProgressBar = version.processingType === "Natural" && isProcessing;

  const handleOpen = () => {
    router.push(`/library/${version.documentId}?version=${version.versionId}`);
    onDismiss();
  };

  return (
    <div className="bg-white rounded-lg shadow-lg border p-3 flex gap-3 items-stretch animate-in slide-in-from-right-5 duration-300">
      {/* Thumbnail or placeholder */}
      <div className="flex-shrink-0 w-14 rounded bg-gray-100 overflow-hidden">
        {version.documentThumbnail ? (
          <div
            className="w-full h-full bg-cover bg-top"
            style={{ backgroundImage: `url("${version.documentThumbnail}")` }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FileText className="w-5 h-5 text-gray-400" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {version.documentTitle}
            </p>
            <p className="text-xs text-gray-500 truncate">
              {version.versionName}
            </p>
          </div>

          {/* Dismiss button */}
          <button
            onClick={onDismiss}
            className="flex-shrink-0 p-0.5 hover:bg-gray-100 rounded"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Progress bar for Natural mode */}
        {showProgressBar && (
          <div className="mt-2">
            <Progress value={version.progress} className="h-1" />
          </div>
        )}

        {/* Status */}
        <div className="flex items-center gap-2 mt-0">
          {isProcessing && (
            <>
              <Loader2 className="w-3 h-3 animate-spin text-brand-primary" />
              <p className="text-xs text-gray-500">{getStatusText(version)}</p>
            </>
          )}
          {isCompleted && (
            <>
              <CheckCircle className="w-3.5 h-3.5 text-green-600" />
              <span className="text-xs text-gray-600">Ready</span>
            </>
          )}
          {isFailed && (
            <p className="text-xs text-red-600 whitespace-pre-line">
              {version.errorMessage || "Something went wrong. Please try again."}
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            className={cn("ml-auto h-7 text-xs", !isCompleted && "invisible")}
            onClick={handleOpen}
          >
            Open
            <ExternalLink className="w-3 h-3 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function getStatusText(version: ProcessingVersion): string {
  if (version.status === "pending") {
    return "Starting...";
  }

  switch (version.processingType) {
    case "Natural":
      return `Processing... ${version.progress}%`;
    case "Lecture":
      return "Generating lecture...";
    case "Conversational":
      return "Generating dialogue...";
    case "Original":
      return "Creating version...";
    default:
      return "Processing...";
  }
}
