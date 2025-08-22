// TypeScript types
export type VoiceQuality = {
  target?: string;
  training?: string;
  overall?: string;
};

export type VoiceModels = {
  kokoro: string | null;
  lemonfox: string | null;
};

export type Voice = {
  name: string;
  gender: Gender;
  accent?: Accent;
  models: VoiceModels;
  traits?: string;
  quality?: VoiceQuality;
  source?: string;
};

export type Language = "en" | "ja" | "zh" | "es" | "fr" | "hi" | "it" | "pt";
export type Model = "kokoro" | "lemonfox";
export type Gender = "male" | "female" | "";
export type Accent = "us" | "gb" | "br";

export type UnifiedVoices = Record<Language, Voice[]>;
