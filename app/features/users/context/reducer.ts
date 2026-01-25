import { User } from "@supabase/supabase-js";
import { AuthState } from ".";
import { UserProfile } from "../types";

export type Action =
  | { type: "INIT_USER"; payload: { user: User; userProfile: UserProfile } }
  | { type: "CLEAR_USER" }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "UPDATE_PROFILE"; payload: UserProfile }
  | { type: "UPDATE_CREDITS"; payload: number };

export function userReducer(state: AuthState, action: Action): AuthState {
  switch (action.type) {
    case "INIT_USER":
      return {
        ...state,
        user: action.payload.user,
        userProfile: action.payload.userProfile,
        loading: false,
        error: null,
      };

    case "CLEAR_USER":
      return {
        ...state,
        user: null,
        userProfile: null,
        loading: false,
        error: null,
      };

    case "SET_LOADING":
      return {
        ...state,
        loading: action.payload,
      };

    case "SET_ERROR":
      return {
        ...state,
        error: action.payload,
        loading: false,
      };

    case "UPDATE_PROFILE":
      return {
        ...state,
        userProfile: action.payload,
      };

    case "UPDATE_CREDITS":
      if (!state.userProfile) return state;
      return {
        ...state,
        userProfile: {
          ...state.userProfile,
          credits: action.payload,
        },
      };

    default:
      return state;
  }
}
