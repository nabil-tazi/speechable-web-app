import { NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase/server";
import {
  checkCredits,
  deductCredits,
} from "@/app/features/credits/service";

// Default: 10,000 characters = 1 credit (for text processing)
const DEFAULT_CHARACTERS_PER_CREDIT = 10000;

// TTS rates
export const KOKORO_CHARACTERS_PER_CREDIT = 2000; // 1 credit = 2000 chars
export const CHATTERBOX_CHARACTERS_PER_CREDIT = 1000; // 1 credit = 1000 chars

export interface CreditCheckResponse {
  success: true;
  userId: string;
  creditsAvailable: number;
  creditsNeeded: number;
  charactersPerCredit: number;
}

export interface CreditCheckError {
  success: false;
  response: NextResponse;
}

/**
 * Calculate credits needed for a given text length and rate
 */
function calculateCredits(textLength: number, charactersPerCredit: number): number {
  return textLength / charactersPerCredit;
}

/**
 * Check if user has sufficient credits for a text processing request.
 * Returns userId and credit info if sufficient, or an error response to return.
 *
 * @param textLength - Length of text to process
 * @param charactersPerCredit - Optional custom rate (default: 10,000 chars = 1 credit)
 */
export async function checkCreditsForRequest(params: {
  textLength: number;
  charactersPerCredit?: number;
}): Promise<CreditCheckResponse | CreditCheckError> {
  const { textLength, charactersPerCredit = DEFAULT_CHARACTERS_PER_CREDIT } = params;
  const creditsNeeded = calculateCredits(textLength, charactersPerCredit);

  // Get authenticated user
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      ),
    };
  }

  // Check credits with auto-refill
  const creditInfo = await checkCredits(user.id);
  if (!creditInfo) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Failed to check credits" },
        { status: 500 }
      ),
    };
  }

  // Check if user has sufficient credits
  if (creditInfo.credits < creditsNeeded) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: "Insufficient credits",
          creditsNeeded,
          creditsAvailable: creditInfo.credits,
          nextRefillDate: creditInfo.nextRefillDate,
        },
        { status: 402 } // Payment Required
      ),
    };
  }

  return {
    success: true,
    userId: user.id,
    creditsAvailable: creditInfo.credits,
    creditsNeeded,
    charactersPerCredit,
  };
}

/**
 * Deduct credits after a successful AI operation.
 * Call this ONLY after the operation succeeds.
 *
 * @param userId - User ID
 * @param textLength - Length of text processed
 * @param charactersPerCredit - Optional custom rate (default: 10,000 chars = 1 credit)
 */
export async function deductCreditsAfterOperation(
  userId: string,
  textLength: number,
  charactersPerCredit: number = DEFAULT_CHARACTERS_PER_CREDIT
): Promise<{
  creditsUsed: number;
  creditsRemaining: number;
} | null> {
  const creditsNeeded = calculateCredits(textLength, charactersPerCredit);
  const result = await deductCredits(userId, creditsNeeded);

  if (!result || !result.success) {
    console.error(
      "[credits-middleware] Failed to deduct credits after operation:",
      result?.errorMessage
    );
    return null;
  }

  return {
    creditsUsed: creditsNeeded,
    creditsRemaining: result.newBalance,
  };
}
