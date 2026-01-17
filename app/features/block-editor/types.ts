import type { Block, BlockInput } from "@/app/features/documents/types";
import type { Sentence } from "@/app/features/tts";

// History entry for undo/redo
export interface HistoryEntry {
  blocks: Block[];
  timestamp: number;
  description: string;
}

// Editor state
export interface EditorState {
  blocks: Block[];
  history: HistoryEntry[];
  historyIndex: number;
  isDirty: boolean;
  isSaving: boolean;
  lastSaved: Date | null;
  selectedBlockId: string | null;
  focusedBlockId: string | null;
}

// Editor actions
export type EditorAction =
  | { type: "SET_BLOCKS"; blocks: Block[] }
  | { type: "UPDATE_BLOCK"; blockId: string; updates: Partial<Block> }
  | { type: "ADD_BLOCK"; block: BlockInput; afterBlockId?: string; focus?: boolean }
  | { type: "DELETE_BLOCK"; blockId: string }
  | { type: "MOVE_BLOCK"; blockId: string; newOrder: number }
  | { type: "SPLIT_BLOCK"; blockId: string; contentBefore: string; contentAfter: string }
  | { type: "MERGE_WITH_PREVIOUS"; blockId: string }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SAVE_START" }
  | { type: "SAVE_SUCCESS"; savedAt: Date }
  | { type: "SAVE_ERROR" }
  | { type: "SELECT_BLOCK"; blockId: string | null }
  | { type: "FOCUS_BLOCK"; blockId: string | null }
  | { type: "RESET_HISTORY"; blocks: Block[] }
  | { type: "TOGGLE_BLOCK_DISABLED"; blockId: string };

// =====================
// Block Component Types
// =====================

// Word diff segment types
export type DiffSegment =
  | { type: "unchanged"; text: string }
  | { type: "removed"; text: string }
  | { type: "added"; text: string };

// AI action types
export type ActionType = "optimize" | "summarize" | "fix-spelling";

// Selection menu state
export interface SelectionMenu {
  visible: boolean;
  x: number;
  y: number;
  text: string;
  fixedX?: number;
  fixedY?: number;
}

// Pending replacement state for AI actions
export interface PendingReplacement {
  originalText: string;
  newText: string;
  action: ActionType;
  isSelection: boolean;
  selectionStart?: number;
  selectionEnd?: number;
  fullContent?: string; // Store the full block content at time of selection to avoid sync issues
}

// Props for the main BlockComponent
export interface BlockComponentProps {
  block: Block;
  isSelected: boolean;
  isFocused: boolean;
  isEditMode: boolean; // Global edit mode
  isConversation?: boolean; // Whether the version is a conversation (has multiple readers)
  sentences: Sentence[]; // Sentences belonging to this block
  currentPlayingIndex: number; // Global index of currently playing sentence
  isPlaybackOn: boolean;
  onSelect: () => void;
  onFocus: () => void;
  onSentenceClick: (globalIndex: number) => void;
}
