import type { TextHighlight } from "@/app/features/pdf/types";
import { removeHighlightedSections, getRemovalStats } from "./remove-highlights";

export async function identifySections(
  text: string,
  highlights?: TextHighlight[]
): Promise<any> {
  //   setIsClassifying(true);
  //   setError(null);

  try {
    // Remove footnotes and legends before sending to API
    const cleanedText = removeHighlightedSections(text, highlights, ['footnote', 'legend']);

    const stats = getRemovalStats(text, highlights, ['footnote', 'legend']);
    // if (stats.removedCount > 0) {
    //   console.log(`[identify-sections] Removed ${stats.removedCount} sections (${stats.removedChars} chars):`, stats.removedByType);
    // }

    const response = await fetch("/api/identify-sections", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: cleanedText }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || `Section identification failed: ${response.status}`
      );
    }

    const data = await response.json();

    // console.log("DOCUMENT SECTIONS");
    // console.log(data);

    // setError(null);

    return data; // Return the classification object
  } catch (err) {
    console.error("Error identifying document sections:", err);
    // setError(
    //   err instanceof Error ? err.message : "Failed to identify sections"
    // );
    return null; // Return null on error
  } finally {
    // setIsClassifying(false);
  }
}
