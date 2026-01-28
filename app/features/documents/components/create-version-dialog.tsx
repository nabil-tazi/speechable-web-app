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
import { PROCESSING_ARRAY, type ProcessingType } from "../../pdf/types";
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
    0
  );
  const [targetLanguage, setTargetLanguage] = useState<string>(
    document.language || "en"
  );
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasReachedVersionLimit = existingVersions.length >= 6;
  const [showInsufficientCredits, setShowInsufficientCredits] = useState(false);
  const { addProcessingVersion, processingVersions } = useProcessingVersions();
  const { updateCredits } = useCredits();

  // Calculate estimated credits based on document text length
  const estimatedCredits = useMemo(() => {
    if (!document.processed_text) return 0;
    const textLength = extractTextFromProcessedText(document.processed_text).length;
    return Math.ceil((textLength / CHARACTERS_PER_CREDIT) * 10) / 10;
  }, [document.processed_text]);

  const handleContinue = () => {
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
        (v) => v.processing_type === selectedProcessing.toString()
      ).length;
      const pendingCount = processingVersions.filter(
        (v) => v.documentId === document.id && v.processingType === processingTypeName &&
          (v.status === "pending" || v.status === "processing")
      ).length;

      const response = await fetch("/api/generate-version", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: document.id,
          processingLevel: selectedProcessing,
          existingVersionCount: existingCount + pendingCount,
          targetLanguage,
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

      const versionName =
        PROCESSING_ARRAY[selectedProcessing].name +
        (existingCount > 0 ? " " + (existingCount + 1) : "");

      addProcessingVersion({
        versionId: data.versionId,
        documentId: document.id,
        documentTitle: document.title,
        documentThumbnail: document.thumbnail_path,
        versionName,
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
                    {PROCESSING_ARRAY.map((item, index) => (
                      <TabsTrigger
                        key={index}
                        value={index.toString()}
                        className="flex items-center gap-2 text-sm text-gray-500 data-[state=active]:text-gray-900"
                      >
                        {renderProcessingIcon(item, selectedProcessing === index)}
                        {item.name}
                      </TabsTrigger>
                    ))}
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
                                  (b.included ? 1 : 0) - (a.included ? 1 : 0)
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
                        <Card className="p-4 bg-white">
                          <div className="space-y-4">
                            {/* Language Selection */}
                            <div className="space-y-2">
                              <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                <Globe className="w-4 h-4" />
                                Output Language
                              </label>
                              <Select
                                value={targetLanguage}
                                onValueChange={setTargetLanguage}
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
                              <p className="text-xs text-gray-500">
                                The generated audio will be in this language
                              </p>
                            </div>

                          </div>
                        </Card>
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
                      {selectedProcessing === 0 && !needsTranslation ? "Free" : `${estimatedCredits} credits`}
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
