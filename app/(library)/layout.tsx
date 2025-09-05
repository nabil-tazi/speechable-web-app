"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { DocumentsProvider } from "../features/documents/context";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <DocumentsProvider>
      <div className="h-screen flex flex-col">
        <SidebarProvider className="flex-1 p-4">
          <AppSidebar />
          <SidebarInset className="overflow-hidden">{children}</SidebarInset>
        </SidebarProvider>
      </div>
    </DocumentsProvider>
  );
}
