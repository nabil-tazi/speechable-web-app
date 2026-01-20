import { Label } from "@/components/ui/label";
import { Document } from "../types";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { PROCESSING_ARRAY, type ProcessingType } from "../../pdf/types";
import {
  FileText,
  MessagesSquare,
  MicVocal,
  Presentation,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Text,
  Venus,
  Mars,
  MoveRight,
  AudioLines,
} from "lucide-react";
import { TransitionPanel } from "@/components/ui/transition-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { unifiedVoices } from "../../audio/voice-constants";
import { Language } from "../../audio/voice-types";

// Type for individual voice
type Voice = {
  name: string;
  gender: string;
  accent?: string;
  models: {
    kokoro: string | null;
    lemonfox: string | null;
  };
  traits?: string;
  quality?: {
    target: string;
    training: string;
    overall: string;
  };
  source?: string;
};

type Props = {
  document: Document;
  handleGenerateVersion: (
    processingLevel: 0 | 1 | 2 | 3,
    voiceArray: string[],
    language: string
  ) => void;
  onClose: () => void;
};

// Language mapping
const LANGUAGE_MAP: { [key: string]: string } = {
  en: "English",
  ja: "Japanese",
  zh: "Chinese",
  es: "Spanish",
  fr: "French",
  hi: "Hindi",
  it: "Italian",
  pt: "Portuguese",
};

const ACCENT_MAP: { [key: string]: string } = {
  us: "American",
  gb: "British",
  pt: "Portuguese",
  br: "Brazilian",
};

// Get available languages based on voices
const AVAILABLE_LANGUAGES = Object.keys(unifiedVoices).map((code) => ({
  code,
  name: LANGUAGE_MAP[code] || code.toUpperCase(),
}));

// Confirmation Dialog Component
function ConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  selectedProcessing,
  selectedLanguage,
  selectedVoices,
  requiredVoicesCount,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  selectedProcessing: 0 | 1 | 2 | 3;
  selectedLanguage: string;
  selectedVoices: string[];
  requiredVoicesCount: number;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm Generation</DialogTitle>
          <DialogDescription>
            Please review your configuration before generating the audio
            version:
          </DialogDescription>
        </DialogHeader>

        <div className="bg-gradient-to-r from-brand-secondary/5 to-brand-secondary/10 rounded-lg p-4 border border-brand-secondary/20">
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="font-medium text-gray-700 dark:text-gray-300">
                Processing:
              </span>
              <span className="text-brand-secondary font-medium">
                {PROCESSING_ARRAY[selectedProcessing].name}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-medium text-gray-700 dark:text-gray-300">
                Language:
              </span>
              <span className="text-brand-secondary font-medium">
                {
                  AVAILABLE_LANGUAGES.find((l) => l.code === selectedLanguage)
                    ?.name
                }
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-medium text-gray-700 dark:text-gray-300">
                Voice{selectedVoices.length > 1 ? "s" : ""}:
              </span>
              <div className="text-brand-secondary font-medium capitalize text-right">
                {selectedVoices.length > 0
                  ? selectedVoices.map((voiceName, index) => (
                      <div key={index}>
                        {requiredVoicesCount > 1 && (
                          <span className="text-xs text-gray-500">
                            {index === 0 ? "Speaker 1: " : "Speaker 2: "}
                          </span>
                        )}
                        {voiceName}
                      </div>
                    ))
                  : "None selected"}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Go Back
          </Button>
          <Button onClick={onConfirm}>Confirm Generation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreateVersionDialogLegacy({
  document,
  handleGenerateVersion,
  onClose,
}: Props) {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedProcessing, setSelectedProcessing] = useState<0 | 1 | 2 | 3>(
    0
  );
  const [selectedLanguage, setSelectedLanguage] = useState<Language>("en");
  const [selectedVoices, setSelectedVoices] = useState<string[]>([]);
  const [direction, setDirection] = useState(1);
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Get voices for selected language with proper typing
  const availableVoices: Voice[] = (unifiedVoices[
    selectedLanguage as keyof typeof unifiedVoices
  ] || []) as Voice[];

  // Determine how many voices are needed based on processing type
  const requiredVoicesCount = selectedProcessing === 3 ? 2 : 1;

  // Set default voice when language changes
  const handleLanguageChange = (newLanguage: Language) => {
    setSelectedLanguage(newLanguage);
    const voices: Voice[] = (unifiedVoices[
      newLanguage as keyof typeof unifiedVoices
    ] || []) as Voice[];
    if (voices.length > 0) {
      // Reset voices and set defaults based on current processing type
      const defaultVoices = voices
        .slice(0, requiredVoicesCount)
        .map((v) => v.name);
      setSelectedVoices(defaultVoices);
    }
  };

  // Handle processing type change and adjust voice selection
  const handleProcessingChange = (newProcessing: 0 | 1 | 2 | 3) => {
    setSelectedProcessing(newProcessing);
    const newRequiredCount = newProcessing === 3 ? 2 : 1;

    if (newRequiredCount === 1) {
      // Keep only the first voice
      setSelectedVoices((prev) => prev.slice(0, 1));
    } else if (newRequiredCount === 2 && selectedVoices.length === 1) {
      // Add a second voice if we only have one
      const availableSecondVoice = availableVoices.find(
        (v) => v.name !== selectedVoices[0]
      );
      if (availableSecondVoice) {
        setSelectedVoices((prev) => [...prev, availableSecondVoice.name]);
      }
    }
  };

  // Handle voice selection/deselection
  const handleVoiceToggle = (voiceName: string) => {
    setSelectedVoices((prev) => {
      const currentIndex = prev.indexOf(voiceName);

      if (currentIndex !== -1) {
        // Voice is already selected, remove it
        const newVoices = prev.filter((voice) => voice !== voiceName);
        // Don't auto-select if user manually deselected
        return newVoices;
      } else {
        // Voice is not selected, add it if we haven't reached the limit
        if (prev.length < requiredVoicesCount) {
          return [...prev, voiceName];
        } else if (requiredVoicesCount === 1) {
          // Replace the single voice
          return [voiceName];
        }
        // If we're at the limit and need 2 voices, don't add more
        return [prev[0], voiceName];
      }
    });
  };

  // Initialize with first available voice(s)
  React.useEffect(() => {
    if (selectedVoices.length === 0 && availableVoices.length > 0) {
      // Only auto-select on initial load or language change, not after manual deselection
      const defaultVoices = availableVoices
        .slice(0, requiredVoicesCount)
        .map((v) => v.name);
      setSelectedVoices(defaultVoices);
    }
  }, [availableVoices]);

  const handleNext = () => {
    setDirection(1);
    setCurrentStep(1);
  };

  const handleBack = () => {
    setDirection(-1);
    setCurrentStep(0);
  };

  const handleShowConfirmation = () => {
    setShowConfirmation(true);
  };

  const handleConfirmGeneration = () => {
    console.log("voices array");
    console.log(
      selectedVoices.flatMap((voice) => {
        const model = unifiedVoices[selectedLanguage]?.find(
          (voiceObject: Voice) => voiceObject.name === voice
        )?.models.lemonfox;
        return model ? [model] : [];
      })
    );
    setShowConfirmation(false); // Close confirmation dialog first
    handleGenerateVersion(
      selectedProcessing,
      selectedVoices.flatMap((voice) => {
        const model = unifiedVoices[selectedLanguage]?.find(
          (voiceObject: Voice) => voiceObject.name === voice
        )?.models.lemonfox;
        return model ? [model] : [];
      }),
      selectedLanguage
    );
    onClose(); // Close main dialog
  };

  // Check if we have the required number of voices selected
  const isVoiceSelectionValid = selectedVoices.length === requiredVoicesCount;

  return (
    <>
      <DialogContent className="sm:max-w-[700px] h-[65vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>
            {currentStep === 0
              ? "New audio version"
              : `New audio version – ` +
                `${PROCESSING_ARRAY[selectedProcessing].name}`}
          </DialogTitle>
          <DialogDescription>
            {currentStep === 0
              ? "Choose how you want your document processed"
              : "Select language and voice preferences"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <TransitionPanel
            activeIndex={currentStep}
            transition={{
              duration: 0.3,
              ease: "easeInOut",
              x: { type: "spring", stiffness: 300, damping: 30 },
            }}
            variants={{
              enter: (direction: number) => ({
                x: direction > 0 ? 400 : -400,
                opacity: 0,
              }),
              center: {
                x: 0,
                opacity: 1,
              },
              exit: (direction: number) => ({
                x: direction < 0 ? 400 : -400,
                opacity: 0,
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
              }),
            }}
            custom={direction}
          >
            {/* Step 1: Processing Level Selection with Tabs */}
            <div className="flex flex-col min-h-0 flex-1">
              <Tabs
                value={selectedProcessing.toString()}
                onValueChange={(value) =>
                  handleProcessingChange(parseInt(value) as 0 | 1 | 2 | 3)
                }
                className="flex-shrink-0 mb-4"
              >
                <TabsList className="grid w-full grid-cols-4">
                  {PROCESSING_ARRAY.map((item, index) => (
                    <TabsTrigger
                      key={index}
                      value={index.toString()}
                      className="flex items-center gap-2 text-sm"
                    >
                      {renderProcessingIcon(item, selectedProcessing === index)}
                      {item.name}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              <div className="overflow-hidden border-t border-zinc-200 dark:border-zinc-700 flex-1 min-h-0">
                <div className="h-full overflow-y-auto">
                  <TransitionPanel
                    activeIndex={selectedProcessing}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    variants={{
                      enter: { opacity: 0, y: -50, filter: "blur(4px)" },
                      center: { opacity: 1, y: 0, filter: "blur(0px)" },
                      exit: { opacity: 0, y: 50, filter: "blur(4px)" },
                    }}
                  >
                    {PROCESSING_ARRAY.map((item, index) => (
                      <div key={index} className="py-6 px-2">
                        <div className="flex items-start gap-4">
                          <div className="flex-1">
                            <h3 className="mb-3 text-2xl font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-2 justify-center">
                              {renderProcessingIcon(item)}
                              {item.name}
                            </h3>
                            <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed text-center text-md">
                              {item.description}
                            </p>
                            <Card className="mx-auto mt-8 p-3  w-60 gap-2">
                              <div className="space-y-2">
                                {getProcessingFeatures(item.name)
                                  .sort(
                                    (a, b) =>
                                      (b.included ? 1 : 0) -
                                      (a.included ? 1 : 0)
                                  )
                                  .map((feature, idx) => (
                                    <div
                                      key={idx}
                                      className="flex items-center gap-3"
                                    >
                                      {feature.included ? (
                                        <Check className="w-4 h-4 text-gray-800 flex-shrink-0" />
                                      ) : (
                                        <X className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                      )}
                                      <span
                                        className={`text-sm ${
                                          feature.included
                                            ? "text-gray-800 dark:text-gray-300"
                                            : "text-gray-400 dark:text-gray-500 line-through"
                                        }`}
                                      >
                                        {feature.feature}
                                      </span>
                                    </div>
                                  ))}
                              </div>
                            </Card>
                          </div>
                        </div>
                      </div>
                    ))}
                  </TransitionPanel>
                </div>
              </div>
            </div>

            {/* Step 2: Language and Voice Selection */}
            <div className="flex flex-col min-h-0 flex-1">
              <div className="flex-1 overflow-y-auto space-y-6 pr-2">
                <div className="space-y-6">
                  <div className="space-y-3">
                    <Label className="text-base font-semibold">Language</Label>
                    <div className="flex items-center gap-2">
                      <Label>{LANGUAGE_MAP[document.language || "en"]}</Label>
                      <MoveRight />
                      <Select
                        value={selectedLanguage}
                        onValueChange={handleLanguageChange}
                      >
                        <SelectTrigger className="h-12">
                          <SelectValue placeholder="Select a language" />
                        </SelectTrigger>
                        <SelectContent>
                          {AVAILABLE_LANGUAGES.map((lang) => (
                            <SelectItem key={lang.code} value={lang.code}>
                              {lang.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-base font-semibold">
                      Voice{selectedProcessing === 3 && "s"}
                      {selectedProcessing === 3 && (
                        <span className="text-sm font-normal text-gray-600 dark:text-gray-400 ml-2">
                          - Select 2 voices for conversation
                        </span>
                      )}
                    </Label>

                    <div className="space-y-4">
                      {Object.entries(
                        availableVoices.reduce((acc, voice) => {
                          const accent = voice.accent || "Standard";
                          if (!acc[accent]) acc[accent] = [];
                          acc[accent].push(voice);
                          return acc;
                        }, {} as Record<string, Voice[]>)
                      )
                        .sort(([a], [b]) => {
                          // Sort accents: Standard first, then alphabetically
                          if (a === "Standard") return -1;
                          if (b === "Standard") return 1;
                          return a.localeCompare(b);
                        })
                        .map(([accent, voices]) => (
                          <div key={accent} className="space-y-2">
                            <Label className="text-sm font-medium text-gray-600 dark:text-gray-400">
                              {ACCENT_MAP[accent]}
                            </Label>
                            <div className="flex flex-wrap gap-3">
                              {voices
                                .sort((a, b) =>
                                  a.gender.localeCompare(b.gender)
                                )
                                .map((voice: Voice) => {
                                  const voiceIndex = selectedVoices.indexOf(
                                    voice.name
                                  );
                                  const isSelected = voiceIndex !== -1;

                                  return (
                                    <Card
                                      className={`group relative p-1 px-3 cursor-pointer rounded-md ${
                                        isSelected
                                          ? "border-1 border-gray-900 bg-gray-100"
                                          : "hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300"
                                      }`}
                                      key={voice.name}
                                      onClick={() =>
                                        handleVoiceToggle(voice.name)
                                      }
                                    >
                                      {isSelected && (
                                        <div className="absolute -top-2 -right-2 w-5 h-5 bg-gray-900 text-white text-xs font-bold rounded-full flex items-center justify-center">
                                          {selectedProcessing === 3 ? (
                                            <>
                                              <span className="group-hover:hidden">
                                                {voiceIndex + 1}
                                              </span>
                                              <X className="w-3 h-3 hidden group-hover:block" />
                                            </>
                                          ) : (
                                            <Check className="w-3 h-3" />
                                          )}
                                        </div>
                                      )}
                                      <div className="flex items-center space-x-2 gap-0">
                                        <Label className="font-medium text-sm capitalize cursor-pointer">
                                          {voice.name}
                                        </Label>
                                        {voice.gender === "female" && (
                                          <Venus size="12" />
                                        )}
                                        {voice.gender === "male" && (
                                          <Mars size="12" />
                                        )}
                                        <AudioLines size="16" />
                                      </div>
                                    </Card>
                                  );
                                })}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TransitionPanel>
        </div>

        <DialogFooter className="flex justify-between pt-4 border-t flex-shrink-0">
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            {currentStep === 1 && (
              <Button variant="outline" onClick={handleBack}>
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            )}
          </div>

          <div>
            {currentStep === 0 ? (
              <Button onClick={handleNext} className="min-w-[100px]">
                Proceed with {PROCESSING_ARRAY[selectedProcessing].name}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button
                onClick={handleShowConfirmation}
                className="min-w-[100px]"
                disabled={!isVoiceSelectionValid}
              >
                Generate
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>

      <ConfirmationDialog
        isOpen={showConfirmation}
        onClose={() => setShowConfirmation(false)}
        onConfirm={handleConfirmGeneration}
        selectedProcessing={selectedProcessing}
        selectedLanguage={selectedLanguage}
        selectedVoices={selectedVoices}
        requiredVoicesCount={requiredVoicesCount}
      />
    </>
  );
}

function renderProcessingIcon(
  p: ProcessingType,
  isActive: boolean = false,
  className: string = "w-4 h-4"
) {
  switch (p.name) {
    case "Original":
      return <Text />;
    case "Natural":
      return <MicVocal />;
    case "Lecture":
      return <Presentation />;
    case "Conversational":
      return <MessagesSquare />;
    default:
      return <FileText />;
  }
}

function getProcessingFeatures(
  processingType: string
): { feature: string; included: boolean }[] {
  switch (processingType) {
    case "Original":
      return [
        { feature: "Original phrasing", included: true },
        { feature: "Chapter and section breaks", included: true },
        { feature: "Clean up document artifacts", included: true },
        { feature: "Natural sounding phrasing", included: false },
        // { feature: "Optimized for listening", included: false },
        { feature: "Optimized for memorization", included: false },
      ];
    case "Natural":
      return [
        { feature: "Natural sounding phrasing", included: true },
        { feature: "Removes redundancy", included: true },
        { feature: "Chapter and section breaks", included: true },
        { feature: "Clean up document artifacts", included: true },
        { feature: "Optimized for memorization", included: false },
        { feature: "Paced for information density", included: false },
      ];
    case "Lecture":
      return [
        { feature: "Educational structure", included: true },
        { feature: "Optimized for memorization", included: true },
        { feature: "Paced for information density", included: true },
        { feature: "Clean up document artifacts", included: true },
        { feature: "Chapter and section breaks", included: false },
        { feature: "Original phrasing", included: false },
      ];
    case "Conversational":
      return [
        { feature: "Engaging dialogue style", included: true },
        { feature: "Optimized for memorization", included: true },
        { feature: "Paced for information density", included: true },
        { feature: "Clean up document artifacts", included: true },
        { feature: "Chapter and section breaks", included: false },
        { feature: "Original phrasing", included: false },
      ];
    default:
      return [];
  }
}
