import type { AudioVersionWithSegments, AudioSegment } from "../types";

// State interface
export interface AudioState {
  audioVersions: AudioVersionWithSegments[];
  audioSegments: Record<string, AudioSegment[]>; // keyed by audio_version_id
  loading: boolean;
  error: string | null;
  uploadingAudio: Record<string, boolean>; // keyed by temporary or actual IDs
  processingAudio: Record<string, boolean>; // keyed by audio version or segment IDs
}

// Action types
export type AudioAction =
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SET_AUDIO_VERSIONS"; payload: AudioVersionWithSegments[] }
  | { type: "ADD_AUDIO_VERSIONS"; payload: AudioVersionWithSegments[] }
  | { type: "ADD_AUDIO_VERSION"; payload: AudioVersionWithSegments }
  | {
      type: "UPDATE_AUDIO_VERSION";
      payload: { id: string; updates: Partial<AudioVersionWithSegments> };
    }
  | { type: "REMOVE_AUDIO_VERSION"; payload: string }
  | {
      type: "SET_AUDIO_SEGMENTS";
      payload: { audioVersionId: string; segments: AudioSegment[] };
    }
  | { type: "ADD_AUDIO_SEGMENT"; payload: AudioSegment }
  | {
      type: "UPDATE_AUDIO_SEGMENT";
      payload: { id: string; updates: Partial<AudioSegment> };
    }
  | { type: "REMOVE_AUDIO_SEGMENT"; payload: string }
  | { type: "SET_UPLOADING_AUDIO"; payload: { id: string; uploading: boolean } }
  | {
      type: "SET_PROCESSING_AUDIO";
      payload: { id: string; processing: boolean };
    }
  | { type: "CLEAR_AUDIO" };

// Reducer function
export function audioReducer(
  state: AudioState,
  action: AudioAction
): AudioState {
  switch (action.type) {
    case "SET_LOADING":
      return {
        ...state,
        loading: action.payload,
      };

    case "SET_ERROR":
      return {
        ...state,
        error: action.payload,
        loading: false,
      };

    case "SET_AUDIO_VERSIONS":
      return {
        ...state,
        audioVersions: action.payload,
        loading: false,
        error: null,
      };

    case "ADD_AUDIO_VERSIONS":
      // Add multiple audio versions, avoiding duplicates
      const newVersions = action.payload.filter(
        (newVersion) => !state.audioVersions.some(
          (existingVersion) => existingVersion.id === newVersion.id
        )
      );
      
      return {
        ...state,
        audioVersions: [...state.audioVersions, ...newVersions],
        loading: false,
        error: null,
      };

    case "ADD_AUDIO_VERSION":
      // Check if the audio version already exists
      const existingVersionIndex = state.audioVersions.findIndex(
        (version) => version.id === action.payload.id
      );

      if (existingVersionIndex >= 0) {
        // Update existing version
        const updatedVersions = [...state.audioVersions];
        updatedVersions[existingVersionIndex] = action.payload;
        return {
          ...state,
          audioVersions: updatedVersions,
        };
      } else {
        // Add new version
        return {
          ...state,
          audioVersions: [...state.audioVersions, action.payload],
        };
      }

    case "UPDATE_AUDIO_VERSION":
      return {
        ...state,
        audioVersions: state.audioVersions.map((version) =>
          version.id === action.payload.id
            ? { ...version, ...action.payload.updates }
            : version
        ),
      };

    case "REMOVE_AUDIO_VERSION":
      return {
        ...state,
        audioVersions: state.audioVersions.filter(
          (version) => version.id !== action.payload
        ),
        // Also remove associated segments
        audioSegments: Object.fromEntries(
          Object.entries(state.audioSegments).filter(
            ([audioVersionId]) => audioVersionId !== action.payload
          )
        ),
      };

    case "SET_AUDIO_SEGMENTS":
      return {
        ...state,
        audioSegments: {
          ...state.audioSegments,
          [action.payload.audioVersionId]: action.payload.segments,
        },
      };

    case "ADD_AUDIO_SEGMENT":
      const audioVersionId = action.payload.audio_version_id;
      const currentSegments = state.audioSegments[audioVersionId] || [];

      // Check if segment already exists
      const existingSegmentIndex = currentSegments.findIndex(
        (segment) => segment.id === action.payload.id
      );

      let updatedSegments: AudioSegment[];
      if (existingSegmentIndex >= 0) {
        // Update existing segment
        updatedSegments = [...currentSegments];
        updatedSegments[existingSegmentIndex] = action.payload;
      } else {
        // Add new segment and sort by segment_number
        updatedSegments = [...currentSegments, action.payload].sort(
          (a, b) => a.segment_number - b.segment_number
        );
      }

      // Also update the segments in the corresponding audio version
      const updatedAudioVersions = state.audioVersions.map((version) =>
        version.id === audioVersionId
          ? { ...version, segments: updatedSegments }
          : version
      );

      return {
        ...state,
        audioVersions: updatedAudioVersions,
        audioSegments: {
          ...state.audioSegments,
          [audioVersionId]: updatedSegments,
        },
      };

    case "UPDATE_AUDIO_SEGMENT":
      // Find which audio version this segment belongs to
      let targetAudioVersionId: string | null = null;
      for (const [versionId, segments] of Object.entries(state.audioSegments)) {
        if (segments.some((segment) => segment.id === action.payload.id)) {
          targetAudioVersionId = versionId;
          break;
        }
      }

      if (!targetAudioVersionId) {
        return state; // Segment not found
      }

      const updatedSegmentsForUpdate = state.audioSegments[
        targetAudioVersionId
      ].map((segment) =>
        segment.id === action.payload.id
          ? { ...segment, ...action.payload.updates }
          : segment
      );

      // Update both audioSegments and audioVersions
      const updatedAudioVersionsForUpdate = state.audioVersions.map((version) =>
        version.id === targetAudioVersionId
          ? { ...version, segments: updatedSegmentsForUpdate }
          : version
      );

      return {
        ...state,
        audioVersions: updatedAudioVersionsForUpdate,
        audioSegments: {
          ...state.audioSegments,
          [targetAudioVersionId]: updatedSegmentsForUpdate,
        },
      };

    case "REMOVE_AUDIO_SEGMENT":
      // Find which audio version this segment belongs to
      let removeFromAudioVersionId: string | null = null;
      for (const [versionId, segments] of Object.entries(state.audioSegments)) {
        if (segments.some((segment) => segment.id === action.payload)) {
          removeFromAudioVersionId = versionId;
          break;
        }
      }

      if (!removeFromAudioVersionId) {
        return state; // Segment not found
      }

      const segmentsAfterRemoval = state.audioSegments[
        removeFromAudioVersionId
      ].filter((segment) => segment.id !== action.payload);

      // Update both audioSegments and audioVersions
      const audioVersionsAfterRemoval = state.audioVersions.map((version) =>
        version.id === removeFromAudioVersionId
          ? { ...version, segments: segmentsAfterRemoval }
          : version
      );

      return {
        ...state,
        audioVersions: audioVersionsAfterRemoval,
        audioSegments: {
          ...state.audioSegments,
          [removeFromAudioVersionId]: segmentsAfterRemoval,
        },
      };

    case "SET_UPLOADING_AUDIO":
      return {
        ...state,
        uploadingAudio: {
          ...state.uploadingAudio,
          [action.payload.id]: action.payload.uploading,
        },
      };

    case "SET_PROCESSING_AUDIO":
      return {
        ...state,
        processingAudio: {
          ...state.processingAudio,
          [action.payload.id]: action.payload.processing,
        },
      };

    case "CLEAR_AUDIO":
      return {
        audioVersions: [],
        audioSegments: {},
        loading: false,
        error: null,
        uploadingAudio: {},
        processingAudio: {},
      };

    default:
      return state;
  }
}
