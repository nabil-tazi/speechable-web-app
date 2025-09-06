"use client";

import React, { createContext, useContext, useState, ReactNode } from 'react';

interface DocumentVersion {
  id: string;
  version_name: string;
  created_at: string;
}

interface HeaderContent {
  documentTitle?: string;
  backUrl?: string;
  actions?: ReactNode;
  documentVersions?: DocumentVersion[];
  activeVersionId?: string;
  onVersionChange?: (versionId: string) => void;
}

interface HeaderContextType {
  content: HeaderContent;
  setContent: (content: HeaderContent) => void;
}

const HeaderContext = createContext<HeaderContextType | null>(null);

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<HeaderContent>({});

  return (
    <HeaderContext.Provider value={{ content, setContent }}>
      {children}
    </HeaderContext.Provider>
  );
}

export function useHeader() {
  const context = useContext(HeaderContext);
  if (!context) {
    throw new Error('useHeader must be used within a HeaderProvider');
  }
  return context;
}