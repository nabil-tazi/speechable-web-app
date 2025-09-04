"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { NavBar } from "@/components/nav-bar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { DocumentsProvider } from "../features/documents/context";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <DocumentsProvider autoLoad={false}>
      <div className="h-screen flex flex-col">
        <SidebarProvider className="flex-1 p-4">
          <AppSidebar />
          <SidebarInset>{children}</SidebarInset>
        </SidebarProvider>
      </div>
    </DocumentsProvider>
  );
}
