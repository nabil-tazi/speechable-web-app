import { DocumentType } from "@/app/features/documents/types";

export const DOCUMENT_TYPES: Record<DocumentType, string> = {
  academic: "Academic Paper",
  legal: "Legal Document",
  financial: "Financial Document",
  technical: "Technical Document",
  manual: "Manual",
  news: "News Article",
  literature: "Literature",
  general: "Unknown type",
} as const;
