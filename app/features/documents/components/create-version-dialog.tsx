import { Document, DocumentVersion } from "../types";
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
import React, { useState, useMemo } from "react";
import { useCredits } from "@/app/features/users/context";
import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  PROCESSING_ARRAY,
  LECTURE_DURATIONS,
  CONVERSATIONAL_DURATIONS,
  MAX_VERSIONS_PER_DOCUMENT,
  type ProcessingType,
  type LectureDuration,
  type ConversationalDuration,
} from "../../pdf/types";
import {
  FileText,
  MessagesSquare,
  MicVocal,
  Presentation,
  Check,
  X,
  Text,
  Loader2,
  ChevronLeft,
  Globe,
  Timer,
} from "lucide-react";
import { TransitionPanel } from "@/components/ui/transition-panel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProcessingVersions } from "../context/processing-context";
import { InsufficientCreditsDialog } from "./insufficient-credits-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SUPPORTED_LANGUAGES } from "@/app/features/audio/supported-languages";
import { extractTextFromProcessedText } from "../utils";
import { motion, AnimatePresence } from "motion/react";

type Props = {
  document: Document;
  existingVersions: DocumentVersion[];
  onClose: () => void;
};

const CHARACTERS_PER_CREDIT = 10000;

export function CreateVersionDialog({
  document,
  existingVersions,
  onClose,
}: Props) {
  const [step, setStep] = useState<0 | 1>(0);
  const [selectedProcessing, setSelectedProcessing] = useState<0 | 1 | 2 | 3>(
    0,
  );
  const [targetLanguage, setTargetLanguage] = useState<string>(
    document.language || "en",
  );
  const [lectureDuration, setLectureDuration] =
    useState<LectureDuration>("medium");
  const [conversationalDuration, setConversationalDuration] =
    useState<ConversationalDuration>("medium");
  const [versionName, setVersionName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasReachedVersionLimit = existingVersions.length >= MAX_VERSIONS_PER_DOCUMENT;
  const [showInsufficientCredits, setShowInsufficientCredits] = useState(false);
  const { addProcessingVersion, processingVersions } = useProcessingVersions();
  const { updateCredits } = useCredits();

  // Source document character count
  const sourceCharCount = useMemo(() => {
    if (!document.processed_text) return 0;
    return extractTextFromProcessedText(document.processed_text).length;
  }, [document.processed_text]);

  // Check if any lecture duration is available
  const isLectureAvailable = LECTURE_DURATIONS.some(
    (d) => sourceCharCount >= d.minSourceChars,
  );

  // Check if any conversational duration is available
  const isConversationalAvailable = CONVERSATIONAL_DURATIONS.some(
    (d) => sourceCharCount >= d.minSourceChars,
  );

  // Auto-select highest available duration if current selection is disabled
  React.useEffect(() => {
    if (selectedProcessing !== 2) return;
    const currentConfig = LECTURE_DURATIONS.find((d) => d.value === lectureDuration);
    if (currentConfig && sourceCharCount >= currentConfig.minSourceChars) return;
    const available = [...LECTURE_DURATIONS]
      .reverse()
      .find((d) => sourceCharCount >= d.minSourceChars);
    if (available) setLectureDuration(available.value);
  }, [selectedProcessing, sourceCharCount, lectureDuration]);

  // Auto-select highest available conversational duration if current selection is disabled
  React.useEffect(() => {
    if (selectedProcessing !== 3) return;
    const currentConfig = CONVERSATIONAL_DURATIONS.find((d) => d.value === conversationalDuration);
    if (currentConfig && sourceCharCount >= currentConfig.minSourceChars) return;
    const available = [...CONVERSATIONAL_DURATIONS]
      .reverse()
      .find((d) => sourceCharCount >= d.minSourceChars);
    if (available) setConversationalDuration(available.value);
  }, [selectedProcessing, sourceCharCount, conversationalDuration]);

  // Calculate estimated credits based on document text length, processing type, and duration
  const estimatedCredits = useMemo(() => {
    if (!document.processed_text) return 0;
    const isTranslating = targetLanguage !== (document.language || "en");
    if (selectedProcessing === 0 && !isTranslating) return 0;
    const textLength = extractTextFromProcessedText(
      document.processed_text,
    ).length;
    const baseCredits = textLength / CHARACTERS_PER_CREDIT;
    const multiplier =
      selectedProcessing === 2
        ? (LECTURE_DURATIONS.find((d) => d.value === lectureDuration)
            ?.creditMultiplier ?? 1)
        : selectedProcessing === 3
          ? (CONVERSATIONAL_DURATIONS.find((d) => d.value === conversationalDuration)
              ?.creditMultiplier ?? 1)
          : 1;
    return Math.ceil(baseCredits * multiplier * 10) / 10;
  }, [
    document.processed_text,
    document.language,
    selectedProcessing,
    lectureDuration,
    conversationalDuration,
    targetLanguage,
  ]);

  const computeDefaultVersionName = (lang: string) => {
    const processingTypeName = PROCESSING_ARRAY[selectedProcessing].name;
    const needsLangSuffix = lang !== (document.language || "en");
    const langLabel = needsLangSuffix
      ? ` (${SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.name || lang})`
      : "";
    const baseName = processingTypeName + langLabel;

    // Check existing versions + pending for name collision
    const existingNames = new Set([
      ...existingVersions.map((v) => v.version_name),
      ...processingVersions
        .filter(
          (v) =>
            v.documentId === document.id &&
            (v.status === "pending" || v.status === "processing"),
        )
        .map((v) => v.versionName),
    ]);

    if (!existingNames.has(baseName)) return baseName;
    let i = 2;
    while (existingNames.has(`${baseName} ${i}`)) i++;
    return `${baseName} ${i}`;
  };

  const handleContinue = () => {
    setVersionName(computeDefaultVersionName(targetLanguage));
    setStep(1);
  };

  const handleBack = () => {
    setStep(0);
  };

  const handleCreateVersion = async () => {
    setError(null);
    setIsCreating(true);

    try {
      const processingTypeName = PROCESSING_ARRAY[selectedProcessing].name;
      const existingCount = existingVersions.filter(
        (v) => v.processing_type === selectedProcessing.toString(),
      ).length;
      const pendingCount = processingVersions.filter(
        (v) =>
          v.documentId === document.id &&
          v.processingType === processingTypeName &&
          (v.status === "pending" || v.status === "processing"),
      ).length;

      const response = await fetch("/api/generate-version", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: document.id,
          processingLevel: selectedProcessing,
          existingVersionCount: existingCount + pendingCount,
          targetLanguage,
          lectureDuration,
          conversationalDuration,
          versionName: versionName.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        if (response.status === 402) {
          setShowInsufficientCredits(true);
          setIsCreating(false);
          return;
        }

        throw new Error(errorData.error || "Failed to create version");
      }

      const data = await response.json();

      if (data.newCreditBalance !== undefined) {
        updateCredits(data.newCreditBalance);
      }

      const finalVersionName =
        versionName.trim() || PROCESSING_ARRAY[selectedProcessing].name;

      addProcessingVersion({
        versionId: data.versionId,
        documentId: document.id,
        documentTitle: document.title,
        documentThumbnail: document.thumbnail_path,
        versionName: finalVersionName,
        processingType: PROCESSING_ARRAY[selectedProcessing].name,
      });

      onClose();
    } catch (err) {
      console.error("Failed to start version creation:", err);
      setError(err instanceof Error ? err.message : "Failed to create version");
      setIsCreating(false);
    }
  };

  const needsTranslation = targetLanguage !== (document.language || "en");

  const getCreditsText = () => {
    if (selectedProcessing === 0 && !needsTranslation) {
      return "Create";
    }
    return `Create (${estimatedCredits} credits)`;
  };

  const selectedItem = PROCESSING_ARRAY[selectedProcessing];

  return (
    <>
      <DialogContent
        className="sm:max-w-[700px] h-[600px] overflow-hidden bg-gray-100 flex flex-col"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">New version</DialogTitle>

        {/* Header area - Tabs or Back button */}
        <div className="relative h-10">
          <AnimatePresence mode="wait">
            {step === 0 ? (
              <motion.div
                key="tabs"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.2 }}
              >
                <Tabs
                  value={selectedProcessing.toString()}
                  onValueChange={(value) =>
                    setSelectedProcessing(parseInt(value) as 0 | 1 | 2 | 3)
                  }
                >
                  <TabsList className="grid w-full grid-cols-4">
                    {PROCESSING_ARRAY.map((item, index) => {
                      const isDisabled = (index === 2 && !isLectureAvailable) || (index === 3 && !isConversationalAvailable);
                      const trigger = (
                        <TabsTrigger
                          key={index}
                          value={index.toString()}
                          disabled={isDisabled}
                          className="flex items-center gap-2 text-sm text-gray-500 data-[state=active]:text-gray-900"
                        >
                          {renderProcessingIcon(
                            item,
                            selectedProcessing === index,
                          )}
                          {item.name}
                        </TabsTrigger>
                      );
                      if (isDisabled) {
                        return (
                          <Tooltip key={index} delayDuration={0}>
                            <TooltipTrigger asChild>
                              <div>
                                <TabsTrigger
                                  value={index.toString()}
                                  disabled
                                  className="flex items-center gap-2 text-sm text-gray-500 w-full pointer-events-auto"
                                >
                                  {renderProcessingIcon(item, false)}
                                  {item.name}
                                </TabsTrigger>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              <p>Document not long enough</p>
                            </TooltipContent>
                          </Tooltip>
                        );
                      }
                      return trigger;
                    })}
                  </TabsList>
                </Tabs>
              </motion.div>
            ) : (
              <motion.div
                key="back"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBack}
                  className="p-1 h-8 w-8"
                  disabled={isCreating}
                >
                  <ChevronLeft className="w-5 h-5" />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Content Area */}
        <motion.div
          className="flex-1 overflow-y-auto px-1"
          animate={{ marginTop: step === 1 ? "-20px" : "16px" }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
        >
          <motion.div
            className="px-2"
            animate={{ paddingTop: step === 1 ? "0px" : "24px" }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
          >
            <div className="flex items-start gap-4">
              <div className="flex-1">
                {/* Title and description - animates when switching processing type */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={`title-${selectedProcessing}`}
                    initial={{ opacity: 0, y: -20, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: 20, filter: "blur(4px)" }}
                    transition={{ duration: 0.2 }}
                  >
                    <h3 className="mb-3 text-2xl font-semibold text-zinc-800 flex items-center gap-2 justify-center">
                      {renderProcessingIcon(selectedItem)}
                      {selectedItem.name}
                    </h3>
                    <p className="text-zinc-600 leading-relaxed text-center text-md">
                      {selectedItem.description}
                    </p>
                  </motion.div>
                </AnimatePresence>

                {/* Card content - transitions between features and language */}
                <div className="mx-auto mt-8 w-72">
                  <AnimatePresence mode="wait">
                    {step === 0 ? (
                      <motion.div
                        key={`features-${selectedProcessing}`}
                        initial={{ opacity: 0, y: -20, filter: "blur(4px)" }}
                        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                        exit={{ opacity: 0, y: 20, filter: "blur(4px)" }}
                        transition={{ duration: 0.2 }}
                      >
                        <Card className="p-3 bg-white">
                          <div className="space-y-2">
                            {getProcessingFeatures(selectedItem.name)
                              .sort(
                                (a, b) =>
                                  (b.included ? 1 : 0) - (a.included ? 1 : 0),
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
                                        ? "text-gray-800"
                                        : "text-gray-400 line-through"
                                    }`}
                                  >
                                    {feature.feature}
                                  </span>
                                </div>
                              ))}
                          </div>
                        </Card>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="language"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.25 }}
                      >
                        <div className="space-y-6">
                          {/* Language Selection */}
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                              <Globe className="w-4 h-4" />
                              Output Language
                            </label>
                            <Select
                              value={targetLanguage}
                              onValueChange={(lang) => {
                                setTargetLanguage(lang);
                                setVersionName(computeDefaultVersionName(lang));
                              }}
                            >
                              <SelectTrigger className="w-full bg-white">
                                <SelectValue placeholder="Select language" />
                              </SelectTrigger>
                              <SelectContent>
                                {SUPPORTED_LANGUAGES.map((lang) => (
                                  <SelectItem key={lang.code} value={lang.code}>
                                    {lang.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Duration selector for Lecture and Conversational */}
                          {(selectedProcessing === 2 || selectedProcessing === 3) && (() => {
                            const durations = selectedProcessing === 2 ? LECTURE_DURATIONS : CONVERSATIONAL_DURATIONS;
                            const activeDuration = selectedProcessing === 2 ? lectureDuration : conversationalDuration;
                            const setDuration = selectedProcessing === 2 ? setLectureDuration : setConversationalDuration;
                            return (
                              <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                  <Timer className="w-4 h-4" />
                                  Duration
                                </label>
                                <div className="grid grid-cols-3 gap-1.5">
                                  {durations.map((d) => {
                                    const isDurationDisabled = sourceCharCount < d.minSourceChars;
                                    const btn = (
                                      <button
                                        key={d.value}
                                        type="button"
                                        disabled={isDurationDisabled}
                                        onClick={() => setDuration(d.value)}
                                        className={`px-2 py-1.5 rounded-md text-sm border transition-colors ${
                                          isDurationDisabled
                                            ? "border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed"
                                            : activeDuration === d.value
                                              ? "border-gray-800 bg-gray-800 text-white"
                                              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                                        }`}
                                      >
                                        <div className="font-medium">{d.label}</div>
                                        <div
                                          className={`text-xs ${isDurationDisabled ? "text-gray-300" : activeDuration === d.value ? "text-gray-300" : "text-gray-400"}`}
                                        >
                                          {d.description}
                                        </div>
                                      </button>
                                    );
                                    if (isDurationDisabled) {
                                      return (
                                        <Tooltip key={d.value} delayDuration={0}>
                                          <TooltipTrigger asChild>{btn}</TooltipTrigger>
                                          <TooltipContent>
                                            <p>Document not long enough</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      );
                                    }
                                    return btn;
                                  })}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Credits cost */}
                          <div className="pt-4 mt-10 border-t border-gray-300">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-500">
                                Estimated cost
                              </span>
                              <span className="font-medium text-gray-700">
                                {estimatedCredits === 0
                                  ? "Free"
                                  : `${estimatedCredits} credits`}
                              </span>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>

        {/* Footer */}
        <div className="flex justify-between pt-0 mt-auto">
          <AnimatePresence mode="wait">
            {step === 0 ? (
              <motion.div
                key="cancel"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <DialogClose asChild>
                  <Button variant="outline" className="bg-white">
                    Cancel
                  </Button>
                </DialogClose>
              </motion.div>
            ) : (
              <motion.div
                key="back"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <Button
                  variant="outline"
                  className="bg-white"
                  onClick={handleBack}
                  disabled={isCreating}
                >
                  Back
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {step === 0 ? (
              <motion.div
                key="continue"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <Button
                  onClick={handleContinue}
                  className="bg-brand-primary-dark hover:bg-brand-primary-dark/90"
                >
                  Continue
                </Button>
              </motion.div>
            ) : (
              <motion.div
                key="create"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={handleCreateVersion}
                        className="bg-brand-primary-dark hover:bg-brand-primary-dark/90"
                        disabled={isCreating || hasReachedVersionLimit}
                      >
                        {isCreating ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Creating...
                          </>
                        ) : hasReachedVersionLimit ? (
                          "Version limit reached"
                        ) : (
                          "Create"
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {selectedProcessing === 0 && !needsTranslation
                        ? "Free"
                        : `${estimatedCredits} credits`}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>

      {/* Error Dialog */}
      <Dialog open={error !== null} onOpenChange={() => setError(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
            <DialogDescription>{error}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setError(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Insufficient Credits Dialog */}
      <InsufficientCreditsDialog
        isOpen={showInsufficientCredits}
        onClose={() => setShowInsufficientCredits(false)}
      />
    </>
  );
}

function renderProcessingIcon(
  p: ProcessingType,
  isActive: boolean = false,
  className: string = "w-4 h-4",
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
  processingType: string,
): { feature: string; included: boolean }[] {
  switch (processingType) {
    case "Original":
      return [
        { feature: "Original phrasing", included: true },
        { feature: "Chapter and section breaks", included: true },
        { feature: "Clean up document artifacts", included: true },
        { feature: "Natural sounding phrasing", included: false },
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
