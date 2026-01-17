"use client";

import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { SidebarDataProvider } from "@/app/features/sidebar/context";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SidebarDataProvider>
      <SidebarProvider defaultOpen={true}>
        <AppSidebar />
        <SidebarInset className="max-h-svh overflow-hidden">
          <div className="flex-1 overflow-auto min-h-0" data-scroll-container="true">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </SidebarDataProvider>
  );
}
