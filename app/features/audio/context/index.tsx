"use client";

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import type {
  AudioVersion,
  AudioSegment,
  AudioVersionWithSegments,
} from "../types";
import {
  createAudioVersionAction,
  createAudioSegmentAction,
  getAudioVersionsAction,
  getAudioSegmentsAction,
  updateAudioVersionAction,
  updateAudioSegmentAction,
  deleteAudioVersionAction,
  deleteAudioSegmentAction,
} from "../actions";
import { type AudioAction, type AudioState, audioReducer } from "./reducer";
import { createClient } from "@/app/lib/supabase/client";

const supabase = createClient();
// Initial State
const emptyState: AudioState = {
  audioVersions: [],
  audioSegments: {},
  loading: true,
  error: null,
  uploadingAudio: {},
  processingAudio: {},
};

// Context Types
type AudioDispatch = (action: AudioAction) => void;

// Audio Actions Interface
interface AudioActions {
  createAudioVersion: (audioVersionData: {
    document_version_id: string;
    tts_model: string;
    voice_name: string;
    speed: number;
  }) => Promise<{
    success: boolean;
    audioVersion?: AudioVersionWithSegments;
    error?: string;
  }>;

  createAudioSegment: (
    segmentData: {
      audio_version_id: string;
      segment_number: number;
      section_title?: string;
      start_page?: number;
      end_page?: number;
      text_start_index?: number;
      text_end_index?: number;
      audio_duration?: number;
    },
    audioFile: File
  ) => Promise<{
    success: boolean;
    audioSegment?: AudioSegment;
    error?: string;
  }>;

  loadAudioVersions: (documentVersionId: string) => Promise<void>;

  loadAudioSegments: (audioVersionId: string) => Promise<void>;

  updateAudioVersion: (
    audioVersionId: string,
    updates: Partial<{
      tts_model: string;
      voice_name: string;
      speed: number;
    }>
  ) => Promise<{ success: boolean; error?: string }>;

  updateAudioSegment: (
    segmentId: string,
    updates: Partial<{
      segment_number: number;
      section_title?: string;
      start_page?: number;
      end_page?: number;
      text_start_index?: number;
      text_end_index?: number;
      audio_duration?: number;
    }>
  ) => Promise<{ success: boolean; error?: string }>;

  deleteAudioVersion: (
    audioVersionId: string
  ) => Promise<{ success: boolean; error?: string }>;

  deleteAudioSegment: (
    segmentId: string
  ) => Promise<{ success: boolean; error?: string }>;

  clearAudio: () => void;
}

// Contexts
const AudioStateContext = createContext<AudioState>(emptyState);
const AudioDispatchContext = createContext<AudioDispatch | undefined>(
  undefined
);
const AudioActionsContext = createContext<AudioActions | undefined>(undefined);

// Provider Props
interface AudioProviderProps {
  children: ReactNode;
}

// Provider Component
export function AudioProvider({ children }: AudioProviderProps) {
  const [state, dispatch] = useReducer(audioReducer, emptyState);
  const currentUserId = useRef<string | null>(null);

  // Actions
  const createAudioVersion = async (
    audioVersionData: Parameters<typeof createAudioVersionAction>[0]
  ) => {
    try {
      dispatch({ type: "SET_LOADING", payload: true });

      const { data, error } = await createAudioVersionAction(audioVersionData);

      if (error) {
        dispatch({ type: "SET_ERROR", payload: error });
        return { success: false, error };
      }

      if (data) {
        const audioVersionWithSegments: AudioVersionWithSegments = {
          ...data,
          segments: [],
        };
        dispatch({
          type: "ADD_AUDIO_VERSION",
          payload: audioVersionWithSegments,
        });
        return { success: true, audioVersion: audioVersionWithSegments };
      }

      return { success: false, error: "Unknown error occurred" };
    } catch (error) {
      const errorMessage = "Failed to create audio version";
      dispatch({ type: "SET_ERROR", payload: errorMessage });
      return { success: false, error: errorMessage };
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  };

  const createAudioSegment = async (
    segmentData: Parameters<typeof createAudioSegmentAction>[0],
    audioFile: File
  ) => {
    try {
      const segmentId = `temp-${Date.now()}`;
      dispatch({
        type: "SET_UPLOADING_AUDIO",
        payload: { id: segmentId, uploading: true },
      });

      const { data, error } = await createAudioSegmentAction(
        segmentData,
        audioFile
      );

      dispatch({
        type: "SET_UPLOADING_AUDIO",
        payload: { id: segmentId, uploading: false },
      });

      if (error) {
        return { success: false, error };
      }

      if (data) {
        dispatch({ type: "ADD_AUDIO_SEGMENT", payload: data });
        return { success: true, audioSegment: data };
      }

      return { success: false, error: "Unknown error occurred" };
    } catch (error) {
      return { success: false, error: "Failed to create audio segment" };
    }
  };

  const loadAudioVersions = async (documentVersionId: string) => {
    try {
      dispatch({ type: "SET_LOADING", payload: true });
      const { data, error } = await getAudioVersionsAction(documentVersionId);

      if (error) {
        dispatch({ type: "SET_ERROR", payload: error });
      } else {
        dispatch({ type: "SET_AUDIO_VERSIONS", payload: data || [] });
      }
    } catch (error) {
      dispatch({ type: "SET_ERROR", payload: "Failed to load audio versions" });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  };

  const loadAudioSegments = async (audioVersionId: string) => {
    try {
      const { data, error } = await getAudioSegmentsAction(audioVersionId);

      if (error) {
        dispatch({ type: "SET_ERROR", payload: error });
      } else {
        dispatch({
          type: "SET_AUDIO_SEGMENTS",
          payload: { audioVersionId, segments: data || [] },
        });
      }
    } catch (error) {
      dispatch({ type: "SET_ERROR", payload: "Failed to load audio segments" });
    }
  };

  const updateAudioVersion = async (
    audioVersionId: string,
    updates: Parameters<typeof updateAudioVersionAction>[1]
  ) => {
    try {
      dispatch({
        type: "SET_PROCESSING_AUDIO",
        payload: { id: audioVersionId, processing: true },
      });

      const { data, error } = await updateAudioVersionAction(
        audioVersionId,
        updates
      );

      dispatch({
        type: "SET_PROCESSING_AUDIO",
        payload: { id: audioVersionId, processing: false },
      });

      if (error) {
        return { success: false, error };
      }

      if (data) {
        dispatch({
          type: "UPDATE_AUDIO_VERSION",
          payload: { id: audioVersionId, updates: data },
        });
        return { success: true };
      }

      return { success: false, error: "Unknown error occurred" };
    } catch (error) {
      dispatch({
        type: "SET_PROCESSING_AUDIO",
        payload: { id: audioVersionId, processing: false },
      });
      return { success: false, error: "Failed to update audio version" };
    }
  };

  const updateAudioSegment = async (
    segmentId: string,
    updates: Parameters<typeof updateAudioSegmentAction>[1]
  ) => {
    try {
      dispatch({
        type: "SET_PROCESSING_AUDIO",
        payload: { id: segmentId, processing: true },
      });

      const { data, error } = await updateAudioSegmentAction(
        segmentId,
        updates
      );

      dispatch({
        type: "SET_PROCESSING_AUDIO",
        payload: { id: segmentId, processing: false },
      });

      if (error) {
        return { success: false, error };
      }

      if (data) {
        dispatch({
          type: "UPDATE_AUDIO_SEGMENT",
          payload: { id: segmentId, updates: data },
        });
        return { success: true };
      }

      return { success: false, error: "Unknown error occurred" };
    } catch (error) {
      dispatch({
        type: "SET_PROCESSING_AUDIO",
        payload: { id: segmentId, processing: false },
      });
      return { success: false, error: "Failed to update audio segment" };
    }
  };

  const deleteAudioVersion = async (audioVersionId: string) => {
    try {
      const { success, error } = await deleteAudioVersionAction(audioVersionId);

      if (error) {
        return { success: false, error };
      }

      if (success) {
        dispatch({ type: "REMOVE_AUDIO_VERSION", payload: audioVersionId });
        return { success: true };
      }

      return { success: false, error: "Unknown error occurred" };
    } catch (error) {
      return { success: false, error: "Failed to delete audio version" };
    }
  };

  const deleteAudioSegment = async (segmentId: string) => {
    try {
      const { success, error } = await deleteAudioSegmentAction(segmentId);

      if (error) {
        return { success: false, error };
      }

      if (success) {
        dispatch({ type: "REMOVE_AUDIO_SEGMENT", payload: segmentId });
        return { success: true };
      }

      return { success: false, error: "Unknown error occurred" };
    } catch (error) {
      return { success: false, error: "Failed to delete audio segment" };
    }
  };

  const clearAudio = () => {
    dispatch({ type: "CLEAR_AUDIO" });
  };

  // Define the actions object
  const actions: AudioActions = {
    createAudioVersion,
    createAudioSegment,
    loadAudioVersions,
    loadAudioSegments,
    updateAudioVersion,
    updateAudioSegment,
    deleteAudioVersion,
    deleteAudioSegment,
    clearAudio,
  };

  async function loadAllAudio() {
    try {
      dispatch({ type: "SET_LOADING", payload: true });
      console.log("loading all audio versions and segments");

      // First, get all documents with versions for the user
      const { data: documents, error: docsError } = await supabase
        .from("documents")
        .select(
          `
          id,
          document_versions!inner(
            id,
            audio_versions(
              *,
              segments:audio_segments(*)
            )
          )
        `
        )
        .eq("user_id", currentUserId.current);

      if (docsError) {
        dispatch({ type: "SET_ERROR", payload: docsError.message });
        return;
      }

      // Extract all audio versions with segments
      const allAudioVersions: AudioVersionWithSegments[] = [];
      const allAudioSegments: Record<string, AudioSegment[]> = {};

      documents?.forEach((doc: any) => {
        doc.document_versions.forEach((version: any) => {
          version.audio_versions.forEach((audioVersion: any) => {
            // Cast to proper types
            const typedAudioVersion = audioVersion as AudioVersion;
            const typedSegments = (audioVersion.segments ||
              []) as AudioSegment[];

            // Add to audio versions array
            allAudioVersions.push({
              ...typedAudioVersion,
              segments: typedSegments,
            });

            // Add segments to segments mapping
            if (typedSegments.length > 0) {
              allAudioSegments[typedAudioVersion.id] = typedSegments.sort(
                (a, b) => a.segment_number - b.segment_number
              );
            }
          });
        });
      });

      console.log("loaded audio versions:", allAudioVersions);
      console.log("loaded audio segments:", allAudioSegments);

      dispatch({ type: "SET_AUDIO_VERSIONS", payload: allAudioVersions });
      dispatch({
        type: "SET_AUDIO_SEGMENTS",
        payload: { audioVersionId: "ALL", segments: [] },
      });

      // Set all segments at once
      Object.entries(allAudioSegments).forEach(([audioVersionId, segments]) => {
        dispatch({
          type: "SET_AUDIO_SEGMENTS",
          payload: { audioVersionId, segments },
        });
      });
    } catch (error) {
      dispatch({ type: "SET_ERROR", payload: "Failed to load audio data" });
    }
  }

  // Auth state change handling
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Timeout recommended in Supabase doc
      // Allows other supabase function to run before this one
      setTimeout(async () => {
        const newUserId = session?.user?.id || null;

        if (event === "SIGNED_IN" && session?.user) {
          currentUserId.current = newUserId;
          await loadAllAudio();
        } else if (event === "SIGNED_OUT") {
          currentUserId.current = null;
          dispatch({ type: "CLEAR_AUDIO" });
        }
      }, 0);
    });

    // Check initial session
    const checkInitialSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        currentUserId.current = session.user.id;
        await loadAllAudio();
      } else {
        dispatch({ type: "SET_LOADING", payload: false });
      }
    };

    checkInitialSession();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Real-time subscriptions for audio changes
  useEffect(() => {
    const setupRealtimeSubscriptions = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      // Subscribe to audio_versions changes
      const audioVersionsChannel = supabase
        .channel("audio_versions_changes")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "audio_versions",
          },
          (payload) => {
            console.log("Audio version change received:", payload);

            switch (payload.eventType) {
              case "INSERT":
                const newAudioVersion: AudioVersionWithSegments = {
                  ...(payload.new as AudioVersion),
                  segments: [],
                };
                dispatch({
                  type: "ADD_AUDIO_VERSION",
                  payload: newAudioVersion,
                });
                break;
              case "UPDATE":
                dispatch({
                  type: "UPDATE_AUDIO_VERSION",
                  payload: {
                    id: payload.new.id,
                    updates: payload.new as Partial<AudioVersionWithSegments>,
                  },
                });
                break;
              case "DELETE":
                dispatch({
                  type: "REMOVE_AUDIO_VERSION",
                  payload: payload.old.id,
                });
                break;
            }
          }
        )
        .subscribe();

      // Subscribe to audio_segments changes
      const audioSegmentsChannel = supabase
        .channel("audio_segments_changes")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "audio_segments",
          },
          (payload) => {
            console.log("Audio segment change received:", payload);

            switch (payload.eventType) {
              case "INSERT":
                dispatch({
                  type: "ADD_AUDIO_SEGMENT",
                  payload: payload.new as AudioSegment,
                });
                break;
              case "UPDATE":
                dispatch({
                  type: "UPDATE_AUDIO_SEGMENT",
                  payload: {
                    id: payload.new.id,
                    updates: payload.new as Partial<AudioSegment>,
                  },
                });
                break;
              case "DELETE":
                dispatch({
                  type: "REMOVE_AUDIO_SEGMENT",
                  payload: payload.old.id,
                });
                break;
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(audioVersionsChannel);
        supabase.removeChannel(audioSegmentsChannel);
      };
    };

    setupRealtimeSubscriptions();
  }, []);

  return (
    <AudioStateContext.Provider value={state}>
      <AudioDispatchContext.Provider value={dispatch}>
        <AudioActionsContext.Provider value={actions}>
          {children}
        </AudioActionsContext.Provider>
      </AudioDispatchContext.Provider>
    </AudioStateContext.Provider>
  );
}

// Custom Hooks
export function useAudioState() {
  const state = useContext(AudioStateContext);
  if (state === undefined) {
    throw new Error("useAudioState must be used within an AudioProvider");
  }
  return state;
}

export function useAudioDispatch() {
  const dispatch = useContext(AudioDispatchContext);
  if (dispatch === undefined) {
    throw new Error("useAudioDispatch must be used within an AudioProvider");
  }
  return dispatch;
}

export function useAudioActions() {
  const actions = useContext(AudioActionsContext);
  if (actions === undefined) {
    throw new Error("useAudioActions must be used within an AudioProvider");
  }
  return actions;
}

// Convenience Hooks
export function useAudio() {
  const { audioVersions, audioSegments, loading, error } = useAudioState();
  return { audioVersions, audioSegments, loading, error };
}

export function useAudioVersions(documentVersionId?: string) {
  const { audioVersions, loading, error } = useAudioState();
  const { loadAudioVersions } = useAudioActions();

  const filteredVersions = documentVersionId
    ? audioVersions.filter(
        (version) => version.document_version_id === documentVersionId
      )
    : audioVersions;

  return {
    audioVersions: filteredVersions,
    loading,
    error,
    loadAudioVersions,
  };
}

export function useAudioSegments(audioVersionId?: string) {
  const { audioSegments, loading, error } = useAudioState();
  const { loadAudioSegments } = useAudioActions();

  const segments = audioVersionId ? audioSegments[audioVersionId] || [] : [];

  return {
    audioSegments: segments,
    loading,
    error,
    loadAudioSegments,
  };
}

export function useAudioUpload() {
  const { uploadingAudio, processingAudio } = useAudioState();
  const { createAudioVersion, createAudioSegment } = useAudioActions();

  return {
    createAudioVersion,
    createAudioSegment,
    uploadingAudio,
    processingAudio,
    isUploading: (id: string) => uploadingAudio[id] || false,
    isProcessing: (id: string) => processingAudio[id] || false,
  };
}
