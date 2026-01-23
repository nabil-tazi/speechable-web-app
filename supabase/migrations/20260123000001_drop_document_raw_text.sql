-- Migration: Drop raw_text from documents
-- processed_text is now the source of truth for document content

ALTER TABLE documents
DROP COLUMN IF EXISTS raw_text;
