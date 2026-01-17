import type { Block } from "@/app/features/documents/types";

/**
 * Get the heading level from a block type.
 * Returns 0 for non-heading blocks.
 */
function getHeadingLevel(type: string): number {
  if (type === "heading1") return 1;
  if (type === "heading2") return 2;
  if (type === "heading3") return 3;
  if (type === "heading4") return 4;
  return 0; // Not a heading
}

/**
 * Compute which blocks are in a disabled section.
 *
 * A block is considered disabled if:
 * 1. It's a heading with `disabled: true`, OR
 * 2. It follows a disabled heading until the next heading of same or higher level
 *
 * @param blocks - Array of blocks sorted by order
 * @returns Set of block IDs that are disabled
 */
export function getDisabledBlockIds(blocks: Block[]): Set<string> {
  const disabledIds = new Set<string>();
  const sortedBlocks = [...blocks].sort((a, b) => a.order - b.order);

  let currentDisabledLevel = 0; // 0 means not in a disabled section

  for (const block of sortedBlocks) {
    const headingLevel = getHeadingLevel(block.type);

    if (headingLevel > 0) {
      // This is a heading
      if (block.disabled) {
        // This heading is disabled - start/continue disabled section
        disabledIds.add(block.id);
        // Only take control if not already controlled by a higher-priority (lower number) level
        if (currentDisabledLevel === 0 || headingLevel < currentDisabledLevel) {
          currentDisabledLevel = headingLevel;
        }
      } else if (currentDisabledLevel > 0 && headingLevel > currentDisabledLevel) {
        // Sub-heading within a disabled section - also disabled
        disabledIds.add(block.id);
      } else {
        // Same or higher level heading that's not disabled - end disabled section
        currentDisabledLevel = 0;
      }
    } else {
      // Text block
      if (currentDisabledLevel > 0) {
        // Inside a disabled section
        disabledIds.add(block.id);
      }
    }
  }

  return disabledIds;
}

/**
 * Check if a specific block is in a disabled section.
 */
export function isBlockDisabled(blocks: Block[], blockId: string): boolean {
  const disabledIds = getDisabledBlockIds(blocks);
  return disabledIds.has(blockId);
}
