import type { AudioVersionWithSegments } from "@/app/features/audio/types";

export interface Document {
  id: string;
  user_id: string;
  thumbnail_path?: string;
  raw_text?: string;
  document_type: string;
  language?: string;
  page_count?: number;
  file_size?: number;
  upload_date: string;
  updated_at: string;
  filename: string;
  original_filename: string;
  mime_type: string;
  metadata?: Record<string, any>;
}

export interface DocumentVersion {
  id: string;
  document_id: string;
  version_name?: string;
  processed_text: string;
  processing_type: string;
  processing_metadata?: Record<string, any>;
  created_at: string;
}

export interface UserStorageUsage {
  user_id: string;
  total_audio_bytes: number;
  total_thumbnail_bytes: number;
  max_audio_bytes: number;
  last_calculated_at: string;
}

// Extended types with relationships
export interface DocumentWithVersions extends Document {
  versions: DocumentVersion[];
}

export interface DocumentVersionWithAudio extends DocumentVersion {
  audio_versions: AudioVersionWithSegments[];
}
