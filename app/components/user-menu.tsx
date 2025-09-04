"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { useAuth } from "../features/users/hooks/use-auth";
import { UserProfile } from "../features/users/types";
import Image from "next/image";

interface UserMenuProps {
  user: User | null;
  userProfile: UserProfile | null;
}

export default function UserMenu({ user, userProfile }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { signOut } = useAuth();

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Get user avatar - prioritize profile image, then user metadata, then default
  const getAvatarUrl = () => {
    if (userProfile?.profile_image_url) {
      return userProfile.profile_image_url;
    }
    if (user?.user_metadata?.avatar_url) {
      return user.user_metadata.avatar_url;
    }
    return null;
  };

  const getDisplayName = () => {
    return (
      userProfile?.display_name || user?.user_metadata?.full_name || user?.email
    );
  };

  const getInitials = () => {
    const name = userProfile?.display_name || user?.user_metadata?.full_name;
    if (name) {
      return name
        .split(" ")
        .map((part: string) => part.charAt(0))
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    return user?.email?.charAt(0).toUpperCase() || "U";
  };

  const avatarUrl = getAvatarUrl();
  const displayName = getDisplayName();
  const initials = getInitials();

  return (
    <div className="relative" ref={menuRef}>
      {/* Avatar Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center space-x-3 text-sm rounded-full transition-all duration-200 hover:bg-gray-100 p-1 cursor-pointer ${
          isOpen ? "bg-gray-100" : ""
        }`}
      >
        {avatarUrl ? (
          <Image
            className="h-8 w-8 rounded-full object-cover border-2 border-gray-200"
            src={avatarUrl}
            alt={displayName}
          />
        ) : (
          <div className="h-8 w-8 rounded-full bg-brand-primary flex items-center justify-center text-white text-xs font-medium border-2 border-gray-200">
            {initials}
          </div>
        )}

        {/* Chevron */}
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
          {/* User Info Header */}
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center space-x-3">
              {avatarUrl ? (
                <Image
                  className="h-10 w-10 rounded-full object-cover"
                  src={avatarUrl}
                  alt={displayName}
                />
              ) : (
                <div className="h-10 w-10 rounded-full bg-brand-primary flex items-center justify-center text-white text-sm font-medium">
                  {initials}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {displayName}
                </p>
                <p className="text-xs text-gray-500 truncate">{user?.email}</p>
              </div>
            </div>
          </div>

          {/* Menu Items */}
          <div className="py-1">
            <Link
              href="/profile"
              onClick={() => setIsOpen(false)}
              className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg
                className="mr-3 h-4 w-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
              Edit Profile
            </Link>

            <Link
              href="/settings"
              onClick={() => setIsOpen(false)}
              className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg
                className="mr-3 h-4 w-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              Settings
            </Link>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-100 my-1"></div>

          {/* Sign Out */}
          <button
            className="flex items-center w-full px-4 py-2 text-sm text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
            onClick={signOut}
          >
            <svg
              className="mr-3 h-4 w-4 text-red-700"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
