"use client";

import React, { useRef, useEffect, useMemo } from "react";
import { useSentences } from "../hooks/use-sentences";
import { usePlayback } from "../hooks/use-playback";
import type { Sentence } from "../types";

export function SentenceDisplay() {
  const {
    sentences,
    currentIndex,
    isGenerating,
    hoveredIndex,
    setHoveredIndex,
  } = useSentences();
  const { status, isPlaybackOn, playFromSentence } = usePlayback();

  const highlightedRef = useRef<HTMLSpanElement>(null);

  // Group sentences by segment
  const segmentGroups = useMemo(() => {
    const groups: Map<number, { readerId: string; sentences: Sentence[] }> =
      new Map();
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
    sentence: Sentence,
    isCurrentSentence: boolean
  ) => {
    const isBufferingThis =
      status === "buffering" && sentence.globalIndex === currentIndex;
    const isGeneratingThis =
      isCurrentSentence && isGenerating(sentence.id);
    const isWaitingForThis = isBufferingThis || isGeneratingThis;
    const isHovered = hoveredIndex === sentence.globalIndex;

    // Title sentences have different base styling
    if (sentence.isTitle) {
      const sizeClass =
        sentence.sectionLevel === 1
          ? "text-2xl"
          : sentence.sectionLevel === 2
          ? "text-xl"
          : sentence.sectionLevel === 3
          ? "text-lg"
          : "text-base";

      const baseClasses = `transition-all cursor-pointer px-1 py-0.5 rounded inline font-semibold ${sizeClass}`;

      if (isWaitingForThis) {
        return `${baseClasses} bg-gray-200 text-gray-900 animate-pulse`;
      } else if (isCurrentSentence && isPlaybackOn) {
        return `${baseClasses} bg-gray-200 text-gray-900`;
      } else if (isHovered) {
        return `${baseClasses} bg-gray-100 text-gray-800`;
      } else {
        return `${baseClasses} text-gray-900 hover:bg-gray-100`;
      }
    }

    // Regular sentence styling
    const baseClasses =
      "transition-all cursor-pointer px-1 py-0.5 rounded inline";

    if (isWaitingForThis) {
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
    <div className="space-y-4 pb-20">
      {segmentGroups.map(([segmentIndex, { sentences: segmentSentences }]) => {
        const firstSentence = segmentSentences[0];
        const hasTitle = firstSentence?.isTitle;

        // Separate title sentence from content sentences
        const titleSentence = hasTitle ? firstSentence : null;
        const contentSentences = hasTitle
          ? segmentSentences.slice(1)
          : segmentSentences;

        return (
          <React.Fragment key={segmentIndex}>
            {/* Title sentence - clickable and part of playback */}
            {titleSentence && (
              <div className="sticky top-12 z-10 bg-background pt-2 pb-4 -mx-8 px-8 mb-4">
                <span
                  ref={
                    titleSentence.globalIndex === currentIndex
                      ? highlightedRef
                      : null
                  }
                  className={getSentenceStyling(
                    titleSentence,
                    titleSentence.globalIndex === currentIndex
                  )}
                  onClick={() => handleClick(titleSentence.globalIndex)}
                  onMouseEnter={() =>
                    setHoveredIndex(titleSentence.globalIndex)
                  }
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  {titleSentence.text}
                </span>
              </div>
            )}

            {/* Content sentences */}
            {contentSentences.length > 0 && (
              <div className="segment-block">
                <p className="leading-relaxed whitespace-pre-wrap indent-8 text-justify">
                  {contentSentences.map((sentence) => {
                    const isCurrentSentence =
                      sentence.globalIndex === currentIndex;

                    return (
                      <React.Fragment key={sentence.id}>
                        <span
                          ref={isCurrentSentence ? highlightedRef : null}
                          className={getSentenceStyling(
                            sentence,
                            isCurrentSentence
                          )}
                          onClick={() => handleClick(sentence.globalIndex)}
                          onMouseEnter={() =>
                            setHoveredIndex(sentence.globalIndex)
                          }
                          onMouseLeave={() => setHoveredIndex(null)}
                        >
                          {sentence.text}
                        </span>{" "}
                      </React.Fragment>
                    );
                  })}
                </p>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
