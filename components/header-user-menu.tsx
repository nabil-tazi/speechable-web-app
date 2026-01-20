"use client";

import { LogOut, User, Bug } from "lucide-react";
import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  useUser,
  useUserProfile,
} from "@/app/features/users/hooks/use-user";
import { useAuth } from "@/app/features/users/hooks/use-auth";
import { isAdminUser } from "@/app/constants/admin";
import { useAppSettings } from "@/app/features/app-settings/context";

export function HeaderUserMenu() {
  const { user } = useUser();
  const { userProfile } = useUserProfile();
  const { signOut } = useAuth();
  const { debugMode, toggleDebugMode } = useAppSettings();
  const isAdmin = isAdminUser(user?.id);

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
      userProfile?.display_name || user?.user_metadata?.full_name || user?.email || "User"
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-full hover:bg-accent p-0.5 transition-colors">
          <Avatar className="h-7 w-7">
            <AvatarImage src={avatarUrl || undefined} alt={displayName} />
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-56 rounded-lg"
        align="end"
        sideOffset={8}
      >
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
            <Avatar className="h-8 w-8 rounded-lg">
              <AvatarImage src={avatarUrl || undefined} alt={displayName} />
              <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{displayName}</span>
              <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/profile">
              <User className="mr-2 h-4 w-4" />
              Profile
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {isAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <div className="flex items-center justify-between px-2 py-1.5">
                <div className="flex items-center">
                  <Bug className="mr-2 h-4 w-4" />
                  <span className="text-sm">Debug Mode</span>
                </div>
                <Switch
                  checked={debugMode}
                  onCheckedChange={toggleDebugMode}
                />
              </div>
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
