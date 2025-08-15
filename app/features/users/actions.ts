"use server";
import { getUserProfile } from "./models"; // ✅ Server-side models

export async function getUserProfileAction(uid: string) {
  return await getUserProfile(uid);
}
