// Components
export { BlockEditor } from "./components/block-editor";
export { BlockComponent } from "./components/block";
export { SaveIndicator } from "./components/save-indicator";

// Context
export { EditorProvider, useEditor } from "./context/editor-provider";

// Utils
export {
  convertProcessedTextToBlocks,
  convertBlocksToProcessedText,
  convertTTSSectionsToBlocks,
} from "./utils/convert-to-blocks";
export { getDisabledBlockIds, isBlockDisabled } from "./utils/disabled-sections";

// Types
export type { EditorState, EditorAction, HistoryEntry } from "./types";
