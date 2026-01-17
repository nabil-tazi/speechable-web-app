-- Add is_starred and last_opened columns to documents table
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS is_starred BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_opened TIMESTAMP WITH TIME ZONE;

-- Create index for faster queries on starred documents
CREATE INDEX IF NOT EXISTS idx_documents_is_starred ON documents(user_id, is_starred) WHERE is_starred = TRUE;

-- Create index for faster queries on recent documents
CREATE INDEX IF NOT EXISTS idx_documents_last_opened ON documents(user_id, last_opened DESC NULLS LAST);
