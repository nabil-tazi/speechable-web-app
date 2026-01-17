"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  getStarredDocumentsAction,
  getRecentDocumentsAction,
} from "@/app/features/documents/actions";

interface SidebarDocument {
  id: string;
  title: string;
  last_opened?: string;
}

interface SidebarContextType {
  starredDocuments: SidebarDocument[];
  recentDocuments: SidebarDocument[];
  loading: boolean;
  refreshStarred: () => Promise<void>;
  refreshRecent: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

const SidebarContext = createContext<SidebarContextType | null>(null);

export function SidebarDataProvider({ children }: { children: ReactNode }) {
  const [starredDocuments, setStarredDocuments] = useState<SidebarDocument[]>(
    []
  );
  const [recentDocuments, setRecentDocuments] = useState<SidebarDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshStarred = useCallback(async () => {
    const { data } = await getStarredDocumentsAction();
    if (data) {
      setStarredDocuments(data);
    }
  }, []);

  const refreshRecent = useCallback(async () => {
    const { data } = await getRecentDocumentsAction(10);
    if (data) {
      setRecentDocuments(data);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([refreshStarred(), refreshRecent()]);
    setLoading(false);
  }, [refreshStarred, refreshRecent]);

  // Fetch on mount
  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  return (
    <SidebarContext.Provider
      value={{
        starredDocuments,
        recentDocuments,
        loading,
        refreshStarred,
        refreshRecent,
        refreshAll,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebarData() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebarData must be used within SidebarDataProvider");
  }
  return context;
}
