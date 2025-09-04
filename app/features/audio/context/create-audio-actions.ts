import type { AudioVersionWithSegments, AudioSegment } from "../types";
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
import type { AudioAction } from "../context/reducer";
import { CustomContextAction } from "@/app/features/shared/types/context-actions";

// Audio Actions Interface - Derived from server actions
interface AudioActions {
  createAudioVersion: (
    audioVersionData: Parameters<typeof createAudioVersionAction>[0]
  ) => Promise<{
    success: boolean;
    audioVersion?: AudioVersionWithSegments;
    error?: string;
  }>;

  createAudioSegment: (
    segmentData: Parameters<typeof createAudioSegmentAction>[0],
    audioFile: Parameters<typeof createAudioSegmentAction>[1]
  ) => Promise<{
    success: boolean;
    audioSegment?: AudioSegment;
    error?: string;
  }>;

  loadAudioVersions: (documentVersionId: string) => Promise<void>;
  loadAudioSegments: (audioVersionId: string) => Promise<void>;

  updateAudioVersion: CustomContextAction<
    [string, Parameters<typeof updateAudioVersionAction>[1]],
    { success: boolean; error?: string }
  >;

  updateAudioSegment: CustomContextAction<
    [string, Parameters<typeof updateAudioSegmentAction>[1]],
    { success: boolean; error?: string }
  >;

  deleteAudioVersion: CustomContextAction<
    [string],
    { success: boolean; error?: string }
  >;

  deleteAudioSegment: CustomContextAction<
    [string],
    { success: boolean; error?: string }
  >;

  clearAudio: () => void;
}

export function createAudioActions(dispatch: (action: AudioAction) => void): AudioActions {
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
        dispatch({ type: "ADD_AUDIO_VERSIONS", payload: data || [] });
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

  return {
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
}

export type { AudioActions };