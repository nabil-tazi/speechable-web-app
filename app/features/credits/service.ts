import { createClient } from "@/app/lib/supabase/server";

// Credit rate: 10,000 characters = 1 credit
const CHARACTERS_PER_CREDIT = 10000;

export interface CreditCheckResult {
  credits: number;
  wasRefilled: boolean;
  nextRefillDate: string;
}

export interface CreditDeductionResult {
  success: boolean;
  newBalance: number;
  errorMessage: string | null;
}

// Database RPC response types
interface CheckAndRefillCreditsRow {
  credits: number;
  was_refilled: boolean;
  next_refill_date: string;
}

interface DeductCreditsRow {
  success: boolean;
  new_balance: number;
  error_message: string | null;
}

/**
 * Calculate how many credits are needed for a given text length
 */
export function calculateCreditsForText(textLength: number): number {
  return textLength / CHARACTERS_PER_CREDIT;
}

/**
 * Check user's credits with automatic refill check
 */
export async function checkCredits(userId: string): Promise<CreditCheckResult | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("check_and_refill_credits", { p_user_id: userId })
    .single<CheckAndRefillCreditsRow>();

  if (error) {
    console.error("[credits/service] Error checking credits:", error);
    return null;
  }

  if (!data) {
    return null;
  }

  return {
    credits: Number(data.credits),
    wasRefilled: data.was_refilled,
    nextRefillDate: data.next_refill_date,
  };
}

/**
 * Deduct credits from user's balance (calls DB function which handles refill check)
 */
export async function deductCredits(
  userId: string,
  amount: number
): Promise<CreditDeductionResult | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("deduct_credits", { p_user_id: userId, p_amount: amount })
    .single<DeductCreditsRow>();

  if (error) {
    console.error("[credits/service] Error deducting credits:", error);
    return null;
  }

  if (!data) {
    return null;
  }

  return {
    success: data.success,
    newBalance: Number(data.new_balance),
    errorMessage: data.error_message,
  };
}

/**
 * Get user's current credit info directly from the users table
 */
export async function getUserCredits(userId: string): Promise<{
  credits: number;
  nextRefillDate: string;
  monthlyAllowance: number;
} | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("users")
    .select("credits, next_refill_date, monthly_credit_allowance")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("[credits/service] Error getting user credits:", error);
    return null;
  }

  return {
    credits: Number(data.credits),
    nextRefillDate: data.next_refill_date,
    monthlyAllowance: Number(data.monthly_credit_allowance),
  };
}
