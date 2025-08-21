import { NextRequest, NextResponse } from "next/server";

// Types for the structured content
interface SpeechObject {
  text: string;
  reader_id: string;
}

interface SectionContent {
  speech: SpeechObject[];
}

interface ProcessedSection {
  title: string;
  content: SectionContent;
}

interface ProcessedText {
  processed_text: {
    sections: ProcessedSection[];
  };
}

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
    response_format = "mp3",
    word_timestamps = false,
    sectionIndex = null, // null means all sections
    maxSections = 5, // safety limit
    maxCharsPerSection = 10000, // character limit per section
    maxCharsPerSpeech = 2000, // character limit per speech
    mergeSectionSpeeches = true, // whether to merge speeches within a section
  }: {
    processedText: ProcessedText;
    voice?: string;
    response_format?: string;
    word_timestamps?: boolean;
    sectionIndex?: number | null;
    maxSections?: number;
    maxCharsPerSection?: number;
    maxCharsPerSpeech?: number;
    mergeSectionSpeeches?: boolean;
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

      // Apply character limits and merging
      if (mergeSectionSpeeches) {
        // Merge all speeches in the section into one
        const mergedText = section.content.speech
          .map((speech) => speech.text.slice(0, maxCharsPerSpeech))
          .join(" ")
          .slice(0, maxCharsPerSection);

        if (!mergedText.trim()) {
          continue; // Skip empty sections
        }

        // Generate single audio for merged section
        const audioResponse = await fetch(
          "https://api.lemonfox.ai/v1/audio/speech",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.LEMONFOX_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              input: mergedText,
              voice: voice, // Use default voice for merged content
              response_format,
              word_timestamps,
            }),
          }
        );

        if (!audioResponse.ok) {
          throw new Error(
            `LemonFox AI API error for merged section ${actualSectionIndex}: ${audioResponse.status}`
          );
        }

        let audioBuffer: ArrayBuffer;
        let timestamps: any = null;

        // Check if response includes word timestamps
        const contentType = audioResponse.headers.get("content-type");
        if (word_timestamps && contentType?.includes("application/json")) {
          // Response includes JSON with audio and timestamps
          const responseData = await audioResponse.json();
          audioBuffer = Uint8Array.from(atob(responseData.audio), (c) =>
            c.charCodeAt(0)
          ).buffer;
          timestamps = responseData.word_timestamps;
        } else {
          // Direct audio response
          audioBuffer = await audioResponse.arrayBuffer();
        }

        audioSegments.push({
          sectionIndex: actualSectionIndex,
          sectionTitle: section.title,
          speechIndex: 0, // Merged speech
          readerId: "merged",
          audioBuffer,
          text: mergedText,
          word_timestamps: timestamps,
        });
      } else {
        // Process each speech separately
        let sectionCharCount = 0;

        for (let spIdx = 0; spIdx < section.content.speech.length; spIdx++) {
          const speech = section.content.speech[spIdx];

          // Apply character limits
          const truncatedText = speech.text.slice(0, maxCharsPerSpeech);

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

          // Generate audio for this speech
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
                voice: getVoiceForReader(speech.reader_id, voice),
                response_format,
                word_timestamps,
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

          // Check if response includes word timestamps
          const contentType = audioResponse.headers.get("content-type");
          if (word_timestamps && contentType?.includes("application/json")) {
            // Response includes JSON with audio and timestamps
            const responseData = await audioResponse.json();
            audioBuffer = Uint8Array.from(atob(responseData.audio), (c) =>
              c.charCodeAt(0)
            ).buffer;
            timestamps = responseData.word_timestamps;
          } else {
            // Direct audio response
            audioBuffer = await audioResponse.arrayBuffer();
          }

          audioSegments.push({
            sectionIndex: actualSectionIndex,
            sectionTitle: section.title,
            speechIndex: spIdx,
            readerId: speech.reader_id,
            audioBuffer,
            text: truncatedText,
            word_timestamps: timestamps,
          });
        }
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
        isMerged: segment.readerId === "merged",
        word_timestamps: segment.word_timestamps || null,
      })),
      totalSegments: audioSegments.length,
      processedSections: sectionsToProcess.length,
      format: response_format,
      mergeSectionSpeeches,
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

// Helper function to map reader IDs to voices
function getVoiceForReader(readerId: string, defaultVoice: string): string {
  const voiceMap: Record<string, string> = {
    default: defaultVoice,
    narrator: "nicole",
    speaker1: "onyx",
    speaker2: "alloy",
    speaker3: "echo",
    // Add more mappings as needed
  };

  return voiceMap[readerId] || defaultVoice;
}
