"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Coins, ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

interface InsufficientCreditsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function InsufficientCreditsDialog({
  isOpen,
  onClose,
}: InsufficientCreditsDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="sr-only">Insufficient Credits</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center text-center py-4">
          {/* Doodle */}
          <div className="relative w-40 h-40 mb-4">
            <Image
              src="/doodles/CoffeeDoddle.svg"
              alt="Taking a break"
              fill
              className="object-contain"
            />
          </div>

          {/* Title */}
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Not enough credits
          </h2>

          {/* Description */}
          <p className="text-gray-600 mb-6">
            You need more credits to create this version.
          </p>

          {/* Actions */}
          <div className="flex flex-col gap-3 w-full">
            <Button asChild className="w-full">
              <Link href="/plans">
                <Coins className="w-4 h-4 mr-2" />
                Get more credits
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
            <Button variant="outline" onClick={onClose} className="w-full">
              Maybe later
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
