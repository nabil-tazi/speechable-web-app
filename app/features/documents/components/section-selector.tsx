import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Settings } from "lucide-react";
import { AudioSegment } from "../../audio/types";
import { formatDuration } from "../../audio/utils";
import { Checkbox } from "@/components/ui/checkbox";

interface SectionToggleState {
  [segmentId: string]: boolean;
}

interface SectionSelectorProps {
  allSegments: AudioSegment[];
  sectionToggles: SectionToggleState;
  onSectionToggle: (segmentId: string, enabled: boolean) => void;
  onToggleAll: (enabled: boolean) => void;
}

export function SectionSelector({
  allSegments,
  sectionToggles,
  onSectionToggle,
  onToggleAll,
}: SectionSelectorProps) {
  const [open, setOpen] = useState(false);

  const enabledCount = Object.values(sectionToggles).filter(Boolean).length;
  const totalCount = allSegments.length;
  const allEnabled = enabledCount === totalCount;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 w-9">
          <Settings />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <div className="p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">Select Sections</h3>
            <div className="text-sm text-gray-500">
              {enabledCount}/{totalCount} selected
            </div>
          </div>

          {/* Select All only */}
          <div className="flex items-center space-x-2 mb-4">
            <Checkbox
              id="select-all"
              checked={allEnabled}
              onCheckedChange={(checked) => {
                if (checked) {
                  onToggleAll(true);
                }
              }}
            />
            <Label htmlFor="select-all" className="font-medium">
              Select All
            </Label>
          </div>

          <DropdownMenuSeparator />

          {/* Individual sections */}
          <div className="max-h-64 overflow-y-auto mt-4 space-y-3">
            {allSegments.map((segment) => {
              const isChecked = sectionToggles[segment.id] || false;
              const isLastSelected = isChecked && enabledCount === 1;

              return (
                <div key={segment.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={segment.id}
                    checked={isChecked}
                    disabled={isLastSelected}
                    onCheckedChange={(checked) => {
                      if (checked || !isLastSelected) {
                        onSectionToggle(segment.id, !!checked);
                      }
                    }}
                  />
                  <Label
                    htmlFor={segment.id}
                    className={`flex-1 text-sm cursor-pointer ${
                      isLastSelected ? "text-gray-400" : ""
                    }`}
                  >
                    {segment.section_title ||
                      `Section ${segment.segment_number}`}
                  </Label>
                  <div className="text-xs text-gray-500">
                    {formatDuration(segment.audio_duration || 0)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Helper message when only one section is selected */}
          {enabledCount === 1 && (
            <div className="text-xs text-gray-500 mt-3 px-2">
              At least one section must remain selected
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
