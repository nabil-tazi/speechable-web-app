import React from "react";
import { cn } from "@/lib/utils";
import { type Sentence, useSentences, usePlayback } from "@/app/features/tts";

interface SentenceRendererProps {
  blockContent: string;
  sentences: Sentence[];
  currentPlayingIndex: number;
  isPlaybackOn: boolean;
  onSentenceClick: (globalIndex: number) => void;
}

/**
 * Component for rendering sentences with TTS highlighting and click-to-play.
 * Each sentence becomes a clickable span with visual feedback for playback state.
 */
export function SentenceRenderer({
  blockContent,
  sentences,
  currentPlayingIndex,
  isPlaybackOn,
  onSentenceClick,
}: SentenceRendererProps) {
  const { isGenerating } = useSentences();
  const { status } = usePlayback();

  const elements: React.ReactNode[] = [];
  let lastEnd = 0;

  for (const sentence of sentences) {
    // Find this sentence's position in block content
    const startIndex = blockContent.indexOf(sentence.text, lastEnd);
    if (startIndex === -1) continue;

    // Add any gap text before this sentence (whitespace between sentences)
    if (startIndex > lastEnd) {
      elements.push(
        <span key={`gap-${lastEnd}`}>
          {blockContent.slice(lastEnd, startIndex)}
        </span>
      );
    }

    // Sentences with reader_id "skip" are rendered as plain text (no TTS, no click, no hover)
    if (sentence.reader_id === "skip") {
      elements.push(
        <span key={sentence.id}>{sentence.text}</span>
      );
    } else {
      // Check various states for this sentence
      const isCurrentSentence = sentence.globalIndex === currentPlayingIndex;
      const isPlaying = isPlaybackOn && isCurrentSentence;
      const isBuffering = status === "buffering" && isCurrentSentence;
      const isGeneratingThis = isCurrentSentence && isGenerating(sentence.id);
      const isWaiting = isBuffering || isGeneratingThis;

      elements.push(
        <span
          key={sentence.id}
          className={cn(
            "cursor-pointer transition-colors rounded px-1 -mx-1 py-0.25 -my-0.25",
            isWaiting
              ? "bg-gray-300 text-gray-900 animate-pulse"
              : isPlaying
              ? "bg-gray-300 text-gray-900"
              : "hover:bg-gray-200"
          )}
          onClick={(e) => {
            e.stopPropagation();
            onSentenceClick(sentence.globalIndex);
          }}
        >
          {sentence.text}
        </span>
      );
    }

    lastEnd = startIndex + sentence.text.length;
  }

  // Add any remaining text after all sentences
  if (lastEnd < blockContent.length) {
    elements.push(
      <span key={`end-${lastEnd}`}>{blockContent.slice(lastEnd)}</span>
    );
  }

  return <>{elements}</>;
}
