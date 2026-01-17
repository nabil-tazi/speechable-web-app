"use client";

import React, { useEffect, useState } from "react";
import { useEditor } from "../context/editor-provider";
import { Check, Loader2 } from "lucide-react";

export function SaveIndicator() {
  const { state } = useEditor();
  const [showSaved, setShowSaved] = useState(false);
  const [isFading, setIsFading] = useState(false);

  // Show checkmark for 3 seconds after saving completes, then fade out
  useEffect(() => {
    if (!state.isSaving && state.lastSaved && !state.isDirty) {
      setShowSaved(true);
      setIsFading(false);

      // Start fading after 2.5 seconds
      const fadeTimer = setTimeout(() => {
        setIsFading(true);
      }, 2500);

      // Hide completely after fade (300ms transition)
      const hideTimer = setTimeout(() => {
        setShowSaved(false);
        setIsFading(false);
      }, 2800);

      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(hideTimer);
      };
    }
  }, [state.isSaving, state.lastSaved, state.isDirty]);

  // Reset showSaved when starting to save again
  useEffect(() => {
    if (state.isSaving || state.isDirty) {
      setShowSaved(false);
      setIsFading(false);
    }
  }, [state.isSaving, state.isDirty]);

  // Show spinner only when actively saving to DB
  if (state.isSaving) {
    return <Loader2 className="h-4 w-4 animate-spin text-gray-400" />;
  }

  if (showSaved) {
    return (
      <div
        className={`flex items-center gap-1 text-gray-400 transition-opacity duration-300 ${
          isFading ? "opacity-0" : "opacity-100"
        }`}
      >
        <Check className="h-4 w-4" />
        <span className="text-sm">Saved</span>
      </div>
    );
  }

  return null;
}
