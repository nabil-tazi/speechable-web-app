"use client";

import { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  UndoDot,
  RedoDot,
  AlertCircle,
  Leaf,
  ChevronDown,
  Play,
  Check,
  Info,
  MessageSquareText,
  MessageSquareHeart,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { DownloadButton } from "./download-button";
import { SpeedSelector } from "@/app/features/documents/components/speed-selector";
import { usePlayback } from "../hooks/use-playback";
import { useSentences } from "../hooks/use-sentences";
import { useVoiceConfig } from "../hooks/use-voice-config";
import { useGeneration } from "../hooks/use-generation";
import { useGain } from "../hooks/use-gain";
import type { VoiceQuality } from "../context/tts-reducer";

// Languages with their voices
const LANGUAGES = [
  {
    code: "en",
    name: "English",
    groups: [
      {
        label: "American",
        voices: [
          { id: "af_heart", name: "Heart", gender: "♀", grade: "A" },
          { id: "af_bella", name: "Bella", gender: "♀", grade: "A-" },
          { id: "af_nicole", name: "Nicole", gender: "♀", grade: "B-" },
          { id: "af_aoede", name: "Aoede", gender: "♀", grade: "C+" },
          { id: "af_kore", name: "Kore", gender: "♀", grade: "C+" },
          { id: "af_sarah", name: "Sarah", gender: "♀", grade: "C+" },
          { id: "af_nova", name: "Nova", gender: "♀", grade: "C" },
          { id: "af_alloy", name: "Alloy", gender: "♀", grade: "C" },
          { id: "af_sky", name: "Sky", gender: "♀", grade: "C-" },
          { id: "af_jessica", name: "Jessica", gender: "♀", grade: "D" },
          { id: "af_river", name: "River", gender: "♀", grade: "D" },
          { id: "am_fenrir", name: "Fenrir", gender: "♂", grade: "C+" },
          { id: "am_michael", name: "Michael", gender: "♂", grade: "C+" },
          { id: "am_puck", name: "Puck", gender: "♂", grade: "C+" },
          { id: "am_echo", name: "Echo", gender: "♂", grade: "D" },
          { id: "am_eric", name: "Eric", gender: "♂", grade: "D" },
          { id: "am_liam", name: "Liam", gender: "♂", grade: "D" },
          { id: "am_onyx", name: "Onyx", gender: "♂", grade: "D" },
          { id: "am_adam", name: "Adam", gender: "♂", grade: "F+" },
          { id: "am_santa", name: "Santa", gender: "♂", grade: "D-" },
        ],
      },
      {
        label: "British",
        voices: [
          { id: "bf_emma", name: "Emma", gender: "♀", grade: "B-" },
          { id: "bf_isabella", name: "Isabella", gender: "♀", grade: "C" },
          { id: "bf_alice", name: "Alice", gender: "♀", grade: "D" },
          { id: "bf_lily", name: "Lily", gender: "♀", grade: "D" },
          { id: "bm_george", name: "George", gender: "♂", grade: "C" },
          { id: "bm_fable", name: "Fable", gender: "♂", grade: "C" },
          { id: "bm_lewis", name: "Lewis", gender: "♂", grade: "D+" },
          { id: "bm_daniel", name: "Daniel", gender: "♂", grade: "D" },
        ],
      },
    ],
  },
  {
    code: "fr",
    name: "Français",
    groups: [
      {
        label: "France",
        voices: [{ id: "ff_siwis", name: "Siwis", gender: "♀", grade: "B" }],
      },
    ],
  },
  {
    code: "ja",
    name: "日本語",
    groups: [
      {
        label: "Japan",
        voices: [
          { id: "jf_alpha", name: "Alpha", gender: "♀", grade: "B" },
          { id: "jf_gongitsune", name: "Gongitsune", gender: "♀", grade: "B" },
          { id: "jf_nezumi", name: "Nezumi", gender: "♀", grade: "B" },
          { id: "jf_tebukuro", name: "Tebukuro", gender: "♀", grade: "B" },
          { id: "jm_kumo", name: "Kumo", gender: "♂", grade: "B" },
        ],
      },
    ],
  },
  {
    code: "ko",
    name: "한국어",
    groups: [
      {
        label: "Korea",
        voices: [
          { id: "kf_jisoo", name: "Jisoo", gender: "♀", grade: "B" },
          { id: "kf_sara", name: "Sara", gender: "♀", grade: "B" },
          { id: "km_dongwoo", name: "Dongwoo", gender: "♂", grade: "B" },
        ],
      },
    ],
  },
  {
    code: "zh",
    name: "中文",
    groups: [
      {
        label: "Mandarin",
        voices: [
          { id: "zf_xiaobei", name: "Xiaobei", gender: "♀", grade: "B" },
          { id: "zf_xiaoni", name: "Xiaoni", gender: "♀", grade: "B" },
          { id: "zf_xiaoxiao", name: "Xiaoxiao", gender: "♀", grade: "B" },
          { id: "zf_xiaoyi", name: "Xiaoyi", gender: "♀", grade: "B" },
          { id: "zm_yunjian", name: "Yunjian", gender: "♂", grade: "B" },
          { id: "zm_yunxi", name: "Yunxi", gender: "♂", grade: "B" },
          { id: "zm_yunxia", name: "Yunxia", gender: "♂", grade: "B" },
          { id: "zm_yunyang", name: "Yunyang", gender: "♂", grade: "B" },
        ],
      },
    ],
  },
  {
    code: "es",
    name: "Español",
    groups: [
      {
        label: "Spain",
        voices: [
          { id: "ef_dora", name: "Dora", gender: "♀", grade: "B" },
          { id: "em_alex", name: "Alex", gender: "♂", grade: "B" },
          { id: "em_santa", name: "Santa", gender: "♂", grade: "B" },
        ],
      },
    ],
  },
  {
    code: "hi",
    name: "हिन्दी",
    groups: [
      {
        label: "India",
        voices: [
          { id: "hf_alpha", name: "Alpha", gender: "♀", grade: "B" },
          { id: "hf_beta", name: "Beta", gender: "♀", grade: "B" },
          { id: "hm_omega", name: "Omega", gender: "♂", grade: "B" },
          { id: "hm_psi", name: "Psi", gender: "♂", grade: "B" },
        ],
      },
    ],
  },
  {
    code: "it",
    name: "Italiano",
    groups: [
      {
        label: "Italy",
        voices: [
          { id: "if_sara", name: "Sara", gender: "♀", grade: "B" },
          { id: "im_nicola", name: "Nicola", gender: "♂", grade: "B" },
        ],
      },
    ],
  },
  {
    code: "pt",
    name: "Português",
    groups: [
      {
        label: "Brazil",
        voices: [
          { id: "pf_dora", name: "Dora", gender: "♀", grade: "B" },
          { id: "pm_alex", name: "Alex", gender: "♂", grade: "B" },
          { id: "pm_santa", name: "Santa", gender: "♂", grade: "B" },
        ],
      },
    ],
  },
];

// Flat list for lookups (all languages)
const ALL_VOICES = LANGUAGES.flatMap((lang) =>
  lang.groups.flatMap((g) => g.voices)
);

// Get voices for a specific language
function getVoicesForLanguage(langCode: string) {
  const lang = LANGUAGES.find((l) => l.code === langCode);
  return lang ? lang.groups.flatMap((g) => g.voices) : [];
}

// Get voice groups for a specific language (for single-reader dropdown)
function getVoiceGroupsForLanguage(langCode: string, accent?: string) {
  const lang = LANGUAGES.find((l) => l.code === langCode);
  if (!lang) return [];
  // If accent is specified (for English), filter to just that group
  if (accent) {
    return lang.groups.filter((g) => g.label === accent);
  }
  return lang.groups;
}

// Get voice display name by ID
function getVoiceDisplayName(voiceId: string): string {
  const voice = ALL_VOICES.find((v) => v.id === voiceId);
  return voice ? voice.name : voiceId;
}

// Get language and accent from voice ID
function getLanguageFromVoiceId(voiceId: string): {
  langCode: string;
  accent?: "American" | "British";
} {
  const prefix = voiceId.charAt(0);
  switch (prefix) {
    case "a":
      return { langCode: "en", accent: "American" };
    case "b":
      return { langCode: "en", accent: "British" };
    case "e":
      return { langCode: "es" };
    case "f":
      return { langCode: "fr" };
    case "j":
      return { langCode: "ja" };
    case "k":
      return { langCode: "ko" };
    case "z":
      return { langCode: "zh" };
    case "h":
      return { langCode: "hi" };
    case "i":
      return { langCode: "it" };
    case "p":
      return { langCode: "pt" };
    default:
      return { langCode: "en", accent: "American" };
  }
}

// Get voice avatar URL (stored locally)
function getVoiceAvatarUrl(voiceId: string): string {
  return `/voices/${voiceId}.svg`;
}

// Voice Avatar component with fallback for missing images
function VoiceAvatar({
  voiceId,
  name,
  size = "md",
  selected = false,
  transparent = false,
}: {
  voiceId: string;
  name: string;
  size?: "sm" | "md";
  selected?: boolean;
  transparent?: boolean;
}) {
  const [hasError, setHasError] = useState(false);
  const sizeClass = size === "sm" ? "w-8 h-8" : "w-12 h-12";
  const textSize = size === "sm" ? "text-xs" : "text-sm";
  const bgClass = transparent
    ? "bg-transparent"
    : selected
    ? "bg-brand-primary-subtle"
    : "bg-gray-100";

  if (hasError) {
    // Fallback: show initials with gradient background
    const initial = name.charAt(0).toUpperCase();
    return (
      <div
        className={cn(
          sizeClass,
          "rounded-full bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center",
          textSize,
          "font-medium text-white"
        )}
      >
        {initial}
      </div>
    );
  }

  return (
    <img
      src={getVoiceAvatarUrl(voiceId)}
      alt={name}
      className={cn(sizeClass, "rounded-full", bgClass)}
      onError={() => setHasError(true)}
    />
  );
}

// Custom icons to match audio player style
const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const PauseIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);

export function TTSPlayer() {
  const {
    isPlaybackOn,
    isWaitingForAudio,
    togglePlayback,
    skipToPreviousSentence,
    skipToNextSentence,
    playFromSentence,
    currentIndex,
  } = usePlayback();
  const { totalCount, sentences, currentSentence, isGenerating } =
    useSentences();
  const { speed, setSpeed, setVoice, getVoice } = useVoiceConfig();
  const {
    modelStatus,
    capabilityStatus,
    ttsMode,
    voiceQuality,
    ecoDisabled,
    cloudHealth,
    setVoiceQuality,
    setEcoDisabled,
  } = useGeneration();
  const gain = useGain();

  // Language selection state
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [selectedAccent, setSelectedAccent] = useState<"American" | "British">(
    "American"
  );
  const [isVoicePopoverOpen, setIsVoicePopoverOpen] = useState(false);
  const isEnglish = selectedLanguage === "en";

  // Auto-select Standard mode when switching to non-English (Expressive is English-only)
  useEffect(() => {
    if (!isEnglish && voiceQuality === "expressive") {
      setVoiceQuality("standard");
    }
  }, [isEnglish, voiceQuality, setVoiceQuality]);

  // Get unique reader IDs from sentences
  const uniqueReaderIds = useMemo(() => {
    const readerIds = new Set<string>();
    for (const sentence of sentences) {
      readerIds.add(sentence.reader_id);
    }
    return Array.from(readerIds);
  }, [sentences]);

  const isModelLoading =
    modelStatus === "loading" || modelStatus === "uninitialized";

  // Scale for animated circle (matches audio player: 1.0 to 1.6 range)
  const scale = 1 + Math.min(gain * 3, 0.6);

  // Show loading spinner when waiting for audio or current sentence is generating
  const isGeneratingCurrent = currentSentence
    ? isGenerating(currentSentence.id)
    : false;
  const showLoader = isWaitingForAudio || (isPlaybackOn && isGeneratingCurrent);

  // Playback progress (0 to 100)
  const playbackProgress =
    totalCount > 0 ? ((currentIndex + 1) / totalCount) * 100 : 0;

  // Find the heading preceding the current sentence
  const currentHeading = useMemo(() => {
    if (currentIndex < 0 || sentences.length === 0) return null;
    // Look backwards from current sentence to find nearest title
    for (let i = currentIndex; i >= 0; i--) {
      if (sentences[i].isTitle) {
        return sentences[i].text;
      }
    }
    return null;
  }, [currentIndex, sentences]);

  // Check if all TTS services are unavailable
  const allServicesDown =
    ttsMode === null &&
    cloudHealth.kokoro !== "checking" &&
    cloudHealth.kokoro !== "ok" &&
    cloudHealth.chatterbox !== "checking" &&
    cloudHealth.chatterbox !== "ok" &&
    capabilityStatus !== "checking" &&
    capabilityStatus !== "available";

  if (allServicesDown) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AlertCircle className="h-4 w-4" />
        Service unavailable, try again later
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 p-0 bg-background rounded-lg">
      {/* Playback Controls */}
      <div className="flex items-center gap-2">
        {/* Skip backward */}
        <Button
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={skipToPreviousSentence}
          disabled={totalCount === 0 || isModelLoading}
        >
          <UndoDot className="w-4 h-4" />
        </Button>

        {/* Play/Pause - circular style with animated gain circle */}
        <Button
          variant="secondary"
          size="icon"
          onClick={togglePlayback}
          disabled={totalCount === 0 || isModelLoading}
          className="relative p-0 bg-gray-200 hover:bg-gray-300 rounded-full"
        >
          <span
            className="absolute inset-0 rounded-full bg-gray-200"
            style={{
              transform: `scale(${scale})`,
              transition: "transform 0.15s linear",
            }}
          />
          <span className="relative z-10">
            {showLoader ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : isPlaybackOn ? (
              <PauseIcon />
            ) : (
              <PlayIcon />
            )}
          </span>
        </Button>

        {/* Skip forward */}
        <Button
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={skipToNextSentence}
          disabled={totalCount === 0 || isModelLoading}
        >
          <RedoDot className="w-4 h-4" />
        </Button>
      </div>

      {/* Speed Selector */}
      <SpeedSelector currentSpeed={speed} onSpeedChange={setSpeed} />

      {/* Simple Progress Bar */}
      <div
        className="w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden cursor-pointer"
        onClick={(e) => {
          const percentage = e.nativeEvent.offsetX / e.currentTarget.offsetWidth;
          const targetIndex = Math.min(
            totalCount - 1,
            Math.floor(percentage * totalCount)
          );
          if (targetIndex >= 0) {
            playFromSentence(targetIndex);
          }
        }}
      >
        <div
          className="h-full bg-gray-400 transition-all duration-300 pointer-events-none"
          style={{ width: `${playbackProgress}%` }}
        />
      </div>

      {/* Download Button moved to left floating menu */}

      {/* Voice Settings with Quality Toggle */}
      {uniqueReaderIds.length >= 1 && (
        <Popover
          open={isVoicePopoverOpen}
          onOpenChange={(open) => {
            setIsVoicePopoverOpen(open);
            if (open && uniqueReaderIds.length > 0) {
              const firstVoiceId = getVoice(uniqueReaderIds[0]);
              const { langCode, accent } = getLanguageFromVoiceId(firstVoiceId);
              setSelectedLanguage(langCode);
              if (accent) setSelectedAccent(accent);
            }
          }}
        >
          <PopoverTrigger asChild>
            <button
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors",
                isVoicePopoverOpen ? "bg-gray-100" : "hover:bg-gray-100"
              )}
            >
              {uniqueReaderIds.length === 1 ? (
                <VoiceAvatar
                  voiceId={getVoice(uniqueReaderIds[0])}
                  name={getVoiceDisplayName(getVoice(uniqueReaderIds[0]))}
                  size="sm"
                  transparent
                />
              ) : (
                <div className="flex -space-x-2">
                  {uniqueReaderIds.map((readerId, index) => (
                    <div
                      key={readerId}
                      className="rounded-full"
                      style={{ zIndex: uniqueReaderIds.length - index }}
                    >
                      <VoiceAvatar
                        voiceId={getVoice(readerId)}
                        name={getVoiceDisplayName(getVoice(readerId))}
                        size="sm"
                        transparent
                      />
                    </div>
                  ))}
                </div>
              )}
              <span className="text-sm text-gray-600 w-[70px]">
                {voiceQuality === "expressive" ? "Expressive" : "Standard"}
              </span>
              <ChevronDown className="w-4 h-4 text-gray-500" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[480px] p-0" align="end">
            {/* Language Selector */}
            <div className="p-3 pb-0 border-b">
              <div className="flex gap-1 overflow-x-auto overflow-y-hidden pb-3">
                {LANGUAGES.map((lang) =>
                  lang.code === "en" ? (
                    // English with animated width change
                    <div
                      key={lang.code}
                      className={cn(
                        "flex-shrink-0 flex rounded-full text-sm transition-all duration-200 ease-out overflow-hidden",
                        isEnglish ? "w-[176px]" : "w-[68px]"
                      )}
                    >
                      {isEnglish ? (
                        // English selected - show accent toggle
                        <>
                          <button
                            onClick={() => setSelectedAccent("American")}
                            className={cn(
                              "flex-1 px-3 py-1.5 text-center transition-colors rounded-l-full",
                              selectedAccent === "American"
                                ? "bg-brand-primary-dark text-white"
                                : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                            )}
                          >
                            American
                          </button>
                          <button
                            onClick={() => setSelectedAccent("British")}
                            className={cn(
                              "flex-1 px-3 py-1.5 text-center transition-colors rounded-r-full",
                              selectedAccent === "British"
                                ? "bg-brand-primary-dark text-white"
                                : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                            )}
                          >
                            British
                          </button>
                        </>
                      ) : (
                        // English not selected - show simple button
                        <button
                          onClick={() => {
                            setSelectedLanguage("en");
                            setSelectedAccent("American");
                          }}
                          className="w-full px-3 py-1.5 text-center rounded-full bg-gray-50 text-gray-500 hover:bg-gray-100 transition-colors"
                        >
                          English
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      key={lang.code}
                      onClick={() => setSelectedLanguage(lang.code)}
                      className={cn(
                        "flex-shrink-0 px-3 py-1.5 rounded-full text-sm transition-colors",
                        selectedLanguage === lang.code
                          ? "bg-brand-primary-dark text-white"
                          : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                      )}
                    >
                      {lang.name}
                    </button>
                  )
                )}
              </div>
            </div>

            {/* Voice Selection */}
            <div className="p-4 border-b">
              <div className="space-y-4">
                {uniqueReaderIds.map((readerId) => {
                  const currentVoice = getVoice(readerId);
                  const displayName = readerId
                    .split(/[\s_-]+/)
                    .map(
                      (word) =>
                        word.charAt(0).toUpperCase() +
                        word.slice(1).toLowerCase()
                    )
                    .join(" ");
                  const voiceGroups = getVoiceGroupsForLanguage(
                    selectedLanguage,
                    isEnglish ? selectedAccent : undefined
                  );
                  const allVoices = voiceGroups.flatMap((g) => g.voices);
                  return (
                    <div key={readerId}>
                      {uniqueReaderIds.length > 1 && (
                        <div className="px-2 py-1">
                          <span className="text-xs font-medium text-muted-foreground">
                            {displayName}
                          </span>
                        </div>
                      )}
                      <div className="flex gap-2 overflow-x-auto pb-2 px-1">
                        {allVoices.map((voice) => (
                          <button
                            key={voice.id}
                            onClick={() => setVoice(readerId, voice.id)}
                            className={cn(
                              "group flex-shrink-0 flex flex-col items-center gap-1.5 p-2 rounded-xl transition-colors border-[1.5px]",
                              currentVoice === voice.id
                                ? "border-brand-primary-dark bg-brand-primary-subtle"
                                : "border-transparent hover:bg-gray-100"
                            )}
                          >
                            <div className="relative">
                              <VoiceAvatar
                                voiceId={voice.id}
                                name={voice.name}
                                selected={currentVoice === voice.id}
                              />
                              {/* Checkmark badge when selected */}
                              {currentVoice === voice.id && (
                                <div className="absolute -top-1 -right-1 w-4 h-4 bg-brand-primary-dark rounded-full flex items-center justify-center">
                                  <Check className="w-2.5 h-2.5 text-white" />
                                </div>
                              )}
                              {/* Play sample button - appears on hover */}
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // TODO: Play voice sample
                                  console.log("Play sample for:", voice.id);
                                }}
                                className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-gray-700 hover:bg-gray-900 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                              >
                                <Play className="w-2.5 h-2.5 text-white fill-white" />
                              </div>
                            </div>
                            <span
                              className={cn(
                                "text-xs",
                                currentVoice === voice.id
                                  ? "text-brand-primary-dark font-medium"
                                  : "text-muted-foreground"
                              )}
                            >
                              {voice.name}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quality Toggle */}
            <div className="p-3">
              <RadioGroup
                value={voiceQuality}
                onValueChange={(value) => {
                  if (
                    value === "expressive" &&
                    (cloudHealth.chatterbox !== "ok" || !isEnglish)
                  )
                    return;
                  setVoiceQuality(value as "standard" | "expressive");
                }}
                className="flex gap-2"
              >
                <label
                  className={cn(
                    "flex-1 py-2.5 px-3 rounded-xl text-sm font-medium transition-colors border-[1.5px] cursor-pointer",
                    voiceQuality === "standard"
                      ? "border-brand-primary-dark bg-brand-primary-subtle"
                      : "border-transparent bg-gray-50 hover:bg-gray-100"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem
                      value="standard"
                      className="border-brand-primary-dark text-brand-primary-dark"
                    />
                    <span
                      className={cn(
                        voiceQuality === "standard"
                          ? "text-brand-primary-dark"
                          : "text-gray-600"
                      )}
                    >
                      Standard
                    </span>
                    <div className="flex items-center gap-1.5 ml-auto">
                      {isEnglish &&
                      (ttsMode === "eco" ||
                        (capabilityStatus === "available" && !ecoDisabled)) ? (
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5",
                            voiceQuality === "standard"
                              ? "bg-brand-primary-dark text-white"
                              : "bg-gray-200 text-gray-600"
                          )}
                        >
                          <Leaf className="w-2.5 h-2.5" />
                          Free
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded-full",
                            voiceQuality === "standard"
                              ? "bg-brand-primary-dark text-white"
                              : "bg-gray-200 text-gray-600"
                          )}
                        >
                          1 cr/min
                        </span>
                      )}
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger
                            asChild
                            onClick={(e) => e.preventDefault()}
                          >
                            <Info className="w-3.5 h-3.5 text-gray-400" />
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            className="max-w-[200px]"
                          >
                            <p className="text-xs">
                              Best for non-fiction, technical terms, and
                              accurate pronunciation.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                </label>
                <label
                  className={cn(
                    "flex-1 py-2.5 px-3 rounded-xl text-sm font-medium transition-colors border-[1.5px]",
                    voiceQuality === "expressive"
                      ? "border-brand-primary-dark bg-brand-primary-subtle"
                      : "border-transparent bg-gray-50 hover:bg-gray-100",
                    cloudHealth.chatterbox !== "ok" || !isEnglish
                      ? "opacity-50 cursor-not-allowed"
                      : "cursor-pointer"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem
                      value="expressive"
                      disabled={cloudHealth.chatterbox !== "ok" || !isEnglish}
                      className="border-brand-primary-dark text-brand-primary-dark"
                    />
                    <span
                      className={cn(
                        voiceQuality === "expressive"
                          ? "text-brand-primary-dark"
                          : "text-gray-600"
                      )}
                    >
                      Expressive
                    </span>
                    <div className="flex items-center gap-1.5 ml-auto">
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5",
                          !isEnglish
                            ? "bg-gray-200 text-gray-600"
                            : cloudHealth.chatterbox === "checking"
                            ? "bg-gray-200 text-gray-500"
                            : cloudHealth.chatterbox !== "ok"
                            ? "bg-amber-100 text-amber-700"
                            : voiceQuality === "expressive"
                            ? "bg-brand-primary-dark text-white"
                            : "bg-gray-200 text-gray-600"
                        )}
                      >
                        {!isEnglish ? (
                          "EN only"
                        ) : cloudHealth.chatterbox === "checking" ? (
                          <>
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            Loading
                          </>
                        ) : cloudHealth.chatterbox !== "ok" ? (
                          "Unavailable"
                        ) : (
                          "2 cr/min"
                        )}
                      </span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger
                            asChild
                            onClick={(e) => e.preventDefault()}
                          >
                            <Info className="w-3.5 h-3.5 text-gray-400" />
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            className="max-w-[200px]"
                          >
                            <p className="text-xs">
                              Best for fiction, dialogue, and emotionally rich
                              content.
                            </p>
                            {cloudHealth.chatterbox === "checking" &&
                              isEnglish && (
                                <p className="text-xs mt-1.5 opacity-80">
                                  Checking server availability...
                                </p>
                              )}
                            {cloudHealth.chatterbox !== "ok" &&
                              cloudHealth.chatterbox !== "checking" &&
                              isEnglish && (
                                <p className="text-xs mt-1.5 opacity-80">
                                  Server temporarily unavailable. Please try
                                  again later.
                                </p>
                              )}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                </label>
              </RadioGroup>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
