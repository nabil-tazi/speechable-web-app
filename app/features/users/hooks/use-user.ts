import { useUserState } from "../context";

export function useUser() {
  const { user, loading } = useUserState();
  return { user, loading };
}

export function useUserProfile() {
  const { userProfile, loading, error } = useUserState();
  return { userProfile, loading, error };
}
