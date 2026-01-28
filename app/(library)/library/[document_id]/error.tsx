"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function DocumentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[DocumentPage] Error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8">
      <h2 className="text-lg font-semibold text-gray-900">
        Something went wrong loading this document
      </h2>
      <p className="text-sm text-gray-500 max-w-md text-center">
        {error.message || "An unexpected error occurred."}
      </p>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => window.history.back()}>
          Go back
        </Button>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
