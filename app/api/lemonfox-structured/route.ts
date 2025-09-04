import { WordTimestamp } from "@/app/features/audio/types";
import { SpeechObject, SectionContent, ProcessedSection, ProcessedText } from "@/app/features/documents/types";
import { NextRequest, NextResponse } from "next/server";
import { mergeWordTimestamps } from "./helper";

// Types for the structured content

interface AudioSegmentResult {
  sectionIndex: number;
  sectionTitle: string;
  speechIndex: number;
  readerId: string;
  audioBuffer: ArrayBuffer;
  text: string;
  duration?: number;
  word_timestamps?: any;
}

export async function POST(req: NextRequest) {
  const {
    processedText,
    voice = "nicole",
    voiceMap = { default: "nicole" },
    response_format = "mp3",
    word_timestamps = false,
    sectionIndex = null, // null means all sections
    maxSections = 5, // safety limit
    maxCharsPerSection = 10000, // character limit per section
    maxCharsPerSpeech = 2000, // character limit per speech
    includeTitles = false, // whether to include titles in the audio
  }: {
    processedText: ProcessedText;
    voice?: string;
    voiceMap?: Record<string, string>;
    response_format?: string;
    word_timestamps?: boolean;
    sectionIndex?: number | null;
    maxSections?: number;
    maxCharsPerSection?: number;
    maxCharsPerSpeech?: number;
    includeTitles?: boolean;
  } = await req.json();

  // Validate input
  if (!processedText?.processed_text?.sections) {
    return NextResponse.json(
      { error: "Invalid processedText structure" },
      { status: 400 }
    );
  }

  const sections = processedText.processed_text.sections;

  // Determine which sections to process
  let sectionsToProcess: ProcessedSection[];
  let startIndex: number;

  if (sectionIndex !== null) {
    // Process specific section
    if (sectionIndex < 0 || sectionIndex >= sections.length) {
      return NextResponse.json(
        { error: `Section index ${sectionIndex} out of range` },
        { status: 400 }
      );
    }
    sectionsToProcess = [sections[sectionIndex]];
    startIndex = sectionIndex;
  } else {
    // Process all sections (with limit)
    sectionsToProcess = sections.slice(0, maxSections);
    startIndex = 0;
  }

  try {
    const audioSegments: AudioSegmentResult[] = [];

    // Process each section
    for (let sIdx = 0; sIdx < sectionsToProcess.length; sIdx++) {
      const section = sectionsToProcess[sIdx];
      const actualSectionIndex = startIndex + sIdx;

      // Generate individual audio files with correct voices, then merge them
      const individualAudioSegments: ArrayBuffer[] = [];
      const individualWordTimestamps: WordTimestamp[] = [];
      const allTexts: string[] = [];
      const allReaderIds: string[] = [];
      let sectionCharCount = 0;

      // Generate title audio if includeTitles is true
      let titleAudioBuffer: ArrayBuffer | null = null;
      let titleTimestamps: any = null;
      let titleText = "";

      if (includeTitles) {
        titleText = `\n\n${section.title}\n\n`;

        // Use the voice of the first speech for the title
        const firstSpeechVoice =
          section.content.speech.length > 0
            ? voiceMap[section.content.speech[0].reader_id] || voice
            : voice;

        console.log(firstSpeechVoice);

        const titleAudioResponse = await fetch(
          "https://api.lemonfox.ai/v1/audio/speech",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.LEMONFOX_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              input: titleText,
              voice: firstSpeechVoice,
              response_format,
              word_timestamps: true,
            }),
          }
        );

        if (!titleAudioResponse.ok) {
          throw new Error(
            `LemonFox AI API error for title of section ${actualSectionIndex}: ${titleAudioResponse.status}`
          );
        }

        // Handle title response format
        const contentType = titleAudioResponse.headers.get("content-type");
        if (word_timestamps && contentType?.includes("application/json")) {
          const responseData = await titleAudioResponse.json();
          titleAudioBuffer = Uint8Array.from(atob(responseData.audio), (c) =>
            c.charCodeAt(0)
          ).buffer;
          titleTimestamps = responseData.word_timestamps;

          // Mark all title timestamps as title words
          if (titleTimestamps && Array.isArray(titleTimestamps)) {
            titleTimestamps = titleTimestamps.map(
              (timestamp: any, index: number) => ({
                ...timestamp,
                isTitle: true,
                titleWordIndex: index,
              })
            );
          }
        } else {
          titleAudioBuffer = await titleAudioResponse.arrayBuffer();
        }

        // Add title to the audio segments and texts
        individualAudioSegments.push(titleAudioBuffer);
        individualWordTimestamps.push(titleTimestamps);
        allTexts.push(titleText);
        allReaderIds.push(section.content.speech[0]?.reader_id || "default");
        sectionCharCount += titleText.length;
      }

      // Generate audio for each speech separately
      for (let spIdx = 0; spIdx < section.content.speech.length; spIdx++) {
        const speech = section.content.speech[spIdx];
        const speechText = speech.text;

        // Apply character limits
        const truncatedText = speechText.slice(0, maxCharsPerSpeech);

        // Check section character limit
        if (sectionCharCount + truncatedText.length > maxCharsPerSection) {
          console.warn(
            `Section ${actualSectionIndex} exceeded character limit, truncating`
          );
          break;
        }

        // Skip empty speech
        if (!truncatedText.trim()) {
          continue;
        }

        sectionCharCount += truncatedText.length;

        console.log("voice selected for speech: ");
        console.log(voiceMap[speech.reader_id]);

        // Generate audio for this speech with correct voice
        const audioResponse = await fetch(
          "https://api.lemonfox.ai/v1/audio/speech",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.LEMONFOX_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              input: truncatedText,
              voice: voiceMap[speech.reader_id],
              response_format,
              word_timestamps: true, // Always get timestamps for individual segments
            }),
          }
        );

        if (!audioResponse.ok) {
          throw new Error(
            `LemonFox AI API error for section ${actualSectionIndex}, speech ${spIdx}: ${audioResponse.status}`
          );
        }

        let audioBuffer: ArrayBuffer;
        let timestamps: any = null;

        // Handle response format
        const contentType = audioResponse.headers.get("content-type");
        if (word_timestamps && contentType?.includes("application/json")) {
          const responseData = await audioResponse.json();
          audioBuffer = Uint8Array.from(atob(responseData.audio), (c) =>
            c.charCodeAt(0)
          ).buffer;
          timestamps = responseData.word_timestamps;

          // Mark speech timestamps as non-title words
          if (timestamps && Array.isArray(timestamps)) {
            timestamps = timestamps.map((timestamp: any) => ({
              ...timestamp,
              isTitle: false,
            }));
          }
        } else {
          audioBuffer = await audioResponse.arrayBuffer();
        }

        individualAudioSegments.push(audioBuffer);
        individualWordTimestamps.push(timestamps);
        allTexts.push(truncatedText);
        allReaderIds.push(speech.reader_id);
      }

      // Merge all audio segments into one
      if (individualAudioSegments.length > 0) {
        const mergedAudioBuffer = await mergeAudioBuffers(
          individualAudioSegments
        );
        const combinedText = allTexts.join(" ");
        const combinedReaderIds = [...new Set(allReaderIds)].join(", "); // Unique reader IDs

        const mergedWordTimestamps = word_timestamps
          ? await mergeWordTimestamps(individualWordTimestamps, allReaderIds)
          : null;

        audioSegments.push({
          sectionIndex: actualSectionIndex,
          sectionTitle: section.title,
          speechIndex: 0, // Single merged segment
          readerId: combinedReaderIds,
          audioBuffer: mergedAudioBuffer,
          text: combinedText,
          word_timestamps: mergedWordTimestamps,
        });
      }
    }

    // Always return structured JSON response
    const responseData = {
      segments: audioSegments.map((segment, index) => ({
        id: `${segment.sectionIndex}-${segment.speechIndex}`,
        sectionIndex: segment.sectionIndex,
        sectionTitle: segment.sectionTitle,
        speechIndex: segment.speechIndex,
        readerId: segment.readerId,
        text: segment.text,
        audioBase64: Buffer.from(segment.audioBuffer).toString("base64"),
        textLength: segment.text.length,
        includeTitles,
        word_timestamps: segment.word_timestamps || null,
      })),
      totalSegments: audioSegments.length,
      processedSections: sectionsToProcess.length,
      format: response_format,
      includeTitles,
      limits: {
        maxCharsPerSection,
        maxCharsPerSpeech,
        maxSections,
      },
    };

    return NextResponse.json(responseData, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=31536000",
      },
    });
  } catch (error) {
    console.error("Error generating structured audio:", error);

    // Provide more specific error information
    if (
      error instanceof Error &&
      error.message.includes("LemonFox AI API error")
    ) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    return NextResponse.json(
      { error: "Failed to generate audio segments" },
      { status: 500 }
    );
  }
}

// Helper function to merge multiple audio buffers
async function mergeAudioBuffers(
  audioBuffers: ArrayBuffer[]
): Promise<ArrayBuffer> {
  if (audioBuffers.length === 0) {
    throw new Error("No audio buffers to merge");
  }

  if (audioBuffers.length === 1) {
    return audioBuffers[0];
  }

  // For MP3 files, we can simply concatenate the buffers
  // This is a basic implementation - for more sophisticated merging,
  // you might want to use a proper audio processing library
  const totalLength = audioBuffers.reduce(
    (sum, buffer) => sum + buffer.byteLength,
    0
  );
  const mergedBuffer = new ArrayBuffer(totalLength);
  const mergedView = new Uint8Array(mergedBuffer);

  let offset = 0;
  for (const buffer of audioBuffers) {
    const view = new Uint8Array(buffer);
    mergedView.set(view, offset);
    offset += buffer.byteLength;
  }

  return mergedBuffer;
}
