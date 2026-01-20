"use client";

import Link from "next/link";
import { Upload, Link as LinkIcon, Image, FileText } from "lucide-react";
import { ReactNode } from "react";

interface NewDocumentCardProps {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
}

function NewDocumentCard({ href, icon, title, description }: NewDocumentCardProps) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center text-center p-5 rounded-xl bg-white border border-gray-200 hover:border-brand-primary hover:shadow-md transition-all group"
    >
      <div className="w-11 h-11 rounded-full bg-brand-primary-lighter flex items-center justify-center group-hover:bg-brand-primary transition-colors mb-3">
        <span className="text-brand-primary group-hover:text-white transition-colors">
          {icon}
        </span>
      </div>
      <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
      <p className="text-gray-500 text-xs mt-1">{description}</p>
    </Link>
  );
}

export function HeroNewDocumentButton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <NewDocumentCard
        href="/library/new-document?mode=upload"
        icon={<Upload className="w-5 h-5" />}
        title="Upload"
        description="PDF, EPUB, Word"
      />
      <NewDocumentCard
        href="/library/new-document?mode=url"
        icon={<LinkIcon className="w-5 h-5" />}
        title="Import from URL"
        description="Web article or page"
      />
      <NewDocumentCard
        href="/library/new-document?mode=images"
        icon={<Image className="w-5 h-5" />}
        title="Extract from Images"
        description="Photos or screenshots"
      />
      <NewDocumentCard
        href="/library/new-document?mode=blank"
        icon={<FileText className="w-5 h-5" />}
        title="Start from Blank"
        description="Write or paste text"
      />
    </div>
  );
}
