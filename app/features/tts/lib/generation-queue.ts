import type { Sentence, QueueItem, VoiceConfig } from "../types";

/**
 * GenerationQueue manages the order in which sentences are generated.
 *
 * Core behavior:
 * - Sequential generation from current position forward
 * - Look-behind only after forward generation is complete
 * - Never regenerate already-generated sentences
 * - Reorders when user clicks a sentence or changes voice/speed
 */
export class GenerationQueue {
  private queue: QueueItem[] = [];
  private generatedSet: Set<number> = new Set(); // Track generated sentence globalIndexes
  private isProcessing = false;
  private generationEpoch = 0; // Tracks invalidation cycles to ignore stale results

  /**
   * Check if a sentence has already been generated.
   */
  isGenerated(globalIndex: number): boolean {
    return this.generatedSet.has(globalIndex);
  }

  /**
   * Mark a sentence as generated.
   */
  markGenerated(globalIndex: number): void {
    this.generatedSet.add(globalIndex);
  }

  /**
   * Invalidate all generated sentences (e.g., on speed change).
   * Also resets processing state and increments epoch to ignore in-flight results.
   */
  invalidateAll(): void {
    this.generatedSet.clear();
    this.isProcessing = false;
    this.generationEpoch++;
  }

  /**
   * Get the current generation epoch.
   * Used to track which generation session a result belongs to.
   */
  getEpoch(): number {
    return this.generationEpoch;
  }

  /**
   * Invalidate generated sentences for a specific reader_id (e.g., on voice change).
   * Also resets processing state and increments epoch to ignore in-flight results.
   */
  invalidateByReaderId(sentences: Sentence[], readerId: string): void {
    for (const sentence of sentences) {
      if (sentence.reader_id === readerId) {
        this.generatedSet.delete(sentence.globalIndex);
      }
    }
    this.isProcessing = false;
    this.generationEpoch++;
  }

  /**
   * Build the generation queue starting from a given index.
   *
   * Strategy (lazy loading with lookahead):
   * 1. Add the current sentence if ungenerated
   * 2. Add up to `lookahead` more ungenerated sentences ahead
   *
   * This enables on-demand generation where we only stay 1 sentence ahead,
   * extending the queue when each sentence starts playing.
   *
   * @param lookahead - How many sentences to generate ahead (default: 1)
   */
  buildQueue(
    sentences: Sentence[],
    startIndex: number,
    voiceConfig: VoiceConfig,
    lookahead: number = 1
  ): void {
    this.queue = [];

    const addToQueue = (sentence: Sentence): boolean => {
      if (this.generatedSet.has(sentence.globalIndex)) return false;
      // Skip if already in queue
      if (this.queue.some((item) => item.globalIndex === sentence.globalIndex))
        return false;

      const voice = voiceConfig.voiceMap[sentence.reader_id] || "af_heart";
      this.queue.push({
        sentenceId: sentence.id,
        globalIndex: sentence.globalIndex,
        text: sentence.text,
        reader_id: sentence.reader_id,
        voice,
        speed: voiceConfig.speed,
      });
      return true;
    };

    // Add current sentence if needed
    if (startIndex < sentences.length) {
      addToQueue(sentences[startIndex]);
    }

    // Add lookahead sentences (only count ungenerated ones toward lookahead)
    let lookaheadAdded = 0;
    for (let i = startIndex + 1; i < sentences.length && lookaheadAdded < lookahead; i++) {
      if (addToQueue(sentences[i])) {
        lookaheadAdded++;
      }
    }
  }

  /**
   * Extend the queue with the next ungenerated sentence(s).
   * Used for lazy loading - adds more sentences without clearing the existing queue.
   * Call this when a sentence starts playing to maintain the lookahead.
   *
   * @param afterIndex - The index of the sentence that just started playing
   * @param count - How many sentences to add (default: 1)
   * @returns true if any sentences were added
   */
  extendQueue(
    sentences: Sentence[],
    afterIndex: number,
    voiceConfig: VoiceConfig,
    count: number = 1
  ): boolean {
    let added = 0;

    for (let i = afterIndex + 1; i < sentences.length && added < count; i++) {
      const sentence = sentences[i];

      // Skip if already generated
      if (this.generatedSet.has(sentence.globalIndex)) continue;

      // Skip if already in queue
      if (this.queue.some((item) => item.globalIndex === sentence.globalIndex)) continue;

      const voice = voiceConfig.voiceMap[sentence.reader_id] || "af_heart";
      this.queue.push({
        sentenceId: sentence.id,
        globalIndex: sentence.globalIndex,
        text: sentence.text,
        reader_id: sentence.reader_id,
        voice,
        speed: voiceConfig.speed,
      });
      added++;
    }

    return added > 0;
  }

  /**
   * Get the next item to generate.
   * Returns null if queue is empty or already processing.
   */
  getNext(): QueueItem | null {
    if (this.isProcessing || this.queue.length === 0) {
      return null;
    }

    // Find first item that's not already generated
    const index = this.queue.findIndex(
      (item) => !this.generatedSet.has(item.globalIndex)
    );

    if (index === -1) {
      return null;
    }

    this.isProcessing = true;
    return this.queue[index];
  }

  /**
   * Mark current processing as complete.
   * @param globalIndex - The globalIndex of the completed sentence
   * @param success - Whether generation succeeded
   * @param epoch - The epoch when generation started (to ignore stale results)
   * @returns true if the result was accepted, false if it was from a stale epoch
   */
  completeProcessing(globalIndex: number, success: boolean, epoch?: number): boolean {
    // If epoch is provided and doesn't match current, ignore this stale result
    if (epoch !== undefined && epoch !== this.generationEpoch) {
      console.log("[GenerationQueue] Ignoring stale result from epoch", epoch, "current:", this.generationEpoch);
      return false;
    }

    this.isProcessing = false;

    if (success) {
      this.markGenerated(globalIndex);
    }

    // Remove from queue
    this.queue = this.queue.filter((item) => item.globalIndex !== globalIndex);
    return true;
  }

  /**
   * Cancel the current processing without removing the item from queue.
   * Used when we want to delay processing (e.g., item is too far ahead of playback).
   */
  cancelProcessing(): void {
    this.isProcessing = false;
  }

  /**
   * Clear the queue (e.g., when stopping playback).
   */
  clear(): void {
    this.queue = [];
    this.isProcessing = false;
  }

  /**
   * Check if there are pending items in the queue.
   */
  hasPending(): boolean {
    return this.queue.some((item) => !this.generatedSet.has(item.globalIndex));
  }

  /**
   * Get the current queue length (for debugging).
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * Check if currently processing.
   */
  get processing(): boolean {
    return this.isProcessing;
  }

  /**
   * Find the first ungenerated sentence at or after the given index.
   * Returns the index, or -1 if all are generated from that point.
   */
  findFirstUngenerated(sentences: Sentence[], fromIndex: number): number {
    for (let i = fromIndex; i < sentences.length; i++) {
      if (!this.generatedSet.has(sentences[i].globalIndex)) {
        return i;
      }
    }
    return -1;
  }
}
