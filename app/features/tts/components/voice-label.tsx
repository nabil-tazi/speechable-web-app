"use client";

import { ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useVoiceConfig } from "../hooks/use-voice-config";

// Available voices
const VOICES = [
  { id: "af_sky", name: "Sky (Female, American)", grade: "A" },
  { id: "af_heart", name: "Heart (Female, American)", grade: "A" },
  { id: "af_bella", name: "Bella (Female, American)", grade: "A-" },
  { id: "af_nicole", name: "Nicole (Female, American)", grade: "B+" },
  { id: "af_sarah", name: "Sarah (Female, American)", grade: "B+" },
  { id: "af_nova", name: "Nova (Female, American)", grade: "B" },
  { id: "am_adam", name: "Adam (Male, American)", grade: "A-" },
  { id: "am_michael", name: "Michael (Male, American)", grade: "B+" },
  { id: "am_eric", name: "Eric (Male, American)", grade: "B" },
  { id: "bf_emma", name: "Emma (Female, British)", grade: "B-" },
  { id: "bf_isabella", name: "Isabella (Female, British)", grade: "B-" },
  { id: "bm_george", name: "George (Male, British)", grade: "B" },
];

interface VoiceLabelProps {
  readerId: string;
}

export function VoiceLabel({ readerId }: VoiceLabelProps) {
  const { getVoice, setVoice } = useVoiceConfig();
  const currentVoice = getVoice(readerId);
  const voiceInfo = VOICES.find((v) => v.id === currentVoice);
  const voiceName = voiceInfo?.name.split(" ")[0] || currentVoice; // Just the first name

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="text-sm text-muted-foreground hover:text-foreground mb-1 flex items-center gap-1 transition-colors">
          <span className="font-medium">{readerId}</span>
          <span className="text-xs opacity-75">({voiceName})</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="space-y-1">
          <p className="text-sm font-medium px-2 py-1 text-muted-foreground">
            Voice for {readerId}
          </p>
          {VOICES.map((voice) => (
            <button
              key={voice.id}
              onClick={() => setVoice(readerId, voice.id)}
              className={cn(
                "w-full text-left px-2 py-1.5 rounded text-sm transition-colors",
                "hover:bg-accent",
                currentVoice === voice.id && "bg-accent font-medium"
              )}
            >
              {voice.name} ({voice.grade})
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
