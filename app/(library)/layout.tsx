"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { DocumentsProvider } from "../features/documents/context";
import { HeaderProvider } from "./components/header-context";
import { LibraryHeader } from "./components/library-header";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <DocumentsProvider>
      <HeaderProvider>
        <div className="h-screen flex flex-col">
          <LibraryHeader />
          {children}
          {/* <SidebarProvider className="flex-1 p-4">
            <AppSidebar />

            <SidebarInset className="overflow-hidden"></SidebarInset>
          </SidebarProvider> */}
        </div>
      </HeaderProvider>
    </DocumentsProvider>
  );
}
