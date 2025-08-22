import { Label } from "@/components/ui/label";
import { Document } from "../types";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { PROCESSING_ARRAY, type ProcessingType } from "../../pdf/types";
import {
  FileAudio,
  FileText,
  GraduationCap,
  MessagesSquare,
  MicVocal,
  Presentation,
} from "lucide-react";

type Props = {
  document: Document;
  handleGenerateVersion: (processingLevel: 0 | 1 | 2 | 3) => void;
  onClose: () => void;
};

export function CreateVersionDialog({
  document,
  handleGenerateVersion,
  onClose,
}: Props) {
  const [selectedProcessing, setSelectedProcessing] = useState<0 | 1 | 2 | 3>(
    0
  );
  return (
    <DialogContent className="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Create a new version </DialogTitle>
        <DialogDescription>
          Configure your version and click generate.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="flex flex-col gap-2">
          {PROCESSING_ARRAY.map((p, index) => (
            <ProcessingLevelCard
              key={index}
              p={p}
              isSelected={selectedProcessing === index}
              select={() => setSelectedProcessing(index as 0 | 1 | 2 | 3)}
            />
          ))}
        </div>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button
          onClick={() => {
            handleGenerateVersion(selectedProcessing);
            onClose();
          }}
        >
          Generate
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ProcessingLevelCard({
  p,
  isSelected,
  select,
}: {
  p: ProcessingType;
  isSelected: boolean;
  select: () => void;
}) {
  return (
    <Card
      className={`p-4 pt-3 flex gap-2 flex-row cursor-pointer ${
        isSelected ? "border-brand-secondary" : "hover:border-gray-400"
      }`}
      onClick={select}
    >
      {renderProcessingIcon(p)}
      <div className="flex flex-col gap-2 pt-1">
        <Label className="cursor-pointer font-semibold">{p.name}</Label>
        <p className="text-sm text-gray-600">{p.description}</p>
      </div>
    </Card>
  );
}

function renderProcessingIcon(p: ProcessingType) {
  switch (p.name) {
    case "Original":
      return <FileAudio />;
    case "Natural":
      return <MicVocal />;
    case "Lecture":
      return <Presentation />;
    case "Conversational":
      return <MessagesSquare />;
  }
}
