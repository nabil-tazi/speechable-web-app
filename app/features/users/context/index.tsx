"use client";
import { createContext, useContext, useEffect, useReducer } from "react";

import type { UserProfile } from "../types";
import { userReducer, type Action } from "./reducer";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/app/lib/supabase";
import { getUserProfileAction } from "../actions";
import { usePathname, useRouter } from "next/navigation";

export interface AuthState {
  userProfile: UserProfile | null;
  user: User | null;
  loading: boolean;
  error: string | null;
}

const initialState: AuthState = {
  userProfile: null,
  user: null,
  loading: true,
  error: null,
};

type Dispatch = (action: Action) => void;
const UserStateContext = createContext<AuthState>(initialState);
const UserDispatchContext = createContext<Dispatch | undefined>(undefined);

type UserContextProviderProps = {
  children: React.ReactNode;
};

export function UserProvider({ children }: UserContextProviderProps) {
  const [state, dispatch] = useReducer(userReducer, initialState);
  const router = useRouter();
  const pathname = usePathname();

  async function loadUserProfile(user: User) {
    try {
      dispatch({ type: "SET_LOADING", payload: true });
      const userProfile = await getUserProfileAction(user.id);

      if (userProfile) {
        dispatch({ type: "INIT_USER", payload: { user, userProfile } });
      } else {
        dispatch({ type: "SET_ERROR", payload: "Failed to load user profile" });
      }
    } catch (error) {
      console.error("Error loading user profile:", error);
      dispatch({ type: "SET_ERROR", payload: "Failed to load user profile" });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  }

  useEffect(() => {
    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("Auth state changed:", event, session?.user?.id);

      if (event === "SIGNED_IN" && session?.user) {
        await loadUserProfile(session.user);

        // Redirect to /library only if on root path
        if (pathname === "/") {
          router.push("/library");
        }
      } else if (event === "SIGNED_OUT") {
        dispatch({ type: "CLEAR_USER" });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [pathname]);

  useEffect(() => {
    // Get initial session
    async function getInitialSession() {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          console.error("Error getting session:", error);
          dispatch({ type: "SET_ERROR", payload: error.message });
          dispatch({ type: "SET_LOADING", payload: false });
          return;
        }

        if (session?.user) {
          await loadUserProfile(session.user);
        } else {
          dispatch({ type: "CLEAR_USER" });
          dispatch({ type: "SET_LOADING", payload: false });
        }
      } catch (error) {
        console.error("Error in getInitialSession:", error);
        dispatch({
          type: "SET_ERROR",
          payload: "Failed to initialize session",
        });
        dispatch({ type: "SET_LOADING", payload: false });
      }
    }

    getInitialSession();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("Auth state changed:", event, session?.user?.id);

      if (event === "SIGNED_IN" && session?.user) {
        await loadUserProfile(session.user);
      } else if (event === "SIGNED_OUT") {
        dispatch({ type: "CLEAR_USER" });
      } else if (event === "TOKEN_REFRESHED" && session?.user) {
        // Optionally refresh user profile on token refresh
        await loadUserProfile(session.user);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <UserStateContext.Provider value={state}>
      <UserDispatchContext.Provider value={dispatch}>
        {children}
      </UserDispatchContext.Provider>
    </UserStateContext.Provider>
  );
}

export function useUserState() {
  const state = useContext(UserStateContext);
  if (state === undefined) {
    throw new Error("useUserState must be used within a UserProvider");
  }
  return state;
}

export function useUserDispatch() {
  const dispatch = useContext(UserDispatchContext);
  if (dispatch === undefined) {
    throw new Error("useUserDispatch must be used within a UserProvider");
  }
  return dispatch;
}
