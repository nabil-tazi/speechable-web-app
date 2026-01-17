import { LLM_CHARACTERS_PER_CREDIT } from "@/app/constants/credits";

/**
 * Calculate estimated credits for text processing.
 * Returns a string representation of the credits.
 */
export function estimateCredits(text: string): string {
  const credits = text.length / LLM_CHARACTERS_PER_CREDIT;
  // Round to 0.01, minimum 0.01
  return Math.max(0.01, Math.round(credits * 100) / 100).toFixed(2);
}
