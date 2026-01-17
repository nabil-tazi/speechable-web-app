import type { TextHighlight } from "@/app/features/pdf/types";
import { removeHighlightedSections, getRemovalStats } from "./remove-highlights";

export async function processText(
  text: string,
  documentTitle: string,
  processingLevel: 0 | 1 | 2 | 3,
  highlights?: TextHighlight[],
  retryCount = 0
): Promise<{ cleanedText: any; metadata: any }> {
  const maxRetries = 2;
  try {
    // Remove footnotes and legends before sending to API
    const cleanedText = removeHighlightedSections(text, highlights, ['footnote', 'legend']);

    const stats = getRemovalStats(text, highlights, ['footnote', 'legend']);
    // if (stats.removedCount > 0) {
    //   console.log(`[processText] Removed ${stats.removedCount} sections (${stats.removedChars} chars):`, stats.removedByType);
    // }

    const response = await fetch("/api/openai-advanced", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: cleanedText,
        title: documentTitle,
        level: processingLevel,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      // Handle specific error codes (same as original)
      if (
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504
      ) {
        if (retryCount < maxRetries) {
          await new Promise((resolve) =>
            setTimeout(resolve, (retryCount + 1) * 1000)
          );
          return processText(
            text,
            documentTitle,
            processingLevel,
            highlights,
            retryCount + 1
          );
        } else {
          throw new Error(
            "OpenAI service is temporarily unavailable. Please try again in a few minutes."
          );
        }
      } else if (response.status === 429) {
        throw new Error(
          "Rate limit exceeded. Please wait a moment and try again."
        );
      } else if (response.status === 401) {
        throw new Error(
          "Authentication failed. Please check your API configuration."
        );
      } else if (response.status >= 400 && response.status < 500) {
        throw new Error(
          errorData.error ||
            `Request failed (${response.status}). Please check your input and try again.`
        );
      } else {
        throw new Error(
          errorData.error || `OpenAI API error: ${response.status}`
        );
      }
    }

    const data = await response.json();

    // console.log(data.message);

    return {
      cleanedText: data.message,
      metadata: data.metadata,
    };
  } catch (err) {
    console.error("Error processing text:", err);

    throw err; // Re-throw so startProcessing can handle it
  } finally {
  }
}
