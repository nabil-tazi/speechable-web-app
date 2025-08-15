"use client";

import { useDocumentsState } from "../features/documents/context";
import { getThumbnailUrl } from "@/app/utils/storage";

export default function LibraryPage() {
  const { documents } = useDocumentsState();

  console.log(documents);

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
  return (
    <div>
      My Library
      {/* Cards container */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {documents.map((doc) => {
          const bgColorClass = "bg-blue-50 border-blue-200";
          //   const icon = <;

          return (
            <div
              key={doc.id}
              className={`relative group cursor-pointer rounded-lg border-2 p-4 transition-all duration-200 hover:shadow-lg hover:scale-105 ${bgColorClass}`}
            >
              {/* Thumbnail or Icon */}
              <div className="flex items-center justify-center h-24 mb-3">
                {doc.thumbnail_path ? (
                  <img
                    src={getThumbnailUrl(doc.thumbnail_path)}
                    alt={doc.filename}
                    className="max-h-full max-w-full object-contain rounded"
                    onError={(e) => {
                      // If thumbnail fails to load, show icon instead
                      e.currentTarget.style.display = "none";
                      e.currentTarget.nextElementSibling?.classList.remove(
                        "hidden"
                      );
                    }}
                  />
                ) : null}
                {/* <div className={doc.thumbnail_path ? "hidden" : "block"}>
                  {icon}
                </div> */}
              </div>

              {/* File Info */}
              <div className="space-y-1">
                <h3
                  className="font-medium text-sm text-gray-900 leading-tight"
                  title={doc.filename}
                >
                  {truncateFilename(doc.filename)}
                </h3>

                {/* File Details */}
                <div className="text-xs text-gray-600 space-y-0.5">
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
                      {doc.page_count} page{doc.page_count > 1 ? "s" : ""}
                    </div>
                  )}

                  <div className="text-gray-500">
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
