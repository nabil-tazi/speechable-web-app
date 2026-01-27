"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { createClient } from "@/app/lib/supabase/client";
import { useCredits } from "@/app/features/users/context";
import type { VersionStatus } from "../types";

const supabase = createClient();

export interface ProcessingVersion {
  versionId: string;
  documentId: string;
  documentTitle: string;
  documentThumbnail?: string;
  versionName: string;
  processingType: string; // "Natural", "Lecture", "Conversational", "Original"
  status: VersionStatus;
  progress: number;
  errorMessage?: string;
}

interface ProcessingContextValue {
  processingVersions: ProcessingVersion[];
  addProcessingVersion: (version: Omit<ProcessingVersion, "status" | "progress">) => void;
  removeProcessingVersion: (versionId: string) => void;
}

const ProcessingContext = createContext<ProcessingContextValue | null>(null);

export function useProcessingVersions() {
  const context = useContext(ProcessingContext);
  if (!context) {
    throw new Error("useProcessingVersions must be used within ProcessingProvider");
  }
  return context;
}

interface ProcessingProviderProps {
  children: React.ReactNode;
}

export function ProcessingProvider({ children }: ProcessingProviderProps) {
  const [processingVersions, setProcessingVersions] = useState<ProcessingVersion[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const { updateCredits } = useCredits();
  const [userId, setUserId] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Get user on mount
  useEffect(() => {
    async function getUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
      }
    }
    getUser();
  }, []);

  // Refresh credits from the database and update the UI
  const refreshCredits = useCallback(async () => {
    const { data } = await supabase
      .from("users")
      .select("credits")
      .eq("id", userId!)
      .single();
    if (data) {
      updateCredits(Number(data.credits));
    }
  }, [userId, updateCredits]);

  // Add a new processing version to track
  const addProcessingVersion = useCallback(
    (version: Omit<ProcessingVersion, "status" | "progress">) => {
      console.log("[ProcessingContext] Adding processing version:", version.versionId);
      setProcessingVersions((prev) => {
        // Don't add if already tracking
        if (prev.some((v) => v.versionId === version.versionId)) {
          return prev;
        }
        return [
          ...prev,
          {
            ...version,
            status: "pending",
            progress: 0,
          },
        ];
      });
    },
    []
  );

  // Dismiss a processing version from the toast (can reappear on completion/failure)
  const removeProcessingVersion = useCallback((versionId: string) => {
    setDismissedIds((prev) => new Set(prev).add(versionId));
  }, []);

  // Handle realtime updates
  const handleVersionUpdate = useCallback(
    (payload: any) => {
      const update = payload.new;
      const versionId = update.id;

      console.log("[ProcessingContext] Realtime update:", { versionId, status: update.status, progress: update.processing_progress });

      // Un-dismiss if status changed to completed or failed
      if (update.status === "completed" || update.status === "failed") {
        setDismissedIds((prev) => {
          if (!prev.has(versionId)) return prev;
          const next = new Set(prev);
          next.delete(versionId);
          return next;
        });
      }

      // Refresh credits on failure (refund happened server-side)
      if (update.status === "failed") {
        refreshCredits();
      }

      setProcessingVersions((prev) => {
        const index = prev.findIndex((v) => v.versionId === versionId);
        if (index === -1) return prev;

        const updated = [...prev];
        updated[index] = {
          ...updated[index],
          status: update.status ?? updated[index].status,
          progress: update.processing_progress ?? updated[index].progress,
          errorMessage: update.error_message,
        };

        return updated;
      });
    },
    [refreshCredits]
  );

  // Check for any existing processing versions on mount
  useEffect(() => {
    if (!userId) return;

    async function checkExistingProcessing() {
      const { data, error } = await supabase
        .from("document_versions")
        .select(`
          id,
          version_name,
          processing_type,
          status,
          processing_progress,
          error_message,
          document:documents!inner(
            id,
            title,
            thumbnail_path,
            user_id
          )
        `)
        .in("status", ["pending", "processing"])
        .eq("document.user_id", userId);

      if (error) {
        console.error("[ProcessingProvider] Error checking existing:", error);
        return;
      }

      if (data && data.length > 0) {
        const versions: ProcessingVersion[] = data.map((v: any) => ({
          versionId: v.id,
          documentId: v.document.id,
          documentTitle: v.document.title,
          documentThumbnail: v.document.thumbnail_path,
          versionName: v.version_name,
          processingType: getProcessingTypeName(v.processing_type),
          status: v.status,
          progress: v.processing_progress || 0,
          errorMessage: v.error_message,
        }));

        setProcessingVersions(versions);
      }
    }

    checkExistingProcessing();
  }, [userId]);

  // Set up realtime subscription
  useEffect(() => {
    if (!userId) return;

    // Clean up existing channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    console.log("[ProcessingContext] Setting up realtime subscription for user:", userId);

    const channel = supabase
      .channel("processing_versions")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "document_versions",
        },
        (payload) => {
          handleVersionUpdate(payload);
        }
      )
      .subscribe((status) => {
        console.log("[ProcessingContext] Subscription status:", status);
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [userId, handleVersionUpdate]);

  // Poll for updates on active processing versions (fallback for realtime)
  useEffect(() => {
    const activeVersions = processingVersions.filter(
      (v) => v.status === "pending" || v.status === "processing"
    );

    if (activeVersions.length === 0) return;

    const pollVersions = async () => {
      for (const version of activeVersions) {
        const { data, error } = await supabase
          .from("document_versions")
          .select("status, processing_progress, error_message")
          .eq("id", version.versionId)
          .single();

        if (error) {
          // Row was deleted — treat as failed
          if (error.code === "PGRST116") {
            console.log("[ProcessingContext] Version deleted (failed):", version.versionId);
            refreshCredits();
            setProcessingVersions((prev) => {
              const index = prev.findIndex((v) => v.versionId === version.versionId);
              if (index === -1) return prev;
              const updated = [...prev];
              updated[index] = { ...updated[index], status: "failed", errorMessage: "Processing failed.\nCredits have been refunded." };
              return updated;
            });
          } else {
            console.error("[ProcessingContext] Poll error:", error);
          }
          continue;
        }

        if (data && (data.status !== version.status || data.processing_progress !== version.progress)) {
          console.log("[ProcessingContext] Poll update:", { versionId: version.versionId, status: data.status, progress: data.processing_progress });

          // Un-dismiss if status changed to completed or failed
          if (data.status === "completed" || data.status === "failed") {
            setDismissedIds((prev) => {
              if (!prev.has(version.versionId)) return prev;
              const next = new Set(prev);
              next.delete(version.versionId);
              return next;
            });
          }

          // Refresh credits on failure (refund happened server-side)
          if (data.status === "failed" && version.status !== "failed") {
            refreshCredits();
          }

          setProcessingVersions((prev) => {
            const index = prev.findIndex((v) => v.versionId === version.versionId);
            if (index === -1) return prev;

            const updated = [...prev];
            updated[index] = {
              ...updated[index],
              status: data.status ?? updated[index].status,
              progress: data.processing_progress ?? updated[index].progress,
              errorMessage: data.error_message,
            };
            return updated;
          });
        }
      }
    };

    // Poll every 2 seconds
    const interval = setInterval(pollVersions, 2000);
    // Also poll immediately
    pollVersions();

    return () => clearInterval(interval);
  }, [processingVersions, refreshCredits]);


  // Clean up dismissed entries for versions that no longer exist
  useEffect(() => {
    const versionIds = new Set(processingVersions.map((v) => v.versionId));
    setDismissedIds((prev) => {
      const next = new Set([...prev].filter((id) => versionIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [processingVersions]);

  const visibleVersions = processingVersions.filter(
    (v) => !dismissedIds.has(v.versionId)
  );

  return (
    <ProcessingContext.Provider
      value={{
        processingVersions: visibleVersions,
        addProcessingVersion,
        removeProcessingVersion,
      }}
    >
      {children}
    </ProcessingContext.Provider>
  );
}

// Helper to convert processing_type number to name
function getProcessingTypeName(processingType: string): string {
  switch (processingType) {
    case "0":
      return "Original";
    case "1":
      return "Natural";
    case "2":
      return "Lecture";
    case "3":
      return "Conversational";
    default:
      return "Processing";
  }
}
