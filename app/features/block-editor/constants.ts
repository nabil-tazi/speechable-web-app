export const NARRATION_READERS = [
  { id: "Narrator", label: "Narrator", shortLabel: "N" },
] as const;

export const CONVERSATION_READERS = [
  { id: "questioner", label: "Questioner", shortLabel: "Q" },
  { id: "expert", label: "Expert", shortLabel: "E" },
] as const;

export type NarrationReaderId = (typeof NARRATION_READERS)[number]["id"];
export type ConversationReaderId = (typeof CONVERSATION_READERS)[number]["id"];
