import React from "react";
import { computeWordDiff } from "../utils/diff";

interface DiffRendererProps {
  original: string;
  updated: string;
  newTextRef: React.RefObject<HTMLSpanElement | null>;
}

/**
 * Component for rendering word-level diff between original and updated text.
 * Shows removed text with strikethrough and added text with blue highlight.
 */
export function DiffRenderer({ original, updated, newTextRef }: DiffRendererProps) {
  const segments = computeWordDiff(original, updated);

  // Find the last "added" segment to attach the ref
  let lastAddedIndex = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].type === "added") {
      lastAddedIndex = i;
      break;
    }
  }

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "unchanged") {
          return <span key={index}>{segment.text}</span>;
        } else if (segment.type === "removed") {
          return (
            <span key={index} className="line-through opacity-50">
              {segment.text}
            </span>
          );
        } else {
          // added
          return (
            <span
              key={index}
              ref={index === lastAddedIndex ? newTextRef : undefined}
              className="bg-blue-100"
            >
              {segment.text}
            </span>
          );
        }
      })}
    </>
  );
}
