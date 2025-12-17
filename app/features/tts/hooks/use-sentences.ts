"use client";

import { useMemo } from "react";
import { useTTSContext } from "../context/tts-provider";
import type { Sentence, SentenceAudio } from "../types";

/**
 * Hook for accessing sentence data.
 */
export function useSentences() {
  const { state, currentSentence, hoveredIndex, setHoveredIndex } = useTTSContext();

  const sentences = state.sentences;
  const audioState = state.audioState;

  /**
   * Get audio state for a specific sentence.
   */
  const getAudioState = (sentenceId: string): SentenceAudio | undefined => {
    return audioState.get(sentenceId);
  };

  /**
   * Check if a sentence is ready to play.
   */
  const isReady = (sentenceId: string): boolean => {
    const audio = audioState.get(sentenceId);
    return audio?.status === "ready";
  };

  /**
   * Check if a sentence is currently generating.
   */
  const isGenerating = (sentenceId: string): boolean => {
    const audio = audioState.get(sentenceId);
    return audio?.status === "generating";
  };

  /**
   * Get unique reader IDs from all sentences.
   */
  const readerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const sentence of sentences) {
      ids.add(sentence.reader_id);
    }
    return Array.from(ids);
  }, [sentences]);

  /**
   * Count of sentences that are ready (have generated audio).
   */
  const readyCount = useMemo(() => {
    let count = 0;
    for (const sentence of sentences) {
      const audio = audioState.get(sentence.id);
      if (audio?.status === "ready") {
        count++;
      }
    }
    return count;
  }, [sentences, audioState]);

  /**
   * Check if all sentences have generated audio.
   */
  const allReady = useMemo(() => {
    if (sentences.length === 0) return false;
    return readyCount === sentences.length;
  }, [sentences.length, readyCount]);

  /**
   * Get sentences grouped by reader ID.
   */
  const sentencesByReader = useMemo(() => {
    const grouped = new Map<string, Sentence[]>();
    for (const sentence of sentences) {
      const existing = grouped.get(sentence.reader_id) || [];
      existing.push(sentence);
      grouped.set(sentence.reader_id, existing);
    }
    return grouped;
  }, [sentences]);

  return {
    sentences,
    audioState,
    currentSentence,
    currentIndex: state.playback.currentIndex,
    getAudioState,
    isReady,
    isGenerating,
    readerIds,
    sentencesByReader,
    totalCount: sentences.length,
    readyCount,
    allReady,
    hoveredIndex,
    setHoveredIndex,
  };
}
