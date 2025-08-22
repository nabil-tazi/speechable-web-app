export async function mergeWordTimestamps(
  individualWordTimestamps: any[],
  readerIds: string[]
): Promise<any[]> {
  const mergedWords: any[] = [];
  let cumulativeTime = 0; // This is our "startTime" equivalent

  for (let i = 0; i < individualWordTimestamps.length; i++) {
    const timestamps = individualWordTimestamps[i];
    const readerId = readerIds[i];
    const startTime = cumulativeTime; // Current offset for this segment

    if (timestamps && Array.isArray(timestamps) && timestamps.length > 0) {
      // Add offset to each word timestamp
      timestamps.forEach((word: any) => {
        mergedWords.push({
          ...word,
          start: word.start + startTime,
          end: word.end + startTime,
          segmentId: `speech-${i}`,
          readerId: readerId,
        });
      });

      // Use the end timestamp of the last word to update cumulative time
      const lastWord = timestamps[timestamps.length - 1];
      cumulativeTime = lastWord.end + startTime; // This becomes the start time for the next segment
    }
  }

  return mergedWords;
}
