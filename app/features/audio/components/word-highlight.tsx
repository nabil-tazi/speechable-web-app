import React, { useRef, useEffect } from "react";

interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

interface AudioSegment {
  id: string;
  audio_version_id: string;
  segment_number: number;
  section_title?: string;
  start_page?: number;
  end_page?: number;
  text_start_index?: number;
  text_end_index?: number;
  audio_path: string;
  audio_duration?: number;
  audio_file_size: number;
  word_timestamps?: WordTimestamp[];
  created_at: string;
}

interface GroupedWord {
  text: string;
  start: number;
  end: number;
  segmentId: string;
  segmentTitle: string;
}

interface SegmentTimelineItem {
  segmentId: string;
  startTime: number;
  endTime: number;
  duration: number;
  segment: AudioSegment;
}

interface WordHighlightDisplayProps {
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

  return (
    <div className="flex flex-col h-full overflow-y-auto min-h-0">
      <div className="flex-shrink-0 px-4 py-4">
        <h2 className="text-lg font-semibold">{documentTitle}</h2>
        <h3 className="text-sm font-medium text-gray-500">{versionName}</h3>
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
                {/* Segment Title */}
                <h3 className="text-lg font-semibold text-gray-900">
                  {segment.section_title || `Section ${segment.segment_number}`}
                </h3>

                {/* Words for this segment */}
                <div className="space-y-1 px-8">
                  {segmentWords.map((wordGroup, wordIndex) => {
                    // Find the global index of this word in the original groupedWords array
                    const globalIndex = groupedWords.findIndex(
                      (w) => w === wordGroup
                    );

                    return (
                      <span
                        key={`${segmentId}-${wordIndex}`}
                        ref={
                          globalIndex === currentWordIndex
                            ? highlightedWordRef
                            : null
                        }
                        className={`${
                          globalIndex === currentWordIndex
                            ? "bg-gray-200 px-1 rounded"
                            : "text-gray-800 hover:bg-gray-100"
                        } transition-all cursor-pointer px-1 py-0.5 rounded inline-block`}
                        onClick={() => onWordClick(wordGroup.start)}
                        title={`Jump to ${formatTime(wordGroup.start)} - ${
                          wordGroup.segmentTitle
                        }`}
                      >
                        {wordGroup.text}
                        {wordIndex < segmentWords.length - 1 && " "}
                      </span>
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
