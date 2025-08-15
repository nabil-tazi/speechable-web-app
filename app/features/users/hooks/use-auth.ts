"use client";
import { supabase } from "@/app/lib/supabase";
import { useRouter } from "next/navigation";

export function useAuth() {
  const router = useRouter();

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
      //   router.push("/"); // Redirect after signout
      router.refresh(); // Refresh to update server components
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  return { signOut };
}
