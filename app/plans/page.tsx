"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HeaderUserMenu } from "@/components/header-user-menu";
import CreditDisplay from "@/app/features/credits/components/credit-display";

function FeatureItem({
  children,
  highlight = false,
}: {
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <Check className="w-4 h-4 text-brand-primary flex-shrink-0 mt-0.5" />
      <span className={highlight ? "font-medium" : ""}>{children}</span>
    </li>
  );
}

export default function PlansPage() {
  const router = useRouter();
  const [isYearly, setIsYearly] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-b from-sidebar to-white">
      {/* Header */}
      <div className="sticky top-0 z-20">
        <div className="pl-2 pr-4 h-12 flex items-center bg-sidebar">
          <div className="flex items-center gap-1 flex-1">
            <Button
              variant="ghost"
              onClick={() => router.back()}
              className="h-8 px-2 gap-1"
              title="Back to library"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="text-sm">Return</span>
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <CreditDisplay />
            <HeaderUserMenu />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-3">
            Listen to anything, anywhere
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto mb-8">
            Transform your documents into natural-sounding audio. Start free,
            upgrade when you need more.
          </p>

          {/* Billing Toggle */}
          <div className="inline-flex items-center gap-3 bg-gray-100 p-1 rounded-full">
            <button
              onClick={() => setIsYearly(false)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                !isYearly
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setIsYearly(true)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                isYearly
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Annual
              <span className="text-xs bg-brand-primary/10 text-brand-primary-dark px-2 py-0.5 rounded-full">
                Save 57%
              </span>
            </button>
          </div>
        </div>

        {/* Plan Cards */}
        <div className="grid gap-6 lg:grid-cols-3 mb-8">
          {/* Free Plan */}
          <Card className="relative bg-white border border-gray-200 overflow-hidden flex flex-col">
            <CardContent className="pt-0 flex flex-col flex-1">
              <h3 className="text-2xl font-bold text-gray-900 mb-3">Free</h3>
              <div className="flex items-baseline gap-1 mb-6">
                <span className="text-4xl font-bold text-brand-primary-dark">
                  $0
                </span>
                <span className="text-gray-500">/month</span>
              </div>

              <ul className="space-y-3 text-gray-700 flex-1">
                <FeatureItem>Up to 3 documents</FeatureItem>
                <FeatureItem>Unlimited playback<sup>1</sup></FeatureItem>
                <FeatureItem>Skip references & artifacts</FeatureItem>
                <FeatureItem highlight>
                  10 credits/month<sup>2</sup>
                </FeatureItem>
              </ul>

              <Button variant="outline" className="w-full mt-6" disabled>
                Current Plan
              </Button>
            </CardContent>
          </Card>

          {/* Premium Plan */}
          <Card className="relative bg-white border-2 border-brand-primary-dark shadow-xl flex flex-col">
            <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-primary-dark text-white">
              Best value
            </Badge>
            <CardContent className="pt-0 flex flex-col flex-1">
              <h3 className="text-2xl font-bold text-gray-900 mb-3">Premium</h3>
              <div className="flex items-baseline gap-2 mb-2 h-10">
                {isYearly && (
                  <span className="text-2xl font-bold text-gray-400 line-through">
                    $7
                  </span>
                )}
                <span className="text-4xl font-bold text-brand-primary-dark">
                  {isYearly ? "$3" : "$7"}
                </span>
                <span className="text-gray-500">/month</span>
              </div>
              <p className="text-sm text-gray-500 mb-6">
                {isYearly ? (
                  <>
                    <span className="font-semibold text-gray-900">$36/year</span>{" "}
                    billed annually
                  </>
                ) : (
                  <>
                    or <span className="font-semibold text-gray-900">$3/month</span>{" "}
                    billed annually
                  </>
                )}
              </p>

              <ul className="space-y-3 text-gray-700 flex-1">
                <FeatureItem>Unlimited documents</FeatureItem>
                <FeatureItem>Unlimited playback<sup>1</sup></FeatureItem>
                <FeatureItem>Skip references & artifacts</FeatureItem>
                <FeatureItem>Download generated audio</FeatureItem>
                <FeatureItem highlight>
                  600 credits/month<sup>2</sup>
                </FeatureItem>
                <FeatureItem>Priority support</FeatureItem>
              </ul>

              <Button className="w-full mt-6 bg-brand-primary-dark text-white hover:bg-brand-primary-dark/90 font-semibold">
                Upgrade to Premium
              </Button>
            </CardContent>
          </Card>

          {/* One-time Purchase */}
          <Card className="relative bg-white border border-gray-200 overflow-hidden flex flex-col">
            <CardContent className="pt-0 flex flex-col flex-1">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-2xl font-bold text-gray-900">Credit Pack</h3>
                <Badge variant="secondary" className="bg-gray-100 text-gray-600">
                  One-time
                </Badge>
              </div>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-4xl font-bold text-gray-900">$5</span>
                <span className="text-gray-500">one-time</span>
              </div>
              <p className="text-sm text-gray-500 mb-6">
                No subscription needed
              </p>

              <ul className="space-y-3 text-gray-700 flex-1">
                <FeatureItem highlight>
                  <span>
                    150 credits{" "}
                    <span className="text-gray-500 font-normal">
                      added to your balance
                    </span>
                  </span>
                </FeatureItem>
                <FeatureItem>Never expires</FeatureItem>
                <FeatureItem>Use for AI & Cloud voices</FeatureItem>
              </ul>

              <Button variant="outline" className="w-full mt-6">
                Buy Credits
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Footnotes */}
        <div className="max-w-2xl mx-auto space-y-4">
          <p className="text-gray-500 text-sm">
            <span className="font-medium text-gray-700"><sup>1</sup> Eco mode</span> — Energy-efficient playback using up to 20x less power than cloud. Same high-quality AI voices, unlimited usage, no credits needed. Requires a modern desktop browser.
          </p>
          <p className="text-gray-500 text-sm">
            <span className="font-medium text-gray-700"><sup>2</sup> Credits</span> — Used for AI text processing (1 credit ≈ 10,000 characters), cloud voice playback (1 credit ≈ 2 min at 1x speed), and MP3 downloads. Refresh monthly.
          </p>
        </div>
      </main>
    </div>
  );
}
