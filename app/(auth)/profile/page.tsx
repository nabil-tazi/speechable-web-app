"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  getUserProfileClient,
  updateUserProfile,
} from "@/app/features/users/helpers";
import { UserProfile } from "@/app/features/users/types";

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      loadProfile();
    }
  }, [mounted]);

  const loadProfile = async () => {
    try {
      console.log("Loading profile...");
      const userProfile = await getUserProfileClient();
      console.log("Profile loaded:", userProfile);

      if (userProfile) {
        setProfile(userProfile);
        setDisplayName(userProfile.display_name || "");
      } else {
        console.log("No profile found, redirecting to login");
        router.push("/login");
      }
    } catch (err) {
      console.error("Error loading profile:", err);
      setError("Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      console.log(
        "Saving profile with display_name:",
        displayName.trim() || null
      );

      const updatedProfile = await updateUserProfile({
        display_name: displayName.trim(),
      });

      console.log("Profile updated:", updatedProfile);

      if (updatedProfile) {
        setProfile(updatedProfile);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err) {
      console.error("Error updating profile:", err);
      setError("Failed to update profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Don't render anything until mounted (prevents hydration issues)
  if (!mounted) {
    return null;
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <main className="flex flex-col items-center justify-center w-full flex-1 px-20 text-center">
        <h1 className="text-4xl font-bold mb-8">Edit Profile</h1>

        <div className="w-full max-w-md">
          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded">
              Profile updated successfully!
            </div>
          )}

          <form
            onSubmit={handleSave}
            className="bg-white shadow-md rounded px-8 pt-6 pb-8 mb-4"
          >
            <div className="mb-4">
              <label
                className="block text-gray-700 text-sm font-bold mb-2"
                htmlFor="displayName"
              >
                Display Name
              </label>
              <input
                className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                id="displayName"
                type="text"
                placeholder="Enter your display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={saving}
              />
              <p className="text-xs text-gray-600 mt-1">
                Leave empty to use your email as display name
              </p>
            </div>

            <div className="flex items-center justify-between">
              <button
                className="bg-blue-500 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
                type="submit"
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>

              <Link
                href="/"
                className="bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
              >
                Cancel
              </Link>
            </div>
          </form>

          {profile && (
            <div className="text-sm text-gray-600">
              <p>
                Account created:{" "}
                {new Date(profile.created_at).toLocaleDateString()}
              </p>
              <p>
                Last updated:{" "}
                {new Date(profile.updated_at).toLocaleDateString()}
              </p>
              <p className="mt-2">
                Current display name: {profile.display_name || "Not set"}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
