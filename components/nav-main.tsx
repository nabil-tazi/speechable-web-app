"use client";

import {
  ChevronRight,
  DraftingCompass,
  LayoutDashboard,
  Library,
  List,
  ListVideo,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
  useGroupedDocuments,
  formatDocumentType,
} from "@/app/features/documents/context";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

type SubItem = {
  title: string;
  url: string;
  tag?: React.ReactNode;
};

type MenuItem = {
  title: string;
  url?: string; // Make URL optional for items that are just labels
  icon: LucideIcon;
  isActive: boolean;
  items?: SubItem[];
  toggleOnly?: boolean; // Flag for items where title acts as toggle only
};

export function NavMain() {
  const pathname = usePathname();
  const { groupedDocuments } = useGroupedDocuments();

  // Helper function to check if a path is active
  const isActive = (path: string) =>
    pathname === path || pathname.startsWith(path);

  console.log(isActive("/library"));

  // Create library sub-items from grouped documents (only categories that have documents)
  const librarySubItems: SubItem[] = Object.entries(groupedDocuments)
    .filter(([_, docs]) => docs.length > 0) // Only show categories with documents
    .map(([type, docs]) => ({
      title: formatDocumentType(type), // Remove count from title since we're showing it as a badge
      url: `/library?category=${type}`,
      tag: (
        <Badge variant="outline" className="bg-white">
          {docs.length}
        </Badge>
      ),
    }));

  const menuItems: MenuItem[] = [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboard,
      isActive: isActive("/dashboard"),
    },
    {
      title: "Library",
      icon: Library,
      isActive: isActive("/library"),
      toggleOnly: true, // Title acts as toggle only
      items: librarySubItems,
    },
    {
      title: "Playlist",
      url: "/playlist",
      icon: ListVideo,
      isActive: isActive("/playlist"),
    },
    {
      title: "Tools",
      // No URL for Tools - clicking the title toggles the items
      icon: DraftingCompass,
      isActive: isActive("/tools"),
      toggleOnly: true, // Title acts as toggle only
      items: [
        {
          title: "Studio",
          url: "/tools/studio",
        },
        {
          title: "Converter",
          url: "/tools/converter",
          tag: (
            <Badge className="bg-gradient-to-br from-blue-400 to-blue-600 text-white border-none">
              Free
            </Badge>
          ),
        },
      ],
    },
  ];

  return (
    <SidebarGroup>
      <SidebarMenu>
        {menuItems.map((item) => {
          // For items where title acts as toggle only (like Tools)
          if (item.toggleOnly) {
            return (
              <Collapsible key={item.title} asChild defaultOpen={true}>
                <SidebarMenuItem>
                  {/* Title acts as toggle trigger */}
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip={item.title}>
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  {/* Separate chevron trigger (also works as toggle) */}
                  <CollapsibleTrigger asChild>
                    <SidebarMenuAction className="data-[state=open]:rotate-90">
                      <ChevronRight />
                      <span className="sr-only">Toggle</span>
                    </SidebarMenuAction>
                  </CollapsibleTrigger>
                  {/* Collapsible sub-items */}
                  {item.items && item.items.length > 0 && (
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.items.map((subItem) => (
                          <SidebarMenuSubItem key={subItem.title}>
                            <SidebarMenuSubButton asChild>
                              <Link
                                href={subItem.url}
                                className="flex items-center justify-between w-full"
                              >
                                <span className="flex items-center gap-2">
                                  <span>{subItem.title}</span> {subItem.tag}
                                </span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  )}
                </SidebarMenuItem>
              </Collapsible>
            );
          }

          // Regular collapsible items
          return (
            <Collapsible key={item.title} asChild defaultOpen={true}>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip={item.title}>
                  <Link href={item.url!}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
                {item.items && item.items.length > 0 ? (
                  <>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuAction className="data-[state=open]:rotate-90">
                        <ChevronRight />
                        <span className="sr-only">Toggle</span>
                      </SidebarMenuAction>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.items.map((subItem) => (
                          <SidebarMenuSubItem key={subItem.title}>
                            <SidebarMenuSubButton asChild>
                              <Link
                                href={subItem.url}
                                className="flex items-center justify-between w-full"
                              >
                                <span className="flex items-center gap-2">
                                  <span>{subItem.title}</span> {subItem.tag}
                                </span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </>
                ) : null}
              </SidebarMenuItem>
            </Collapsible>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
