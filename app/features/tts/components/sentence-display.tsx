"use client";

import React, { useRef, useEffect, useMemo } from "react";
import { useSentences } from "../hooks/use-sentences";
import { usePlayback } from "../hooks/use-playback";
import { VoiceLabel } from "./voice-label";
import type { Sentence } from "../types";

export function SentenceDisplay() {
  const { sentences, currentIndex, isGenerating, hoveredIndex, setHoveredIndex } =
    useSentences();
  const { status, isPlaybackOn, playFromSentence } = usePlayback();

  const highlightedRef = useRef<HTMLSpanElement>(null);

  // Group sentences by segment
  const segmentGroups = useMemo(() => {
    const groups: Map<number, { readerId: string; sentences: Sentence[] }> = new Map();
    for (const sentence of sentences) {
      if (!groups.has(sentence.segmentIndex)) {
        groups.set(sentence.segmentIndex, {
          readerId: sentence.reader_id,
          sentences: [],
        });
      }
      groups.get(sentence.segmentIndex)!.sentences.push(sentence);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
  }, [sentences]);

  // Auto-scroll to current sentence
  useEffect(() => {
    if (highlightedRef.current && currentIndex >= 0) {
      setTimeout(() => {
        highlightedRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
      }, 50);
    }
  }, [currentIndex]);

  // Handle sentence click
  const handleClick = (globalIndex: number) => {
    playFromSentence(globalIndex);
  };

  // Get styling for a sentence
  const getSentenceStyling = (
    globalIndex: number,
    isCurrentSentence: boolean
  ) => {
    const baseClasses =
      "transition-all cursor-pointer px-1 py-0.5 rounded inline";

    const isBufferingThis =
      status === "buffering" && globalIndex === currentIndex;
    const isHovered = hoveredIndex === globalIndex;

    if (isBufferingThis) {
      return `${baseClasses} bg-gray-200 text-gray-900 animate-pulse`;
    } else if (isCurrentSentence && isPlaybackOn) {
      return `${baseClasses} bg-gray-200 text-gray-900`;
    } else if (isHovered) {
      return `${baseClasses} bg-gray-100 text-gray-800`;
    } else {
      return `${baseClasses} text-gray-800 hover:bg-gray-100`;
    }
  };

  if (sentences.length === 0) {
    return (
      <div className="prose prose-lg max-w-none">
        <div className="text-gray-500 italic">No content available...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20">
      {segmentGroups.map(([segmentIndex, { readerId, sentences: segmentSentences }]) => (
        <div key={segmentIndex} className="segment-block">
          <VoiceLabel readerId={readerId} />
          <p className="leading-relaxed">
            {segmentSentences.map((sentence) => {
              const isCurrentSentence = sentence.globalIndex === currentIndex;

              return (
                <React.Fragment key={sentence.id}>
                  <span
                    ref={isCurrentSentence ? highlightedRef : null}
                    className={getSentenceStyling(
                      sentence.globalIndex,
                      isCurrentSentence
                    )}
                    onClick={() => handleClick(sentence.globalIndex)}
                    onMouseEnter={() => setHoveredIndex(sentence.globalIndex)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    {sentence.text}
                  </span>{" "}
                </React.Fragment>
              );
            })}
          </p>
        </div>
      ))}
    </div>
  );
}
