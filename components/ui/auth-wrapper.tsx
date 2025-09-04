import Image from "next/image";
import { ReactNode } from "react";

interface AuthLayoutProps {
  children: ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <a href="#" className="flex items-center gap-2 self-center font-medium">
          <div className="flex gap-0 items-center">
            <Image src="/logo.svg" className="w-10" alt="logo" />
            <span className="text-xl">Speechable</span>
          </div>
        </a>
        {children}
      </div>
    </div>
  );
}
