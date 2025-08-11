export interface UserProfile {
  id: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpdateUserProfileParams {
  display_name?: string;
}
