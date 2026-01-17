import { createAudioVersionAction } from "../audio/actions";
import { Language } from "../audio/voice-types";
import { createDocumentVersionAction } from "../documents/actions";
import { createAudioSegmentAction } from "../audio/actions"; // Add this import
import { isStructuredContent } from "./audio-generation";
import { convertProcessedTextToBlocks } from "../block-editor";
import { identifySections } from "../pdf/helpers/identify-sections";
import { processText } from "../pdf/helpers/process-text";
import { getAudioDurationAccurate } from "../audio/utils";
import { DocumentVersion } from "../documents/types";
import { PROCESSING_ARRAY } from "../pdf/types";
import { assignVoicesToReaders } from "../documents/utils";

type GenerateWithAiInput = {
  documentId: string;
  existingDocumentVersions: DocumentVersion[];
  rawInputText: string;
  processingLevel: 0 | 1 | 2 | 3;
  voicesArray: string[];
  targetLanguage?: Language;
  documentTitle?: string;
};

type SectionTTSInput = any; // Replace with your actual type

export async function generateWithAi({
  documentId,
  existingDocumentVersions,
  rawInputText,
  processingLevel,
  voicesArray,
  targetLanguage = "en",
  documentTitle = "Document",
}: GenerateWithAiInput) {
  let processedResult;

  // Process text based on processing level
  if (processingLevel === 0 || processingLevel === 1) {
    // Section-based processing
    try {
      console.log("Starting section identification...");
      const sectionIdentificationResult = await identifySections(rawInputText);

      console.log(
        "Section identification result:",
        sectionIdentificationResult
      );
      console.log("SECTION IDENTIFICATION SUCCESS");

      const structuredDocumentInput: { title: string; content: string }[] =
        sectionIdentificationResult.structuredDocument;

      const processedSections: SectionTTSInput[] = [];

      // Process all sections in parallel
      console.log("Processing sections in parallel...");
      const sectionPromises = structuredDocumentInput.map(
        async ({ title, content }) => {
          console.log("CALLING PROCESS TEXT for: ", title);
          const { cleanedText } = await processText(
            content,
            title,
            processingLevel
          );

          console.log("Processed text for", title, ":", cleanedText);
          return cleanedText;
        }
      );

      // Wait for all sections to complete
      const results = await Promise.all(sectionPromises);
      processedSections.push(...results);

      console.log("All sections processed:", processedSections);

      processedResult = {
        cleanedText: { processed_text: { sections: processedSections } },
        metadata: { processingLevel, totalSections: processedSections.length },
      };
    } catch (error) {
      console.error("Error in section-based processing:", error);
      throw new Error(
        `Failed to process sections: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  } else {
    // Conversation processing (levels 2 & 3)
    try {
      console.log("Starting conversation processing...");
      processedResult = await processText(
        rawInputText,
        documentTitle,
        processingLevel
      );

      console.log("Conversation processing completed:", processedResult);
    } catch (error) {
      console.error("Error in conversation processing:", error);
      throw new Error(
        `Failed to process conversation: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
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
