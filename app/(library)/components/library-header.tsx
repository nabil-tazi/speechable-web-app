"use client";

import Image from "next/image";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import UserMenu from "@/app/components/user-menu";
import { useUser, useUserProfile } from "@/app/features/users/hooks/use-user";
import { useHeader } from "./header-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";

export function LibraryHeader() {
  const { user } = useUser();
  const { userProfile } = useUserProfile();
  const { content } = useHeader();

  return (
    <header className="flex items-center gap-2 border-b px-6 py-4">
      <div className="flex w-full items-center gap-3">
        {/* Logo - always show */}
        <Image
          src="/logo.svg"
          alt="Speechable"
          width={40}
          height={40}
          className="w-10"
        />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />

        {/* Breadcrumbs */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              {content.documentTitle ? (
                <BreadcrumbLink asChild>
                  <Link
                    href={content.backUrl || "/library"}
                    className="flex items-center space-x-2 text-gray-600 hover:text-gray-900"
                  >
                    Library
                  </Link>
                </BreadcrumbLink>
              ) : (
                <>Library</>
              )}
            </BreadcrumbItem>

            {content.documentTitle && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage className="truncate max-w-96">
                    {content.documentTitle}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}

            {/* {content.documentVersions &&
              content.documentVersions.length > 1 && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <Select
                      value={content.activeVersionId}
                      onValueChange={content.onVersionChange}
                    >
                      <SelectTrigger className=" text-gray-800">
                        <SelectValue placeholder="Select version" />
                      </SelectTrigger>
                      <SelectContent>
                        {content.documentVersions.map((version) => (
                          <SelectItem
                            key={version.id}
                            value={version.id}
                            className="cursor-pointer"
                          >
                            {version.version_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </BreadcrumbItem>
                </>
              )} */}

            {/* {content.documentVersions &&
              content.documentVersions.length === 1 && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage className="text-gray-600">
                      {content.documentVersions[0].version_name}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )} */}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Actions (right side) */}
      <div className="flex items-center gap-4 shrink-0">
        {content.actions}
        <Button variant="outline" asChild>
          <Link href="/create">
            <Upload className="w-4 h-4" />
            Upload
          </Link>
        </Button>
        <UserMenu user={user} userProfile={userProfile} />
      </div>
    </header>
  );
}
