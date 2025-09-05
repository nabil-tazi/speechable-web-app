"use client";

import UserMenu from "@/app/components/user-menu";
import { useUserState } from "@/app/features/users/context";
import { cn } from "@/lib/utils";
import { Library, History, DiamondPlus } from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

export function NavBar() {
  const pathname = usePathname();
  const { user, userProfile } = useUserState();

  const menuItems = [
    {
      icon: Library,
      label: "Library",
      href: "/library",
    },
    {
      icon: History,
      label: "History",
      href: "/history",
    },
    {
      icon: DiamondPlus,
      label: "Create",
      href: "/create",
    },
  ];
  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
      )}
    >
      <div className="flex h-20 items-center justify-between px-6 md:px-8">
        {/* Left: App Logo */}
        <div className="flex items-center">
          <Link href="/" className="flex gap-0 items-center">
            <Image src="/logo.svg" alt="Speechable" width={40} height={40} className="w-10" />
            <span className="text-xl font-medium">Speechable</span>
          </Link>
        </div>

        {/* Middle: Navigation Menu */}
        <nav className="flex items-center">
          <div className="flex items-center space-x-8">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center gap-1 p-2 rounded-md transition-colors",
                    isActive
                      ? "text-[var(--color-brand-primary-dark)]"
                      : "hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon className="h-6 w-6" />
                  <span className="text-xs font-medium">{item.label}</span>
                </a>
              );
            })}
          </div>
        </nav>

        {/* Right: User Menu */}
        <div className="flex items-center">
          <UserMenu user={user} userProfile={userProfile} />
        </div>
      </div>
    </header>
  );
}
