// features/audio/types.ts

export interface WordTimestamp {
  end: number;
  start: number;
  word: string;
}

export interface AudioVersion {
  id: string;
  document_version_id: string;
  tts_model: string;
  speed: number;
  created_at: string;
}

export interface AudioSegment {
  id: string;
  audio_version_id: string;
  segment_number: number;
  section_title?: string;
  start_page?: number;
  end_page?: number;
  text_start_index?: number;
  text_end_index?: number;
  voice_name: string; // Moved from AudioVersion to AudioSegment
  audio_path: string;
  audio_duration?: number;
  audio_file_size: number;
  word_timestamps?: WordTimestamp[];
  created_at: string;
}

// Extended types with relationships
export interface AudioVersionWithSegments extends AudioVersion {
  segments: AudioSegment[];
}

export interface AudioSegmentWithVersion extends AudioSegment {
  audio_version: AudioVersion;
}
