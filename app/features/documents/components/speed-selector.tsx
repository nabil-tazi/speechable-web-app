import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Gauge } from "lucide-react";

interface SpeedSelectorProps {
  currentSpeed?: number;
  onSpeedChange: (speed: number) => void;
  disabled?: boolean;
  isLoading?: boolean;
}

export function SpeedSelector({
  currentSpeed = 1,
  onSpeedChange,
  disabled = false,
  isLoading = false,
}: SpeedSelectorProps) {
  const [open, setOpen] = useState(false);
  // Local state for pending speed (before applying)
  const [pendingSpeed, setPendingSpeed] = useState(currentSpeed);

  // Reset pending speed when dropdown opens or currentSpeed changes externally
  useEffect(() => {
    if (open) {
      setPendingSpeed(currentSpeed);
    }
  }, [open, currentSpeed]);

  const handleSliderChange = (value: number[]) => {
    setPendingSpeed(value[0]);
  };

  const handleApply = () => {
    if (pendingSpeed !== currentSpeed) {
      onSpeedChange(pendingSpeed);
    }
    setOpen(false);
  };

  const hasChanges = pendingSpeed !== currentSpeed;

  const sliderStyles = `
  .speed-slider [role="slider"] {
    cursor: grab;
  }
  
  .speed-slider [role="slider"]:active {
    cursor: grabbing;
  }
`;

  return (
    <>
      <style>{sliderStyles}</style>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-5  px-1!"
            disabled={disabled}
            title="Playback speed"
          >
            {isLoading ? (
              <div className="animate-spin h-3 w-3 border border-gray-900 border-t-transparent rounded-full" />
            ) : (
              <>
                <Gauge />
                {currentSpeed}×
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 p-4">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Gauge size="16" /> <span>Speed</span>
              </span>
              <span className="text-sm text-gray-900">{pendingSpeed}×</span>
            </div>

            <Slider
              value={[pendingSpeed]}
              onValueChange={handleSliderChange}
              min={0.5}
              max={2}
              step={0.1}
              className="w-full cursor-pointer speed-slider"
            />

            <div className="flex justify-between text-xs text-gray-500">
              <span>0.5×</span>
              <span>1.3×</span>
              <span>2×</span>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => setOpen(false)}
                variant="outline"
                size="sm"
                className="flex-1"
              >
                Cancel
              </Button>
              <Button onClick={handleApply} size="sm" className="flex-1">
                Apply
              </Button>
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
