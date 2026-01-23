-- Migration: Drop processed_text from document_versions
-- Blocks is now the source of truth for version content
-- Document-level processed_text remains for AI regeneration

ALTER TABLE document_versions
DROP COLUMN IF EXISTS processed_text;
