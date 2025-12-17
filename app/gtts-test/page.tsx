"use client";

import { useState, useEffect, useRef } from "react";

// Google TTS supported languages
const GTTS_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese (Mandarin)" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "tr", name: "Turkish" },
  { code: "pl", name: "Polish" },
  { code: "nl", name: "Dutch" },
  { code: "sv", name: "Swedish" },
  { code: "da", name: "Danish" },
  { code: "no", name: "Norwegian" },
  { code: "fi", name: "Finnish" },
  { code: "th", name: "Thai" },
  { code: "vi", name: "Vietnamese" },
  { code: "uk", name: "Ukrainian" },
  { code: "cs", name: "Czech" },
  { code: "hu", name: "Hungarian" },
  { code: "ro", name: "Romanian" },
  { code: "bg", name: "Bulgarian" },
  { code: "hr", name: "Croatian" },
  { code: "sk", name: "Slovak" },
  { code: "sl", name: "Slovenian" },
  { code: "et", name: "Estonian" },
  { code: "lv", name: "Latvian" },
  { code: "lt", name: "Lithuanian" },
];

export default function GTTSTestPage() {
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("en");
  const [slow, setSlow] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [preprocessText, setPreprocessText] = useState(true);
  const [unitedStatesReplacement, setUnitedStatesReplacement] = useState("america");
  const [fixPrepositionPhrases, setFixPrepositionPhrases] = useState(false);
  const [fixLastWordPause, setFixLastWordPause] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [processedText, setProcessedText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Update playback speed when it changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Text preprocessing function to fix common TTS issues
  const preprocessTextForTTS = (inputText: string): string => {
    console.log('Preprocessing with fixLastWordPause:', fixLastWordPause);
    let processedText = inputText;

    // Fix numbered items with periods (like "22 q 11. 2" -> "22 q 11 point 2")
    processedText = processedText.replace(/(\d+)\s*\.\s*(\d+)/g, '$1 point $2');
    
    // Fix chromosome notation (like "22 q 11. 2 DS" -> "22 q 11 point 2 DS")
    processedText = processedText.replace(/(\d+)\s*q\s*(\d+)\s*\.\s*(\d+)/g, '$1 q $2 point $3');
    
    // Fix compound words with hyphens first, then apply United States replacement
    processedText = processedText.replace(/united-states/gi, 'United States');
    
    // Apply United States replacement strategy
    const replacements: Record<string, string> = {
      'america': 'America',
      'us': 'U S',  // Spaced out to avoid confusion with "us" pronoun
      'lowercase': 'united states',
      'hyphenated': 'United-States',
      'original': 'United States'
    };
    
    if (unitedStatesReplacement !== 'original') {
      processedText = processedText.replace(/\bUnited States\b/gi, replacements[unitedStatesReplacement] || 'United States');
    }
    
    // Fix compound phrases with prepositions (advanced/experimental)
    if (fixPrepositionPhrases) {
      // Common patterns: "X of Y", "X in Y", "X at Y", etc.
      // Warning: This can be aggressive and might affect readability
      processedText = processedText.replace(/\b(\w+)\s+of\s+(\w+)\b/gi, '$1of$2');
      processedText = processedText.replace(/\b(\w+)\s+in\s+(\w+)\b/gi, '$1in$2');
      processedText = processedText.replace(/\b(\w+)\s+at\s+(\w+)\b/gi, '$1at$2');
      processedText = processedText.replace(/\b(\w+)\s+on\s+(\w+)\b/gi, '$1on$2');
      processedText = processedText.replace(/\b(\w+)\s+with\s+(\w+)\b/gi, '$1with$2');
    }
    
    // Fix other compound proper nouns that might cause pauses
    processedText = processedText.replace(/\bNew York\b/gi, 'newyork');
    processedText = processedText.replace(/\bLos Angeles\b/gi, 'los angeles');
    
    // Fix other medical/technical terms
    processedText = processedText.replace(/velo-\s*cardiofacial/gi, 'velocardiofacial');
    processedText = processedText.replace(/Di\s*George/gi, 'DiGeorge');
    
    // Fix decimal numbers in technical contexts (like "1. 5 to 3" -> "1.5 to 3")
    processedText = processedText.replace(/(\d+)\.\s+(\d+)/g, '$1.$2');
    
    // Fix abbreviations with periods that shouldn't pause
    processedText = processedText.replace(/([A-Z])\.\s*([A-Z])\./g, '$1$2');
    
    // Fix last word pause by adding dummy trailing text
    if (fixLastWordPause) {
      console.log('Adding trailing text to:', processedText);
      // Add more natural trailing text that TTS won't filter out
      processedText = processedText.replace(/([.!?])\s*$/g, '$1 This research continues today.');
      
      // For sentences without ending punctuation, add it
      if (!/[.!?]\s*$/.test(processedText.trim())) {
        processedText = processedText.trim() + '. This research continues today.';
      }
      console.log('Result after adding trailing text:', processedText);
    }
    
    return processedText;
  };

  const generateAudio = async () => {
    if (!text.trim()) {
      setError("Please enter some text");
      return;
    }

    setIsGenerating(true);
    setError(null);
    
    // Clean up previous audio URL
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }

    try {
      // Preprocess text if enabled
      const textToSend = preprocessText ? preprocessTextForTTS(text) : text;
      setProcessedText(textToSend);
      
      const response = await fetch("/api/gtts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: textToSend,
          lang: language,
          slow: slow,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate audio");
      }

      const audioBlob = await response.blob();
      const newAudioUrl = URL.createObjectURL(audioBlob);
      setAudioUrl(newAudioUrl);
    } catch (err) {
      console.error("Error generating audio:", err);
      setError(err instanceof Error ? err.message : "Failed to generate audio");
    } finally {
      setIsGenerating(false);
    }
  };

  const clearAll = () => {
    setText("");
    setProcessedText("");
    setError(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-md p-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">
            Google TTS Test Page
          </h1>
          
          <div className="space-y-6">
            {/* Text Input */}
            <div>
              <label htmlFor="text-input" className="block text-sm font-medium text-gray-700 mb-2">
                Text to Speech
              </label>
              <textarea
                id="text-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full h-64 p-3 border border-gray-300 rounded-md resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter the text you want to convert to speech..."
                maxLength={5000}
              />
              <div className="mt-1 text-sm text-gray-500">
                {text.length}/5000 characters
              </div>
            </div>

            {/* Text Preprocessing Options */}
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4 space-y-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={preprocessText}
                  onChange={(e) => setPreprocessText(e.target.checked)}
                  className="mr-3"
                />
                <div>
                  <span className="text-sm font-medium text-blue-800">
                    Fix TTS pronunciation issues
                  </span>
                  <p className="text-xs text-blue-600 mt-1">
                    Automatically fixes common issues like "22 q 11. 2" → "22 q 11 point 2" and pauses in proper nouns
                  </p>
                </div>
              </label>

              {/* United States Replacement Options */}
              {preprocessText && (
                <div className="pl-6 border-l-2 border-blue-200">
                  <label className="block text-sm font-medium text-blue-800 mb-2">
                    "United States" replacement strategy:
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="us-replacement"
                        value="america"
                        checked={unitedStatesReplacement === "america"}
                        onChange={(e) => setUnitedStatesReplacement(e.target.value)}
                        className="mr-2"
                      />
                      <span>America</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="us-replacement"
                        value="us"
                        checked={unitedStatesReplacement === "us"}
                        onChange={(e) => setUnitedStatesReplacement(e.target.value)}
                        className="mr-2"
                      />
                      <span>U S</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="us-replacement"
                        value="lowercase"
                        checked={unitedStatesReplacement === "lowercase"}
                        onChange={(e) => setUnitedStatesReplacement(e.target.value)}
                        className="mr-2"
                      />
                      <span>united states</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="us-replacement"
                        value="hyphenated"
                        checked={unitedStatesReplacement === "hyphenated"}
                        onChange={(e) => setUnitedStatesReplacement(e.target.value)}
                        className="mr-2"
                      />
                      <span>United-States</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="us-replacement"
                        value="original"
                        checked={unitedStatesReplacement === "original"}
                        onChange={(e) => setUnitedStatesReplacement(e.target.value)}
                        className="mr-2"
                      />
                      <span>United States</span>
                    </label>
                  </div>
                  <p className="text-xs text-blue-600 mt-2">
                    Choose how to replace "United States" to avoid mid-word pauses. "America" usually works best.
                  </p>
                </div>
              )}

              {/* Last Word Pause Fix */}
              {preprocessText && (
                <div className="pl-6 border-l-2 border-green-200 bg-green-50 p-3 rounded">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={fixLastWordPause}
                      onChange={(e) => setFixLastWordPause(e.target.checked)}
                      className="mr-3"
                    />
                    <div>
                      <span className="text-sm font-medium text-green-800">
                        🎯 Fix last word pause
                      </span>
                      <p className="text-xs text-green-700 mt-1">
                        Adds dummy trailing text to prevent TTS from pausing before the final word. The text becomes: "...United States. And that is all."
                      </p>
                      <p className="text-xs text-green-600 mt-1">
                        <strong>How it works:</strong> TTS will now pause before "all" instead of your intended last word.
                      </p>
                    </div>
                  </label>
                </div>
              )}

              {/* Advanced Preposition Phrase Fixing */}
              {preprocessText && (
                <div className="pl-6 border-l-2 border-amber-200 bg-amber-50 p-3 rounded">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={fixPrepositionPhrases}
                      onChange={(e) => setFixPrepositionPhrases(e.target.checked)}
                      className="mr-3"
                    />
                    <div>
                      <span className="text-sm font-medium text-amber-800">
                        🧪 Fix preposition phrases (experimental)
                      </span>
                      <p className="text-xs text-amber-700 mt-1">
                        Removes spaces in phrases like "adventure of life" → "adventureoflife". Can be aggressive and may affect readability.
                      </p>
                      <p className="text-xs text-amber-600 mt-1">
                        <strong>Fixes:</strong> "X of Y", "X in Y", "X at Y", "X on Y", "X with Y"
                      </p>
                    </div>
                  </label>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Language Selector */}
              <div>
                <label htmlFor="language-select" className="block text-sm font-medium text-gray-700 mb-2">
                  Language
                </label>
                <select
                  id="language-select"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {GTTS_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Generation Speed Control */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Generation Speed
                  <span className="text-xs text-gray-500 ml-1">(Google TTS limitation)</span>
                </label>
                <div className="flex items-center space-x-3 pt-2">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="speed"
                      checked={!slow}
                      onChange={() => setSlow(false)}
                      className="mr-2"
                    />
                    Normal
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="speed"
                      checked={slow}
                      onChange={() => setSlow(true)}
                      className="mr-2"
                    />
                    Slow
                  </label>
                </div>
              </div>

              {/* Playback Speed Control */}
              <div>
                <label htmlFor="playback-speed" className="block text-sm font-medium text-gray-700 mb-2">
                  Playback Speed
                  <span className="text-xs text-gray-500 ml-1">(Browser control)</span>
                </label>
                <select
                  id="playback-speed"
                  value={playbackSpeed}
                  onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                  className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value={0.5}>0.5x (Slow)</option>
                  <option value={0.75}>0.75x</option>
                  <option value={1.0}>1.0x (Normal)</option>
                  <option value={1.25}>1.25x</option>
                  <option value={1.5}>1.5x</option>
                  <option value={1.75}>1.75x</option>
                  <option value={2.0}>2.0x (Fast)</option>
                </select>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex space-x-4">
              <button
                onClick={generateAudio}
                disabled={isGenerating || !text.trim()}
                className="flex-1 bg-blue-600 text-white py-3 px-6 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors duration-200"
              >
                {isGenerating ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Generating Audio...
                  </span>
                ) : (
                  "Generate Audio"
                )}
              </button>
              
              <button
                onClick={clearAll}
                className="bg-gray-500 text-white py-3 px-6 rounded-md hover:bg-gray-600 transition-colors duration-200"
              >
                Clear All
              </button>
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-red-800">{error}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Audio Player */}
            {audioUrl && (
              <div className="bg-green-50 border border-green-200 rounded-md p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-medium text-green-800">Audio Generated Successfully</h3>
                </div>
                <audio
                  ref={audioRef}
                  controls
                  src={audioUrl}
                  className="w-full"
                  preload="metadata"
                >
                  Your browser does not support the audio element.
                </audio>
                <div className="mt-3 text-sm text-green-700">
                  Language: <span className="font-medium">{GTTS_LANGUAGES.find(l => l.code === language)?.name}</span>
                  {" | "}Generation Speed: <span className="font-medium">{slow ? "Slow" : "Normal"}</span>
                  {" | "}Playback Speed: <span className="font-medium">{playbackSpeed}x</span>
                  {" | "}Text length: <span className="font-medium">{text.length} characters</span>
                  {preprocessText && processedText !== text && (
                    <>
                      {" | "}
                      <span className="text-blue-700 font-medium">
                        Text was preprocessed
                      </span>
                    </>
                  )}
                </div>
                
                {/* Show processed text if it's different */}
                {preprocessText && processedText && processedText !== text && (
                  <details className="mt-3">
                    <summary className="text-xs text-green-600 cursor-pointer hover:text-green-800">
                      Show processed text sent to TTS
                    </summary>
                    <div className="mt-2 p-3 bg-green-100 rounded text-xs text-green-800 border-l-4 border-green-400">
                      <strong>Original:</strong> {text}
                      <br /><br />
                      <strong>Processed:</strong> {processedText}
                    </div>
                  </details>
                )}
                
                {/* Always show what was sent to TTS for debugging */}
                {preprocessText && processedText && (
                  <div className="mt-3 p-2 bg-gray-100 rounded text-xs text-gray-700">
                    <strong>Debug - Text sent to TTS:</strong> "{processedText}"
                  </div>
                )}
              </div>
            )}

            {/* API Information */}
            <div className="bg-gray-50 border border-gray-200 rounded-md p-4 text-sm text-gray-600">
              <h4 className="font-medium text-gray-800 mb-2">API Information:</h4>
              <p><strong>Endpoint:</strong> POST /api/gtts</p>
              <p><strong>Request Body:</strong> {`{ "input": "text", "lang": "language_code", "slow": boolean }`}</p>
              <p><strong>Response:</strong> Audio file (MP3 format)</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}