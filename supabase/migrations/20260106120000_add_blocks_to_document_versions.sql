-- Migration: Add blocks to document_versions and processed_text to documents
-- This enables a Notion-like block-based content model

-- Step 1: Add processed_text column to documents table
-- This stores the original AI-generated processed_text for regenerating blocks
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS processed_text JSONB;

-- Step 2: Add blocks column to document_versions table
-- Blocks are the editable content units (text, heading1, heading2, heading3)
ALTER TABLE document_versions
ADD COLUMN IF NOT EXISTS blocks JSONB DEFAULT '[]'::jsonb;

-- Step 3: Add updated_at timestamp to document_versions for tracking changes
ALTER TABLE document_versions
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Step 4: Create index for faster block queries
CREATE INDEX IF NOT EXISTS idx_document_versions_blocks ON document_versions USING GIN (blocks);

-- Step 5: Create trigger function to update updated_at on document_versions
CREATE OR REPLACE FUNCTION update_document_version_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 6: Create trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS update_document_version_timestamp ON document_versions;
CREATE TRIGGER update_document_version_timestamp
  BEFORE UPDATE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION update_document_version_timestamp();

-- Note: Data migration skipped - the code converts processed_text to blocks on the fly
