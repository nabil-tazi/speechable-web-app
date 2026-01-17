"use client";

import { useMemo } from "react";
import { Leaf, CircleHelp, Loader2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useGeneration } from "../hooks/use-generation";
import { useSentences } from "../hooks/use-sentences";
import { useVoiceConfig } from "../hooks/use-voice-config";

// Check if a voice ID is English (American or British)
function isEnglishVoice(voiceId: string): boolean {
  return voiceId.startsWith("a") || voiceId.startsWith("b");
}

export function EcoBadge() {
  const {
    capabilityStatus,
    ecoDisabled,
    setEcoDisabled,
    voiceQuality,
  } = useGeneration();
  const { sentences } = useSentences();
  const { getVoice } = useVoiceConfig();

  // Check if any selected voice is non-English
  const hasNonEnglishVoice = useMemo(() => {
    const readerIds = new Set<string>();
    for (const sentence of sentences) {
      readerIds.add(sentence.reader_id);
    }
    for (const readerId of readerIds) {
      const voiceId = getVoice(readerId);
      if (!isEnglishVoice(voiceId)) {
        return true;
      }
    }
    return false;
  }, [sentences, getVoice]);

  const isExpressive = voiceQuality === "expressive";
  const isAvailable = capabilityStatus === "available";
  const isChecking = capabilityStatus === "checking" || capabilityStatus === "unchecked";
  const isOn = isAvailable && !ecoDisabled && !isExpressive && !hasNonEnglishVoice;
  const isOff = isAvailable && ecoDisabled && !isExpressive && !hasNonEnglishVoice;
  const isUnavailable = capabilityStatus === "unavailable";

  // Still checking or unchecked - show loading state
  if (isChecking) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-400 w-[82px]">
        <Leaf className="w-4 h-4" />
        <span className="text-xs">Eco</span>
        <Loader2 className="w-3.5 h-3.5 ml-auto animate-spin" />
      </div>
    );
  }

  // Eco unavailable - show disabled with info tooltip (takes priority over Expressive N/A)
  if (isUnavailable) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-400 cursor-help w-[82px]">
              <Leaf className="w-4 h-4" />
              <span className="text-xs">Eco</span>
              <CircleHelp className="w-3.5 h-3.5 ml-auto" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p className="font-medium">Eco mode unavailable</p>
            <p className="text-xs opacity-80 mt-1">
              Requires WebGPU and a compatible GPU. Try Chrome or Edge on a device with dedicated graphics.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Expressive selected - show N/A state (eco not compatible with expressive voices)
  if (isExpressive) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-400 cursor-help w-[82px]">
              <Leaf className="w-4 h-4" />
              <span className="text-xs">Eco</span>
              <CircleHelp className="w-3.5 h-3.5 ml-auto" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p className="font-medium">Eco mode not available</p>
            <p className="text-xs opacity-80 mt-1">
              Eco mode is only available with Precise voices.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Non-English voice selected - show N/A state (eco only supports English)
  if (hasNonEnglishVoice) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-400 cursor-help w-[82px]">
              <Leaf className="w-4 h-4" />
              <span className="text-xs">Eco</span>
              <CircleHelp className="w-3.5 h-3.5 ml-auto" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p className="font-medium">Eco mode not available</p>
            <p className="text-xs opacity-80 mt-1">
              Eco mode is only available for English voices.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Eco on - green LED with pulse, clickable to turn off
  if (isOn) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setEcoDisabled(true)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-colors w-[82px]",
                "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              <Leaf className="w-4 h-4 text-brand-primary fill-brand-primary-lighter" />
              <span className="text-xs font-medium">Eco</span>
              {/* Green LED indicator with pulse */}
              <span className="relative flex h-[7px] w-[7px] items-center justify-center ml-auto">
                <span className="animate-ping [animation-duration:1.5s] absolute inline-flex h-[9px] w-[9px] rounded-full bg-brand-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-[7px] w-[7px] bg-brand-primary" />
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="font-medium">Eco mode active</p>
            <p className="text-xs opacity-80">
              Running on your device. Free & private.
            </p>
            <p className="text-xs opacity-80 mt-1">
              Click to switch to cloud.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Eco off (manual) - muted with grey LED, clickable to turn on
  if (isOff) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setEcoDisabled(false)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-colors w-[82px]",
                "bg-gray-100 text-gray-500 hover:bg-gray-200"
              )}
            >
              <Leaf className="w-4 h-4" />
              <span className="text-xs">Eco</span>
              {/* Grey LED indicator (off) */}
              <span className="relative flex h-[7px] w-[7px] items-center justify-center ml-auto">
                <span className="relative inline-flex rounded-full h-[7px] w-[7px] bg-gray-400" />
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="font-medium">Eco mode off</p>
            <p className="text-xs opacity-80">
              Currently using cloud. Click to enable free local generation.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return null;
}
