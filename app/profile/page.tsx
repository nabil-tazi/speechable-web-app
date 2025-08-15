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
        router.push("/signin");
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center space-x-2">
          <svg
            className="animate-spin h-5 w-5 text-blue-600"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="text-gray-600">Loading profile...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex-shrink-0">
              <h1 className="text-xl font-semibold text-gray-900">
                Speechable
              </h1>
            </Link>
            <Link
              href="/"
              className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium transition-colors"
            >
              ← Back to Home
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-2xl font-bold text-gray-900">Edit Profile</h2>
            <p className="mt-1 text-sm text-gray-600">
              Update your personal information and preferences.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSave} className="px-6 py-6">
            {/* Alerts */}
            {error && (
              <div className="mb-6 rounded-md bg-red-50 border border-red-200 p-4">
                <div className="flex">
                  <svg
                    className="h-5 w-5 text-red-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                    />
                  </svg>
                  <div className="ml-3">
                    <p className="text-sm text-red-800">{error}</p>
                  </div>
                </div>
              </div>
            )}

            {success && (
              <div className="mb-6 rounded-md bg-green-50 border border-green-200 p-4">
                <div className="flex">
                  <svg
                    className="h-5 w-5 text-green-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div className="ml-3">
                    <p className="text-sm text-green-800">
                      Profile updated successfully!
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Form Fields */}
            <div className="space-y-6">
              <div>
                <label
                  htmlFor="displayName"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Display Name
                </label>
                <input
                  id="displayName"
                  type="text"
                  placeholder="Enter your display name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={saving}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-500 transition-colors"
                />
                <p className="mt-2 text-sm text-gray-500">
                  This is how your name will appear to other users. Leave empty
                  to use your email address.
                </p>
              </div>

              {/* Profile Info */}
              {profile && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-gray-900 mb-3">
                    Account Information
                  </h3>
                  <dl className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <dt className="text-gray-500">Current display name:</dt>
                      <dd className="text-gray-900 font-medium">
                        {profile.display_name || "Not set"}
                      </dd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <dt className="text-gray-500">Account created:</dt>
                      <dd className="text-gray-900">
                        {new Date(profile.created_at).toLocaleDateString()}
                      </dd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <dt className="text-gray-500">Last updated:</dt>
                      <dd className="text-gray-900">
                        {new Date(profile.updated_at).toLocaleDateString()}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="mt-8 flex justify-end space-x-3">
              <Link
                href="/"
                className="inline-flex justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? (
                  <div className="flex items-center">
                    <svg
                      className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Saving...
                  </div>
                ) : (
                  "Save Changes"
                )}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
