"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, Library, Plus, Star } from "lucide-react";

import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { useSidebarData } from "@/app/features/sidebar/context";

interface DocumentItem {
  id: string;
  title: string;
}

/**
 * Document section that adapts to collapsed/expanded state using CSS only.
 * The icon button is always rendered and stays in place.
 * The label text and document list are hidden via CSS when collapsed.
 */
function DocumentSection({
  icon: Icon,
  label,
  documents,
}: {
  icon: typeof Star;
  label: string;
  documents: DocumentItem[];
}) {
  const pathname = usePathname();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  if (documents.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarMenu>
        {/* Section header - clickable with hover card when collapsed, plain label when expanded */}
        <SidebarMenuItem>
          {isCollapsed ? (
            <HoverCard openDelay={50} closeDelay={100}>
              <HoverCardTrigger asChild>
                <SidebarMenuButton>
                  <Icon />
                  <span>{label}</span>
                </SidebarMenuButton>
              </HoverCardTrigger>
              <HoverCardContent
                side="right"
                align="start"
                sideOffset={16}
                className="w-56 p-2"
              >
                <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">
                  {label}
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {documents.map((doc) => (
                    <Link
                      key={doc.id}
                      href={`/library/${doc.id}`}
                      className={`block rounded-md px-2 py-1.5 text-sm hover:bg-accent truncate ${
                        pathname === `/library/${doc.id}` ? "bg-accent" : ""
                      }`}
                    >
                      {doc.title}
                    </Link>
                  ))}
                </div>
              </HoverCardContent>
            </HoverCard>
          ) : (
            <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
              <Icon className="size-4" />
              <span>{label}</span>
            </div>
          )}
        </SidebarMenuItem>

        {/* Document list - hidden when collapsed */}
        {documents.map((doc) => (
          <SidebarMenuItem
            key={doc.id}
            className="group-data-[collapsible=icon]:hidden"
          >
            <SidebarMenuButton
              asChild
              isActive={pathname === `/library/${doc.id}`}
            >
              <Link href={`/library/${doc.id}`}>
                <span className="truncate">{doc.title}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const { starredDocuments, recentDocuments } = useSidebarData();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon" {...props}>
      {/* Header */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="relative">
            {isCollapsed ? (
              <SidebarMenuButton className="!p-0 group-data-[collapsible=icon]:!p-0">
                <div className="flex aspect-square size-8 shrink-0 items-center justify-center">
                  <Image
                    src="/logo.svg"
                    alt="Speechable"
                    width={32}
                    height={32}
                  />
                </div>
              </SidebarMenuButton>
            ) : (
              <div className="flex items-center w-full">
                <Link href="/library" className="flex items-center">
                  <div className="flex aspect-square size-8 shrink-0 items-center justify-center">
                    <Image
                      src="/logo.svg"
                      alt="Speechable"
                      width={32}
                      height={32}
                    />
                  </div>
                  <span className="ml-1">Speechable</span>
                </Link>
                <SidebarTrigger className="ml-auto" />
              </div>
            )}
                      </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Primary Navigation */}
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname === "/library"}
                tooltip="Library"
                className="data-[active=true]:bg-gray-200 data-[active=true]:text-foreground"
              >
                <Link href="/library">
                  <Library />
                  <span>Library</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="New Document">
                <Link href="/library/new-document" className="group/newdoc">
                  <div className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform scale-125 group-data-[collapsible=icon]:group-hover/newdoc:scale-150">
                    <Plus
                      className="size-2.5 transition-transform duration-300 group-hover/newdoc:rotate-90"
                      strokeWidth={3}
                    />
                  </div>
                  <span>New Document</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarSeparator />

        {/* Document Sections */}
        <DocumentSection
          icon={Star}
          label="Starred"
          documents={starredDocuments}
        />
        <DocumentSection
          icon={Clock}
          label="Recents"
          documents={recentDocuments}
        />
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
