"use server";

import { createClient } from "@/app/lib/supabase/server";
import { isAdminUser } from "@/app/constants/admin";
import {
  checkCredits,
  deductCredits,
  calculateCreditsForText,
  getUserCredits,
} from "./service";

/**
 * Get current user's credits with automatic refill check
 */
export async function getUserCreditsAction() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const result = await checkCredits(user.id);
  if (!result) {
    return { error: "Failed to check credits" };
  }

  return {
    credits: result.credits,
    wasRefilled: result.wasRefilled,
    nextRefillDate: result.nextRefillDate,
  };
}

/**
 * Get user's credit info without triggering refill check
 */
export async function getUserCreditInfoAction() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const result = await getUserCredits(user.id);
  if (!result) {
    return { error: "Failed to get credit info" };
  }

  return {
    credits: result.credits,
    nextRefillDate: result.nextRefillDate,
    monthlyAllowance: result.monthlyAllowance,
  };
}

/**
 * Deduct credits for text processing operation
 */
export async function deductCreditsForTextAction(textLength: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const creditsNeeded = calculateCreditsForText(textLength);
  const result = await deductCredits(user.id, creditsNeeded);

  if (!result) {
    return { error: "Failed to deduct credits" };
  }

  if (!result.success) {
    return {
      error: result.errorMessage || "Insufficient credits",
      creditsNeeded,
      currentBalance: result.newBalance,
    };
  }

  return {
    success: true,
    creditsUsed: creditsNeeded,
    creditsRemaining: result.newBalance,
  };
}

/**
 * Refill credits to full monthly allowance (admin only)
 */
export async function refillCreditsAction() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Check if user is admin
  if (!isAdminUser(user.id)) {
    return { error: "Unauthorized" };
  }

  // Get current credit info to know the monthly allowance
  const creditInfo = await getUserCredits(user.id);
  if (!creditInfo) {
    return { error: "Failed to get credit info" };
  }

  // Update credits to full monthly allowance
  const { error } = await supabase
    .from("users")
    .update({ credits: creditInfo.monthlyAllowance })
    .eq("id", user.id);

  if (error) {
    return { error: "Failed to refill credits" };
  }

  return {
    success: true,
    credits: creditInfo.monthlyAllowance,
  };
}
