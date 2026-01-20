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
  Check,
  X,
  Text,
  Loader2,
} from "lucide-react";
import { TransitionPanel } from "@/components/ui/transition-panel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Props = {
  document: Document;
  handleCreateVersion: (processingLevel: 0 | 1 | 2 | 3) => Promise<void>;
  onClose: () => void;
};

// Confirmation Dialog Component
function ConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  selectedProcessing,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  selectedProcessing: 0 | 1 | 2 | 3;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Version</DialogTitle>
          <DialogDescription>
            This will create a new version of your document with{" "}
            <span className="font-medium text-foreground">
              {PROCESSING_ARRAY[selectedProcessing].name}
            </span>{" "}
            processing.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-gradient-to-r from-brand-primary/5 to-brand-primary/10 rounded-lg p-4 border border-brand-primary/20">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center">
              <span className="font-medium text-gray-700 dark:text-gray-300">
                Processing type:
              </span>
              <span className="text-brand-primary font-medium">
                {PROCESSING_ARRAY[selectedProcessing].name}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {PROCESSING_ARRAY[selectedProcessing].description}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Create Version</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Loading Dialog Component
function LoadingDialog({
  isOpen,
  processingType,
}: {
  isOpen: boolean;
  processingType: string;
}) {
  return (
    <Dialog open={isOpen}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="sr-only">Creating Version</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center justify-center py-8 gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-brand-primary" />
          <div className="text-center">
            <p className="text-lg font-semibold mb-1">Creating Version</p>
            <p className="text-sm text-muted-foreground">
              Processing your document with {processingType}...
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CreateVersionDialog({
  document,
  handleCreateVersion,
  onClose,
}: Props) {
  const [selectedProcessing, setSelectedProcessing] = useState<0 | 1 | 2 | 3>(
    0
  );
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const handleShowConfirmation = () => {
    setShowConfirmation(true);
  };

  const handleConfirmCreation = async () => {
    setShowConfirmation(false);
    setIsCreating(true);
    try {
      await handleCreateVersion(selectedProcessing);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <DialogContent
        className="sm:max-w-[700px] h-[600px] overflow-hidden bg-gray-100 flex flex-col"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">New version</DialogTitle>

        {/* Processing Level Selection with Tabs at top */}
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
                className="flex items-center gap-2 text-sm"
              >
                {renderProcessingIcon(item, selectedProcessing === index)}
                {item.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Content Area */}
        <div className="flex-1 mt-4 overflow-y-auto px-1">
          <TransitionPanel
            activeIndex={selectedProcessing}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            variants={{
              enter: { opacity: 0, y: -20, filter: "blur(4px)" },
              center: { opacity: 1, y: 0, filter: "blur(0px)" },
              exit: { opacity: 0, y: 20, filter: "blur(4px)" },
            }}
          >
            {PROCESSING_ARRAY.map((item, index) => (
              <div key={index} className="py-6 px-2">
                <div className="flex items-start gap-4">
                  <div className="flex-1">
                    <h3 className="mb-3 text-2xl font-semibold text-zinc-800 flex items-center gap-2 justify-center">
                      {renderProcessingIcon(item)}
                      {item.name}
                    </h3>
                    <p className="text-zinc-600 leading-relaxed text-center text-md">
                      {item.description}
                    </p>
                    <Card className="mx-auto mt-8 p-3 w-60 gap-2 bg-white">
                      <div className="space-y-2">
                        {getProcessingFeatures(item.name)
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
                  </div>
                </div>
              </div>
            ))}
          </TransitionPanel>
        </div>

        {/* Footer */}
        <div className="flex justify-between pt-0 mt-auto">
          <DialogClose asChild>
            <Button variant="outline" className="bg-white">
              Cancel
            </Button>
          </DialogClose>

          <Button
            onClick={handleShowConfirmation}
            className="bg-brand-primary-dark hover:bg-brand-primary-dark/90"
          >
            Create
          </Button>
        </div>
      </DialogContent>

      <ConfirmationDialog
        isOpen={showConfirmation}
        onClose={() => setShowConfirmation(false)}
        onConfirm={handleConfirmCreation}
        selectedProcessing={selectedProcessing}
      />

      <LoadingDialog
        isOpen={isCreating}
        processingType={PROCESSING_ARRAY[selectedProcessing].name}
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
