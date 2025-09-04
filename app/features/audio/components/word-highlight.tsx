import { Separator } from "@/components/ui/separator";
import { Mic2, UsersRound } from "lucide-react";
import React, { useRef, useEffect } from "react";
import { AudioSegment } from "@/app/features/audio/types";

interface GroupedWord {
  text: string;
  start: number;
  end: number;
  segmentId: string;
  segmentTitle: string;
  isTitle?: boolean;
  titleWordIndex?: number;
}

interface SegmentTimelineItem {
  segmentId: string;
  startTime: number;
  endTime: number;
  duration: number;
  segment: AudioSegment;
}

interface WordHighlightDisplayProps {
  author?: string;
  voices: string[];
  documentTitle: string;
  versionName: string;
  groupedWords: GroupedWord[];
  segmentTimeline: SegmentTimelineItem[];
  currentTime: number;
  onWordClick: (wordStartTime: number) => void;
}

const formatTime = (seconds: number) => {
  if (!isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export function WordHighlightDisplay({
  author,
  voices,
  documentTitle,
  versionName,
  groupedWords,
  segmentTimeline,
  currentTime,
  onWordClick,
}: WordHighlightDisplayProps) {
  const highlightedWordRef = useRef<HTMLSpanElement>(null);

  // Find current word
  const currentWordIndex = groupedWords.findIndex(
    (wordGroup) =>
      currentTime >= wordGroup.start && currentTime <= wordGroup.end
  );

  // Auto-scroll to highlighted word
  useEffect(() => {
    if (highlightedWordRef.current && currentWordIndex >= 0) {
      setTimeout(() => {
        if (highlightedWordRef.current) {
          highlightedWordRef.current.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
            inline: "nearest",
          });
        }
      }, 50);
    }
  }, [currentWordIndex]);

  // Helper function to get word styling based on type and state
  const getWordStyling = (
    wordGroup: GroupedWord,
    globalIndex: number,
    isCurrentWord: boolean
  ) => {
    const baseClasses =
      "transition-all cursor-pointer px-1 py-0.5 rounded inline-block";

    // Debug log to check if isTitle is being detected
    // if (wordGroup.isTitle) {
    //   console.log("Title word detected:", wordGroup.text, wordGroup.isTitle);
    // }

    if (wordGroup.isTitle === true) {
      // Title word styling
      if (isCurrentWord) {
        return `${baseClasses} bg-gray-200 font-bold text-lg text-gray-900 `;
      } else {
        return `${baseClasses} font-bold text-lg text-gray-800 hover:bg-gray-100`;
      }
    } else {
      // Regular speech word styling
      if (isCurrentWord) {
        return `${baseClasses} bg-gray-200 text-gray-900`;
      } else {
        return `${baseClasses} text-gray-800 hover:bg-gray-100`;
      }
    }
  };

  // Helper function to determine if we should add spacing after a word
  const shouldAddSpacing = (
    wordGroup: GroupedWord,
    nextWordGroup?: GroupedWord
  ) => {
    // Add line break after title section
    if (wordGroup.isTitle && (!nextWordGroup || !nextWordGroup.isTitle)) {
      return "title-end";
    }
    // Add line break before title section (except for the first word)
    if (!wordGroup.isTitle && nextWordGroup?.isTitle) {
      return "before-title";
    }
    // Regular spacing
    return "normal";
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto min-h-0">
      <div className="flex flex-col gap-2 flex-shrink-0 px-4 py-4">
        <h2 className="text-2xl font-semibold">{documentTitle}</h2>

        <div className="flex items-center gap-4">
          {author && (
            <span className="flex items-center gap-2 text-gray-500">
              <UsersRound size="16" />
              <h3 className="text-sm font-medium ">{author}</h3>
            </span>
          )}
          {author && <Separator orientation="vertical" />}
          <span className="flex items-center gap-2 text-gray-500">
            <Mic2 size="16" />
            <h3 className="text-sm font-medium capitalize">
              {voices.join(", ")}
            </h3>
          </span>
        </div>
      </div>

      {/* Word timestamps */}
      {groupedWords.length > 0 && (
        <div className="flex-1 p-4 leading-relaxed">
          {segmentTimeline.map(({ segment, segmentId }) => {
            // Filter words that belong to this segment
            const segmentWords = groupedWords.filter(
              (word) => word.segmentId === segmentId
            );

            if (segmentWords.length === 0) return null;

            return (
              <div key={segmentId} className="mb-6">
                {/* Words for this segment - titles and speech are now rendered from word_timestamps */}
                <div className="space-y-1">
                  {segmentWords.map((wordGroup, wordIndex) => {
                    // Find the global index of this word in the original groupedWords array
                    const globalIndex = groupedWords.findIndex(
                      (w) => w === wordGroup
                    );

                    const isCurrentWord = globalIndex === currentWordIndex;
                    const nextWord = segmentWords[wordIndex + 1];
                    const spacingType = shouldAddSpacing(wordGroup, nextWord);

                    return (
                      <React.Fragment key={`${segmentId}-${wordIndex}`}>
                        <span
                          ref={isCurrentWord ? highlightedWordRef : null}
                          className={getWordStyling(
                            wordGroup,
                            globalIndex,
                            isCurrentWord
                          )}
                          onClick={() => onWordClick(wordGroup.start)}
                          title={`${
                            wordGroup.isTitle ? "Title: " : ""
                          }Jump to ${formatTime(wordGroup.start)} - ${
                            wordGroup.segmentTitle
                          }`}
                        >
                          {wordGroup.text}
                        </span>

                        {/* Handle spacing and line breaks */}
                        {spacingType === "title-end" && <br />}
                        {spacingType === "before-title" && (
                          <>
                            <br />
                            <br />
                          </>
                        )}
                        {/* {spacingType === "normal" &&
                          wordIndex < segmentWords.length - 1 &&
                          " "} */}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
