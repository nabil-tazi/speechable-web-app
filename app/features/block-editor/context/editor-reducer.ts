import { v4 as uuidv4 } from "uuid";
import type { Block } from "@/app/features/documents/types";
import type { EditorState, EditorAction, HistoryEntry } from "../types";

const MAX_HISTORY_SIZE = 50;

export const initialEditorState: EditorState = {
  blocks: [],
  history: [],
  historyIndex: -1,
  isDirty: false,
  isSaving: false,
  lastSaved: null,
  selectedBlockId: null,
  focusedBlockId: null,
};

export function editorReducer(
  state: EditorState,
  action: EditorAction
): EditorState {
  switch (action.type) {
    case "SET_BLOCKS": {
      return {
        ...state,
        blocks: action.blocks,
        isDirty: false,
      };
    }

    case "UPDATE_BLOCK": {
      const blockIndex = state.blocks.findIndex((b) => b.id === action.blockId);
      if (blockIndex === -1) return state;

      const oldBlock = state.blocks[blockIndex];
      const contentChanged =
        action.updates.content !== undefined &&
        action.updates.content !== oldBlock.content;

      const updatedBlock: Block = {
        ...oldBlock,
        ...action.updates,
        updated_at: new Date().toISOString(),
        // Mark audio as stale if content changed
        audio_stale: contentChanged ? true : oldBlock.audio_stale,
      };

      const newBlocks = [...state.blocks];
      newBlocks[blockIndex] = updatedBlock;

      return pushToHistory(state, newBlocks, `Update block ${action.blockId}`);
    }

    case "ADD_BLOCK": {
      const now = new Date().toISOString();
      const newBlock: Block = {
        id: uuidv4(),
        type: action.block.type,
        content: action.block.content,
        reader_id: action.block.reader_id || "Narrator",
        order: 0, // Will be recalculated
        audio_stale: true,
        created_at: now,
        updated_at: now,
      };

      let newBlocks: Block[];
      if (action.afterBlockId) {
        const afterIndex = state.blocks.findIndex(
          (b) => b.id === action.afterBlockId
        );
        const insertIndex =
          afterIndex === -1 ? state.blocks.length : afterIndex + 1;
        newBlocks = [
          ...state.blocks.slice(0, insertIndex),
          newBlock,
          ...state.blocks.slice(insertIndex),
        ];
      } else {
        newBlocks = [...state.blocks, newBlock];
      }

      // Recalculate order
      newBlocks = newBlocks.map((block, index) => ({
        ...block,
        order: index,
      }));

      const newState = pushToHistory(state, newBlocks, "Add block");

      // Focus the new block if requested
      if (action.focus) {
        return {
          ...newState,
          focusedBlockId: newBlock.id,
        };
      }

      return newState;
    }

    case "DELETE_BLOCK": {
      const newBlocks = state.blocks
        .filter((b) => b.id !== action.blockId)
        .map((block, index) => ({ ...block, order: index }));

      return pushToHistory(
        state,
        newBlocks,
        `Delete block ${action.blockId}`
      );
    }

    case "MOVE_BLOCK": {
      const blockIndex = state.blocks.findIndex((b) => b.id === action.blockId);
      if (blockIndex === -1) return state;

      const block = state.blocks[blockIndex];
      const newBlocks = state.blocks.filter((b) => b.id !== action.blockId);
      newBlocks.splice(action.newOrder, 0, block);

      // Recalculate order
      const reorderedBlocks = newBlocks.map((b, index) => ({
        ...b,
        order: index,
      }));

      return pushToHistory(
        state,
        reorderedBlocks,
        `Move block ${action.blockId}`
      );
    }

    case "SPLIT_BLOCK": {
      const blockIndex = state.blocks.findIndex((b) => b.id === action.blockId);
      if (blockIndex === -1) return state;

      const now = new Date().toISOString();
      const originalBlock = state.blocks[blockIndex];

      // Update original block with content before cursor
      const updatedBlock: Block = {
        ...originalBlock,
        content: action.contentBefore,
        updated_at: now,
        audio_stale: true,
      };

      // Create new block with content after cursor
      const newBlock: Block = {
        id: uuidv4(),
        type: "text",
        content: action.contentAfter,
        reader_id: originalBlock.reader_id,
        order: 0, // Will be recalculated
        audio_stale: true,
        created_at: now,
        updated_at: now,
      };

      // Insert new block after original
      const sortedBlocks = [...state.blocks].sort((a, b) => a.order - b.order);
      const sortedIndex = sortedBlocks.findIndex((b) => b.id === action.blockId);

      let newBlocks = [
        ...sortedBlocks.slice(0, sortedIndex),
        updatedBlock,
        newBlock,
        ...sortedBlocks.slice(sortedIndex + 1),
      ];

      // Recalculate order
      newBlocks = newBlocks.map((block, index) => ({
        ...block,
        order: index,
      }));

      return {
        ...pushToHistory(state, newBlocks, "Split block"),
        focusedBlockId: newBlock.id,
      };
    }

    case "MERGE_WITH_PREVIOUS": {
      const sortedBlocks = [...state.blocks].sort((a, b) => a.order - b.order);
      const currentIndex = sortedBlocks.findIndex((b) => b.id === action.blockId);

      // Can't merge if it's the first block
      if (currentIndex <= 0) return state;

      const currentBlock = sortedBlocks[currentIndex];
      const prevBlock = sortedBlocks[currentIndex - 1];
      const now = new Date().toISOString();

      // Update previous block with merged content
      const updatedPrevBlock: Block = {
        ...prevBlock,
        content: prevBlock.content + currentBlock.content,
        updated_at: now,
        audio_stale: true,
      };

      // Remove current block and update previous
      let newBlocks = sortedBlocks
        .filter((b) => b.id !== action.blockId)
        .map((b) => (b.id === prevBlock.id ? updatedPrevBlock : b));

      // Recalculate order
      newBlocks = newBlocks.map((block, index) => ({
        ...block,
        order: index,
      }));

      return {
        ...pushToHistory(state, newBlocks, "Merge blocks"),
        focusedBlockId: prevBlock.id,
      };
    }

    case "UNDO": {
      if (state.historyIndex <= 0) return state;
      const newIndex = state.historyIndex - 1;
      return {
        ...state,
        blocks: state.history[newIndex].blocks,
        historyIndex: newIndex,
        isDirty: true,
      };
    }

    case "REDO": {
      if (state.historyIndex >= state.history.length - 1) return state;
      const newIndex = state.historyIndex + 1;
      return {
        ...state,
        blocks: state.history[newIndex].blocks,
        historyIndex: newIndex,
        isDirty: true,
      };
    }

    case "SAVE_START":
      return { ...state, isSaving: true };

    case "SAVE_SUCCESS":
      return {
        ...state,
        isSaving: false,
        isDirty: false,
        lastSaved: action.savedAt,
      };

    case "SAVE_ERROR":
      return { ...state, isSaving: false };

    case "SELECT_BLOCK":
      return { ...state, selectedBlockId: action.blockId };

    case "FOCUS_BLOCK":
      return { ...state, focusedBlockId: action.blockId };

    case "RESET_HISTORY": {
      const entry: HistoryEntry = {
        blocks: action.blocks,
        timestamp: Date.now(),
        description: "Initial state",
      };
      return {
        ...state,
        blocks: action.blocks,
        history: [entry],
        historyIndex: 0,
        isDirty: false,
      };
    }

    case "TOGGLE_BLOCK_DISABLED": {
      const blockIndex = state.blocks.findIndex((b) => b.id === action.blockId);
      if (blockIndex === -1) return state;

      const block = state.blocks[blockIndex];
      const updatedBlock: Block = {
        ...block,
        disabled: !block.disabled,
        updated_at: new Date().toISOString(),
      };

      const newBlocks = [...state.blocks];
      newBlocks[blockIndex] = updatedBlock;

      return pushToHistory(
        state,
        newBlocks,
        `Toggle disabled for block ${action.blockId}`
      );
    }

    default:
      return state;
  }
}

function pushToHistory(
  state: EditorState,
  newBlocks: Block[],
  description: string
): EditorState {
  const entry: HistoryEntry = {
    blocks: newBlocks,
    timestamp: Date.now(),
    description,
  };

  // Remove any redo history
  const newHistory = state.history.slice(0, state.historyIndex + 1);
  newHistory.push(entry);

  // Limit history size
  if (newHistory.length > MAX_HISTORY_SIZE) {
    newHistory.shift();
  }

  return {
    ...state,
    blocks: newBlocks,
    history: newHistory,
    historyIndex: newHistory.length - 1,
    isDirty: true,
  };
}
