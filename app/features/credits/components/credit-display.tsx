"use client";

import { useEffect, useRef, useState } from "react";
import { useCredits } from "@/app/features/users/context";

function formatRefillDate(dateString: string | null): string {
  if (!dateString) return "Unknown";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Single sliding character component with slot-machine effect
 */
function SlideChar({ char }: { char: string }) {
  const [displayChar, setDisplayChar] = useState(char);
  const [isSliding, setIsSliding] = useState(false);
  const [incomingChar, setIncomingChar] = useState<string | null>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip animation on first render
    if (isFirstRender.current) {
      isFirstRender.current = false;
      setDisplayChar(char);
      return;
    }

    if (char !== displayChar && !isSliding) {
      setIncomingChar(char);
      setIsSliding(true);
    }
  }, [char, displayChar, isSliding]);

  // Handle incoming digit animation end - swap the digits
  const handleAnimationEnd = () => {
    if (incomingChar !== null) {
      setDisplayChar(incomingChar);
      setIncomingChar(null);
      setIsSliding(false);
    }
  };

  // For non-numeric characters (like the decimal point), just render directly
  if (char === ".") {
    return <span className="inline-block w-[0.25em] text-center">.</span>;
  }

  return (
    <span className="relative inline-block w-[0.65em] overflow-hidden text-center">
      {/* Current digit - slides out when isSliding */}
      <span
        className={`inline-block ${
          isSliding ? "translate-y-full transition-transform duration-300 ease-out" : ""
        }`}
      >
        {displayChar}
      </span>

      {/* Incoming digit - slides in from top */}
      {isSliding && incomingChar !== null && (
        <span
          className="absolute left-0 right-0 top-0 text-center animate-slideDown"
          onAnimationEnd={handleAnimationEnd}
        >
          {incomingChar}
        </span>
      )}

      {/* Keyframes injected via style tag */}
      <style jsx>{`
        @keyframes slideDown {
          from {
            transform: translateY(-100%);
          }
          to {
            transform: translateY(0);
          }
        }
        .animate-slideDown {
          animation: slideDown 300ms ease-out forwards;
        }
      `}</style>
    </span>
  );
}

/**
 * Animated number display with sliding digits
 */
function SlideNumber({ value, decimals = 1 }: { value: number; decimals?: number }) {
  const formatted = value.toFixed(decimals);

  return (
    <span className="inline-flex tabular-nums">
      {formatted.split("").map((char, index) => (
        <SlideChar key={index} char={char} />
      ))}
    </span>
  );
}

interface CreditDisplayProps {
  className?: string;
}

export default function CreditDisplay({ className = "" }: CreditDisplayProps) {
  const { credits, nextRefillDate, monthlyAllowance } = useCredits();

  const safeAllowance = monthlyAllowance || 10; // Default to 10 if not set
  const percentRemaining = (credits / safeAllowance) * 100;
  const isLow = credits < safeAllowance * 0.2; // Less than 20% remaining

  return (
    <div className={`group relative ${className}`}>
      <div
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-sm ${
          isLow
            ? "bg-red-500/10 text-red-400"
            : "bg-white/5 text-gray-400 hover:bg-white/10"
        } transition-colors cursor-default`}
      >
        <span className="font-medium">
          <SlideNumber value={credits} decimals={1} />
        </span>
        <span className="text-gray-500">credits</span>
      </div>

      {/* Popover */}
      <div className="absolute right-0 top-full mt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-4 w-56">
          {/* Credits remaining */}
          <div className="flex items-baseline justify-between mb-1">
            <span className={`text-base font-semibold ${isLow ? "text-red-500" : "text-brand-primary-light"}`}>
              {credits.toFixed(2)}
            </span>
            <span className="text-gray-400 text-xs">
              /{safeAllowance} credits
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                isLow ? "bg-red-500" : "bg-brand-primary-light"
              }`}
              style={{ width: `${Math.min(100, Math.max(0, percentRemaining))}%` }}
            />
          </div>

          {/* Renewal date */}
          <div className="text-xs text-gray-400 mt-2">
            Renews on {formatRefillDate(nextRefillDate)}
          </div>

          {/* Plans button */}
          <a
            href="/plans"
            className="mt-3 block w-full text-center py-2 px-4 bg-brand-primary-dark hover:bg-brand-primary text-white text-sm font-medium rounded-lg transition-colors"
          >
            View Plans
          </a>
        </div>
      </div>
    </div>
  );
}
