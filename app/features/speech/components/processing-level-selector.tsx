import React, { useState } from "react";
import {
  PREPROCESSING_LEVELS,
  PreprocessingLevel,
} from "@/app/features/pdf/types";
import { Tooltip } from "react-tooltip";

interface ProcessingLevelSelectorProps {
  level: PreprocessingLevel;
  onLevelChange: (level: PreprocessingLevel) => void;
  canReprocess: boolean;
  isProcessing: boolean;
  onReprocess: () => void;
  handleProcessWithAi: () => void;
}

export default function ProcessingLevelSelector({
  level,
  onLevelChange,
  canReprocess,
  isProcessing,
  onReprocess,
  handleProcessWithAi,
}: ProcessingLevelSelectorProps) {
  // Processing is enabled when level > 0 (not Raw)
  const processingEnabled = level > 0;

  const handleProcessingToggle = () => {
    if (processingEnabled) {
      // Switch to Raw (level 0)
      onLevelChange(0 as PreprocessingLevel);
    } else {
      // Switch to Faithful (level 1)
      onLevelChange(1 as PreprocessingLevel);
    }
  };

  const currentLevel = PREPROCESSING_LEVELS[level];

  // Map levels 1-4 to display positions 0-3 for the segmented selector
  const displayLevel = level > 0 ? level - 1 : 0;

  // Only show processed levels (1-4) in the segmented selector
  const processedLevels = [1, 2, 3, 4].map((lvl) => ({
    level: lvl,
    data: PREPROCESSING_LEVELS[lvl as PreprocessingLevel],
  }));

  return (
    <div>
      <div className="space-y-6">
        {/* Processing Section Wrapper */}
        <div className="flex flex-col gap-5 p-4">
          {/* Processing Toggle */}
          <div className="flex justify-between p-4">
            {/* Left side Title */}

            <div className="flex flex-col items-start gap-1">
              <span>Content Processing</span>
              <span className="text-sm text-gray-600">
                Use AI for a better listening experience
              </span>
            </div>
            {/* <div className="flex flex-col justify-start">
              <span className="font-medium text-gray-900">
                Content Processing
              </span>
              <p className="text-sm text-gray-600 mt-1">
                Transform content for better listening experience
              </p>
            </div> */}

            {/* Right side toggle */}
            <button
              onClick={handleProcessingToggle}
              className="flex items-center focus:outline-none cursor-pointer"
              data-tooltip-id="my-tooltip"
              data-tooltip-content="This is a tooltip!"
            >
              <div
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  processingEnabled ? "bg-brand-secondary" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    processingEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </div>
              <Tooltip id="my-tooltip" />
            </button>
          </div>

          {/* Processing Level Selector - Only shown when processing is enabled */}
          {processingEnabled && (
            <>
              {/* Segmented Level Selector */}
              <div className="space-y-3 p-10">
                <div className="relative bg-gray-100 rounded-full p-1 border-4  border-gray-100">
                  {/* Sliding selector background */}
                  <div
                    className="absolute inset-0 bg-brand-secondary rounded-full transition-all duration-300 ease-out shadow-sm"
                    style={{
                      left: `${(displayLevel / 3) * 100}%`,
                      width: "25%",
                      transform: `translateX(-${(displayLevel / 3) * 100}%)`,
                    }}
                  />

                  {/* Level buttons */}
                  <div className="relative grid grid-cols-4">
                    {processedLevels.map(({ level: lvl, data }) => (
                      <button
                        key={lvl}
                        // data-tooltip-id={"my-tooltip-" + lvl}
                        // data-tooltip-content="This is a tooltip!"
                        onClick={() => onLevelChange(lvl as PreprocessingLevel)}
                        className={`py-2 px-3 text-center transition-colors duration-300 relative z-10 hover:font-semibold ${
                          level === lvl
                            ? "text-white font-semibold"
                            : "text-gray-700 hover:text-gray-900 cursor-pointer font-medium"
                        }`}
                      >
                        <div className="text-sm">{data.name}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Level indicators */}
                {/* <div className="flex justify-between text-xs text-gray-500 px-2">
                  <span>Faithful</span>
                  <span>Optimized for Listening</span>
                </div> */}
              </div>

              {/* Content Transformation Metrics */}
              <div className="bg-white p-4">
                <div className="flex flex-col justify-between items-center mb-3">
                  <p className="text-sm italic text-gray-600 pt-2">
                    {currentLevel.description}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-6 p-10">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-600">
                        Source Accuracy
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div
                        className="bg-brand-secondary h-3 rounded-full transition-all"
                        style={{
                          width: `${
                            ((currentLevel.sourceAccuracy || 3) / 5) * 100
                          }%`,
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-600">
                        Listening Ease
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div
                        className="bg-brand-secondary h-3 rounded-full transition-all"
                        style={{
                          width: `${
                            ((currentLevel.listeningEase || 3) / 5) * 100
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
              {/* Start Processing Button */}
              {!canReprocess && (
                <div className="p-6">
                  <button
                    onClick={handleProcessWithAi}
                    disabled={isProcessing}
                    className="w-full bg-brand-secondary hover:bg-blue-500 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isProcessing ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                        Processing with AI...
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                          />
                        </svg>
                        Start AI Processing
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Current Level Description */}
              {/* <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                <p className="text-sm text-blue-800">
                  <strong>{currentLevel.name}:</strong>{" "}
                  {currentLevel.description}
                </p>
              </div> */}
            </>
          )}
        </div>

        {/* Raw Text Description - Only shown when processing is disabled */}
        {!processingEnabled && (
          <div className="bg-gray-100 rounded-lg p-4 border border-gray-200">
            <p className="text-sm text-gray-700">
              <strong>Raw Text:</strong> {currentLevel.description}
            </p>
          </div>
        )}

        {/* Action Button - Always shown */}
        {canReprocess && (
          <button
            onClick={onReprocess}
            disabled={isProcessing}
            className="w-full inline-flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isProcessing ? (
              <>
                <svg
                  className="animate-spin h-4 w-4 mr-2"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                {processingEnabled
                  ? `Processing with ${currentLevel.name} (${
                      currentLevel.time || "~5s"
                    })`
                  : "Processing raw text (~1s)"}
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                {processingEnabled
                  ? `Process with ${currentLevel.name}`
                  : "Process raw text"}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
