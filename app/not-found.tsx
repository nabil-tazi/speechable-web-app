"use client";

import Link from "next/link";
import Image from "next/image";
import { APP_VERSION } from "@/lib/version";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="text-center max-w-md">
        <div className="w-[280px] h-[280px] mx-auto mb-4">
          <Image
            src="/doodles/MessyDoodle.svg"
            alt=""
            width={280}
            height={280}
            className="w-full h-full object-contain"
            priority
          />
        </div>

        <h1 className="text-6xl font-bold text-brand-primary-dark mb-2">404</h1>
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">
          Page not found
        </h2>
        <p className="text-gray-600 mb-8">
          This page doesn't exist.
        </p>

        <Link
          href="/library"
          className="inline-flex items-center justify-center px-6 py-3 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-brand-primary-dark hover:bg-brand-primary-dark/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary-dark transition-colors"
        >
          Back to Library
        </Link>
      </div>

      <p className="text-xs text-gray-400 mt-12">v{APP_VERSION}</p>
    </div>
  );
}
