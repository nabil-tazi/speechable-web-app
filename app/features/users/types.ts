export interface UserProfile {
  id: string;
  display_name: string | null;
  profile_image_url: string | null;
  credits: number;
  plan_started_at: string;
  next_refill_date: string;
  monthly_credit_allowance: number;
  created_at: string;
  updated_at: string;
}

export interface UpdateUserProfileParams {
  display_name?: string;
  profile_image_url?: string; // Add this to update params
}
