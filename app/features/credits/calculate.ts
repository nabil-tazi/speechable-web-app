import {
  LECTURE_DURATIONS,
  CONVERSATIONAL_DURATIONS,
  type LectureDuration,
  type ConversationalDuration,
} from "@/app/features/pdf/types";

// Credit rates (characters per credit)
export const CHARS_PER_CREDIT = {
  TRANSLATION: 4000,      // Original + Translation
  NATURAL: 5000,          // Natural processing
  LECTURE: 10000,         // Lecture (with duration multiplier)
  CONVERSATIONAL: 10000,  // Conversational (with duration multiplier)
} as const;

interface CalculateCreditsParams {
  textLength: number;
  processingLevel: 0 | 1 | 2 | 3;
  needsTranslation: boolean;
  lectureDuration?: LectureDuration;
  conversationalDuration?: ConversationalDuration;
}

/**
 * Calculate the credits needed for a given processing operation.
 * Returns 0 for Original without translation (free).
 */
export function calculateCredits({
  textLength,
  processingLevel,
  needsTranslation,
  lectureDuration = "medium",
  conversationalDuration = "medium",
}: CalculateCreditsParams): number {
  // Original without translation is free
  if (processingLevel === 0 && !needsTranslation) {
    return 0;
  }

  let charsPerCredit: number;
  let durationMultiplier = 1;

  if (processingLevel === 0 && needsTranslation) {
    // Original + Translation
    charsPerCredit = CHARS_PER_CREDIT.TRANSLATION;
  } else if (processingLevel === 1) {
    // Natural
    charsPerCredit = CHARS_PER_CREDIT.NATURAL;
  } else if (processingLevel === 2) {
    // Lecture
    charsPerCredit = CHARS_PER_CREDIT.LECTURE;
    durationMultiplier = LECTURE_DURATIONS.find((d) => d.value === lectureDuration)?.creditMultiplier ?? 1;
  } else {
    // Conversational
    charsPerCredit = CHARS_PER_CREDIT.CONVERSATIONAL;
    durationMultiplier = CONVERSATIONAL_DURATIONS.find((d) => d.value === conversationalDuration)?.creditMultiplier ?? 1;
  }

  return (textLength / charsPerCredit) * durationMultiplier;
}

/**
 * Calculate credits and round for display (1 decimal place).
 */
export function calculateCreditsForDisplay(params: CalculateCreditsParams): number {
  const credits = calculateCredits(params);
  return Math.ceil(credits * 10) / 10;
}
