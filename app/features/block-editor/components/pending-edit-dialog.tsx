import React from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface PendingEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
  onKeep: () => void;
}

/**
 * Alert dialog shown when user clicks outside while pending AI edits exist.
 * Asks user whether to keep or discard the pending changes.
 */
export function PendingEditDialog({
  open,
  onOpenChange,
  onDiscard,
  onKeep,
}: PendingEditDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Pending AI edits</AlertDialogTitle>
          <AlertDialogDescription>
            Do you want to keep or discard pending AI edits?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-between">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onDiscard}>
              Discard
            </Button>
            <AlertDialogAction onClick={onKeep}>Keep</AlertDialogAction>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
