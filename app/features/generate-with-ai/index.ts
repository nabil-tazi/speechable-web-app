import { createAudioVersionAction } from "../audio/actions";
import { Language } from "../audio/voice-types";
import { createDocumentVersionAction } from "../documents/actions";
import { createAudioSegmentAction } from "../audio/actions";
import { isStructuredContent } from "./audio-generation";
import { convertProcessedTextToBlocks } from "../block-editor";
import { identifySections } from "../pdf/helpers/identify-sections";
import { getAudioDurationAccurate } from "../audio/utils";
import { DocumentVersion, ProcessedSection, ProcessedText } from "../documents/types";
import { PROCESSING_ARRAY } from "../pdf/types";
import { assignVoicesToReaders } from "../documents/utils";

// DeepInfra endpoint helpers
async function processWithDeepInfraNatural(
  text: string,
  title?: string
): Promise<string> {
  const response = await fetch("/api/deepinfra-text/natural", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, title }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Natural processing failed");
  }

  const data = await response.json();
  return data.result;
}

async function processWithDeepInfraLecture(
  text: string,
  title?: string
): Promise<string> {
  const response = await fetch("/api/deepinfra-text/lecture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, title }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Lecture processing failed");
  }

  const data = await response.json();
  return data.result;
}

async function processWithDeepInfraConversational(
  text: string,
  title?: string
): Promise<{ text: string; reader_id: string }[]> {
  const response = await fetch("/api/deepinfra-text/conversational", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, title }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Conversational processing failed");
  }

  const data = await response.json();
  return data.dialogue;
}

// Helper to create ProcessedSection from text
function createSectionFromText(text: string, title: string): ProcessedSection {
  return {
    title,
    content: {
      speech: [{ text, reader_id: "Narrator" }],
    },
  };
}

// Helper to create ProcessedSection from dialogue
function createSectionFromDialogue(
  dialogue: { text: string; reader_id: string }[],
  title: string
): ProcessedSection {
  return {
    title,
    content: {
      speech: dialogue,
    },
  };
}

type GenerateWithAiInput = {
  documentId: string;
  existingDocumentVersions: DocumentVersion[];
  rawInputText: string;
  processingLevel: 0 | 1 | 2 | 3;
  voicesArray: string[];
  targetLanguage?: Language;
  documentTitle?: string;
  skipAudio?: boolean;
  documentProcessedText?: ProcessedText; // For Original level, reuse existing processed_text
};

export async function generateWithAi({
  documentId,
  existingDocumentVersions,
  rawInputText,
  processingLevel,
  voicesArray,
  targetLanguage = "en",
  documentTitle = "Document",
  skipAudio = false,
  documentProcessedText,
}: GenerateWithAiInput) {
  let processedResult;

  // Process text based on processing level
  if (processingLevel === 0) {
    // Level 0: Original - Requires document's existing processed_text
    if (!documentProcessedText) {
      throw new Error(
        "Cannot create Original version: document has no processed_text. Please try uploading the original document again."
      );
    }
    console.log("Using existing document processed_text for Original version");
    processedResult = {
      cleanedText: documentProcessedText,
      metadata: {
        processingLevel,
        source: "document_processed_text",
        totalSections: documentProcessedText.processed_text?.sections?.length || 0,
      },
    };
  } else if (processingLevel === 1) {
    // Level 1: Natural - Section-based processing with DeepInfra
    try {
      console.log("Starting section identification for Natural processing...");
      const sectionIdentificationResult = await identifySections(rawInputText);

      const structuredDocumentInput: { title: string; content: string }[] =
        sectionIdentificationResult.structuredDocument;

      const processedSections: ProcessedSection[] = [];

      // Process all sections in parallel with DeepInfra Natural endpoint
      console.log("Processing sections with DeepInfra Natural...");
      const sectionPromises = structuredDocumentInput.map(
        async ({ title, content }) => {
          console.log("Processing section (Natural):", title);
          const result = await processWithDeepInfraNatural(content, title);
          return createSectionFromText(result, title);
        }
      );

      const results = await Promise.all(sectionPromises);
      processedSections.push(...results);

      processedResult = {
        cleanedText: { processed_text: { sections: processedSections } },
        metadata: { processingLevel, totalSections: processedSections.length },
      };
    } catch (error) {
      console.error("Error in Natural processing:", error);
      throw new Error(
        `Failed to process Natural: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  } else if (processingLevel === 2) {
    // Level 2: Lecture - Process entire document with DeepInfra
    try {
      console.log("Starting Lecture processing with DeepInfra...");
      const result = await processWithDeepInfraLecture(rawInputText, documentTitle);
      const section = createSectionFromText(result, ""); // Empty title - no heading

      processedResult = {
        cleanedText: { processed_text: { sections: [section] } },
        metadata: { processingLevel, processingMethod: "deepinfra-lecture" },
      };
      console.log("Lecture processing completed");
    } catch (error) {
      console.error("Error in Lecture processing:", error);
      throw new Error(
        `Failed to process Lecture: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  } else if (processingLevel === 3) {
    // Level 3: Conversational - Process entire document with DeepInfra
    try {
      console.log("Starting Conversational processing with DeepInfra...");
      const dialogue = await processWithDeepInfraConversational(
        rawInputText,
        documentTitle
      );
      const section = createSectionFromDialogue(dialogue, ""); // Empty title - no heading

      processedResult = {
        cleanedText: { processed_text: { sections: [section] } },
        metadata: {
          processingLevel,
          processingMethod: "deepinfra-conversational",
          dialogueCount: dialogue.length,
        },
      };
      console.log("Conversational processing completed, dialogue count:", dialogue.length);
    } catch (error) {
      console.error("Error in Conversational processing:", error);
      throw new Error(
        `Failed to process Conversational: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  } else {
    throw new Error(`Invalid processing level: ${processingLevel}`);
  }

  console.log("Text processing completed, creating document version...");

  const numberOfExistingVersion = existingDocumentVersions.filter(
    (v) => v.processing_type === processingLevel.toString()
  ).length;

  const newVersionName =
    PROCESSING_ARRAY[processingLevel].name +
    (numberOfExistingVersion ? " " + (numberOfExistingVersion + 1) : "");

  // Create document version
  const processedTextJson = JSON.stringify(processedResult.cleanedText);
  const blocks = convertProcessedTextToBlocks(processedTextJson);

  const { data: documentVersion, error: versionError } =
    await createDocumentVersionAction({
      document_id: documentId,
      version_name: newVersionName,
      processed_text: processedTextJson,
      blocks,
      processing_type: processingLevel.toString(),
      processing_metadata: processedResult.metadata,
    });

  if (versionError || !documentVersion) {
    throw new Error(versionError || "Failed to create document version");
  }

  console.log("Document version created:", documentVersion.id);

  // Skip audio generation if requested
  if (skipAudio) {
    console.log("Skipping audio generation (skipAudio=true)");
    return {
      documentVersion,
      audioVersion: null,
    };
  }

  // Create audio version
  console.log("Creating audio version...");
  const { data: audioVersion, error: audioVersionError } =
    await createAudioVersionAction({
      document_version_id: documentVersion.id,
      tts_model: "lemonfox",
      speed: 1.0,
    });

  if (audioVersionError || !audioVersion) {
    throw new Error(audioVersionError || "Failed to create audio version");
  }

  console.log("Audio version created:", audioVersion.id);

  // Validate structured content
  if (!isStructuredContent(processedResult.cleanedText)) {
    throw new Error("No structured content available for audio generation");
  }

  console.log("Starting audio generation for all sections...");

  // Generate audio for all sections
  await generateAllAudioSections(
    processedResult.cleanedText,
    documentVersion.id,
    audioVersion.id,
    voicesArray
  );

  console.log("Audio generation completed successfully");

  return {
    documentVersion,
    audioVersion,
  };
}

// Helper function to generate audio for all sections
async function generateAllAudioSections(
  processedDocument: any,
  documentVersionId: string,
  audioVersionId: string,
  voicesArray: string[]
) {
  if (!isStructuredContent(processedDocument)) {
    throw new Error("No structured content available for audio generation");
  }

  // Create voice map
  const readerVoiceMap = assignVoicesToReaders(processedDocument, voicesArray);
  console.log("Voice assignment map:", readerVoiceMap);

  const totalSections = processedDocument.processed_text.sections.length;
  console.log(`Generating audio for ${totalSections} sections...`);

  // Generate audio for each section sequentially to avoid overwhelming the API
  for (let i = 0; i < totalSections; i++) {
    console.log(`Generating audio for section ${i + 1}/${totalSections}`);
    await generateAudioForSection(
      voicesArray,
      i,
      readerVoiceMap,
      processedDocument,
      audioVersionId,
      documentVersionId
    );
  }

  console.log("All audio sections generated successfully");
}

// Voice assignment function - you can customize this logic
// function assignVoicesToReaders(
//   processedDocument: any,
//   voicesArray: string[]
// ): Record<string, string> {
//   const readerVoiceMap: Record<string, string> = {};

//   if (voicesArray.length >= 2) {
//     // For conversational content, assign two voices
//     readerVoiceMap["speaker1"] = voicesArray[0];
//     readerVoiceMap["speaker2"] = voicesArray[1];
//     readerVoiceMap["narrator"] = voicesArray[0]; // Default narrator
//   } else if (voicesArray.length === 1) {
//     // Single voice for all content
//     readerVoiceMap["default"] = voicesArray[0];
//     readerVoiceMap["narrator"] = voicesArray[0];
//     readerVoiceMap["speaker1"] = voicesArray[0];
//     readerVoiceMap["speaker2"] = voicesArray[0];
//   } else {
//     // Fallback to default voice
//     readerVoiceMap["default"] = "onyx";
//     readerVoiceMap["narrator"] = "onyx";
//   }

//   return readerVoiceMap;
// }

// Adapted from your existing function, without React state management
async function generateAudioForSection(
  voicesArray: string[],
  sectionIndex: number,
  readerVoiceMap: Record<string, string>,
  processedDocument: any,
  audioVersionId: string,
  documentVersionId: string
) {
  try {
    console.log(`Starting audio generation for section ${sectionIndex}`);
    console.log(readerVoiceMap);

    const response = await fetch("/api/lemonfox-structured", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        processedText: processedDocument,
        sectionIndex: sectionIndex,
        voice: readerVoiceMap["Narrator"] || "onyx",
        voiceMap: readerVoiceMap,
        response_format: "mp3",
        word_timestamps: true,
        maxCharsPerSection: 4000,
        maxCharsPerSpeech: 2000,
        includeTitles: true,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to generate audio");
    }

    const responseData = await response.json();
    console.log(`Section ${sectionIndex} audio response:`, responseData);

    if (responseData.segments?.[0]) {
      const firstSegment = responseData.segments[0];

      // Convert base64 audio to blob
      const audioBuffer = Uint8Array.from(atob(firstSegment.audioBase64), (c) =>
        c.charCodeAt(0)
      );
      const audioBlob = new Blob([audioBuffer], { type: "audio/mpeg" });

      // Get audio duration
      const audioDuration = await getAudioDurationAccurate(audioBlob);

      // Create audio file
      const audioFile = new File(
        [audioBlob],
        `audio-section-${sectionIndex + 1}.mp3`,
        { type: "audio/mpeg" }
      );

      console.log("creating segment, with:");
      console.log(voicesArray);

      // Save audio segment to database
      const { data: audioSegment, error: segmentError } =
        await createAudioSegmentAction(
          {
            audio_version_id: audioVersionId,
            segment_number: sectionIndex + 1,
            section_title: firstSegment.sectionTitle,
            text_start_index: 0,
            text_end_index: firstSegment.textLength,
            audio_duration: Math.round(audioDuration * 100) / 100,
            word_timestamps: firstSegment.word_timestamps || [],
            voice_name: readerVoiceMap["Narrator"] || "onyx",
            voices: voicesArray,
          },
          audioFile
        );

      if (segmentError || !audioSegment) {
        throw new Error(segmentError || "Failed to create audio segment");
      }

      console.log(
        `Audio segment created successfully for section ${sectionIndex + 1}:`,
        {
          sectionTitle: firstSegment.sectionTitle,
          audioDuration,
          audioVersionId,
          segmentNumber: sectionIndex + 1,
          segmentId: audioSegment.id,
        }
      );

      return audioSegment;
    }

    return responseData;
  } catch (error) {
    console.error(`Error generating audio for section ${sectionIndex}:`, error);
    throw new Error(
      `Failed to generate audio for section ${sectionIndex}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
