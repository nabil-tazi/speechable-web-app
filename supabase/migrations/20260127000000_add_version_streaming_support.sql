-- Add streaming support fields to document_versions table
ALTER TABLE document_versions
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed'
  CHECK (status IN ('pending', 'processing', 'completed', 'failed'));

ALTER TABLE document_versions
ADD COLUMN IF NOT EXISTS streaming_text TEXT DEFAULT '';

ALTER TABLE document_versions
ADD COLUMN IF NOT EXISTS processing_progress INTEGER DEFAULT 0;

ALTER TABLE document_versions
ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Enable realtime for document_versions table
ALTER PUBLICATION supabase_realtime ADD TABLE document_versions;
