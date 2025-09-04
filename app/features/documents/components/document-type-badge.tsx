import { DOCUMENT_TYPE_CONFIG } from "@/app/api/classify-document/constants";

import { DocumentType } from "@/app/features/documents/types";
import { Badge } from "@/components/ui/badge";
import { File } from "lucide-react";

interface DocumentTypeBadgeProps {
  type: DocumentType;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

const SIZE_CONFIG = {
  sm: {
    iconSize: "w-3 h-3",
    textSize: "text-xs",
    padding: "px-2 py-1",
  },
  md: {
    iconSize: "w-4 h-4",
    textSize: "text-sm",
    padding: "px-2.5 py-1.5",
  },
  lg: {
    iconSize: "w-5 h-5",
    textSize: "text-base",
    padding: "px-3 py-2",
  },
} as const;

const DEFAULT_CONFIG = {
  icon: File,
  label: "Unknown",
  className: "bg-gray-100 text-gray-600 border-gray-300 hover:bg-gray-200",
};

export function DocumentTypeBadge({
  type,
  size = "sm",
  showLabel = true,
}: DocumentTypeBadgeProps) {
  // Use the specific config if it exists, otherwise fall back to default
  const config = DOCUMENT_TYPE_CONFIG[type] || DEFAULT_CONFIG;
  const sizeConfig = SIZE_CONFIG[size];
  const IconComponent = config.icon;

  // For unknown types, use the actual type value as label if showLabel is true
  const displayLabel = showLabel
    ? DOCUMENT_TYPE_CONFIG[type]
      ? config.label
      : type || "Unknown"
    : null;

  return (
    <Badge
      variant="secondary"
      className={`
        inline-flex items-center gap-1.5 font-medium 
        
      `}
    >
      <IconComponent className={sizeConfig.iconSize} />
      {displayLabel && <span>{displayLabel}</span>}
    </Badge>
  );
}
//        // ${config.className}
//${sizeConfig.textSize}
// ${sizeConfig.padding}
// ${className}
