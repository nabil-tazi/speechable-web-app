"use client";

import { useEffect, useRef } from "react";

function formatRefillDate(dateString: string | null): string {
  if (!dateString) return "soon";
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.ceil(
    (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays < 7) return `in ${diffDays} days`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

interface InsufficientCreditsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  creditsNeeded: number;
  creditsAvailable: number;
  nextRefillDate: string | null;
}

export default function InsufficientCreditsDialog({
  isOpen,
  onClose,
  creditsNeeded,
  creditsAvailable,
  nextRefillDate,
}: InsufficientCreditsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      dialog.showModal();
    } else {
      dialog.close();
    }
  }, [isOpen]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    const dialog = dialogRef.current;
    if (dialog && e.target === dialog) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 bg-transparent p-0 m-0 max-w-none max-h-none w-full h-full backdrop:bg-black/50"
      onClick={handleBackdropClick}
      onClose={onClose}
    >
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md p-6">
          {/* Icon */}
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
          </div>

          {/* Title */}
          <h2 className="text-lg font-semibold text-white text-center mb-2">
            Insufficient Credits
          </h2>

          {/* Message */}
          <p className="text-gray-400 text-center text-sm mb-4">
            You don&apos;t have enough credits to perform this operation.
          </p>

          {/* Credit breakdown */}
          <div className="bg-gray-900/50 rounded-lg p-4 mb-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Credits needed:</span>
              <span className="text-white font-medium">
                {creditsNeeded.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Credits available:</span>
              <span className="text-red-400 font-medium">
                {creditsAvailable.toFixed(2)}
              </span>
            </div>
            <div className="border-t border-gray-700 pt-2 mt-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Credits refill:</span>
                <span className="text-brand-secondary font-medium">
                  {formatRefillDate(nextRefillDate)}
                </span>
              </div>
            </div>
          </div>

          {/* Suggestion */}
          <p className="text-gray-500 text-xs text-center mb-4">
            Try selecting a smaller portion of text, or wait for your monthly
            credit refill.
          </p>

          {/* Close button */}
          <button
            onClick={onClose}
            className="w-full py-2.5 px-4 bg-white/10 hover:bg-white/15 text-white rounded-lg transition-colors text-sm font-medium"
          >
            Got it
          </button>
        </div>
      </div>
    </dialog>
  );
}
