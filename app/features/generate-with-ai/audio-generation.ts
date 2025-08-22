import {
  createAudioSegmentAction,
  createAudioVersionAction,
} from "../audio/actions";
import type { AudioVersion } from "../audio/types";
import { getAudioDurationAccurate } from "../audio/utils";
import type { ProcessedText } from "../documents/types";
import { assignVoicesToReaders } from "../documents/utils";

type GenerateAllAudioInput = {
  audioVersion: AudioVersion;
  documentVersionId: string;
  processedText: ProcessedText;
  voicesArray: string[];
};

export async function generateAllAudio({
  audioVersion,
  processedText,
  documentVersionId,
  voicesArray,
}: GenerateAllAudioInput) {
  if (!processedText || !isStructuredContent(processedText)) {
    // setError("No structured content available for audio generation");
    return;
  }

  if (!documentVersionId) {
    // setError("No document version selected audio generation");
    return;
  }

  const readerVoiceMap = assignVoicesToReaders(processedText, voicesArray);

  // Create ONE audio version for all sections
  //   const { data: audioVersion, error: versionError } =
  //     await createAudioVersionAction({
  //       document_version_id: documentVersionId,
  //       tts_model: "lemonfox",
  //       speed: 1.0,
  //     });

  //   if (versionError || !audioVersion) {
  //     // setError(versionError || "Failed to create audio version");
  //     return;
  //   }

  //   setCurrentAudioVersionId(audioVersion.id);
  const totalSections = processedText.processed_text.sections.length;

  // Generate audio for each section using the same audio version
  for (let i = 0; i < totalSections; i++) {
    // await generateAudioForSection(i, readerVoiceMap, audioVersion.id);
    await generateAudioForSection({
      audioVersionId: audioVersion.id,
      processedText,
      sectionIndex: i,
      readerVoiceMap,
    });
  }
}

export function isStructuredContent(content: any): content is ProcessedText {
  return (
    content && typeof content === "object" && content.processed_text?.sections
  );
}

async function generateAudioForSection({
  audioVersionId,
  processedText,
  sectionIndex,
  readerVoiceMap,
}: {
  audioVersionId: string;
  processedText: ProcessedText;
  sectionIndex: number;
  readerVoiceMap: Record<string, string>;
}) {
  if (!processedText || !isStructuredContent(processedText)) {
    console.log("UNSTRUCTURED TEXT");
    // setError("Missing requirements for audio generation");
    return;
  }

  //   setGeneratingAudioSections((prev) => new Set(prev).add(sectionIndex));
  //   setError(null);

  try {
    console.log("IN GENERATE AUDIO FOR SECTION");

    const response = await fetch("/api/lemonfox-structured", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        processedText: processedText,
        sectionIndex: sectionIndex,
        voice: "onyx",
        voiceMap: readerVoiceMap,
        response_format: "mp3",
        word_timestamps: true,
        maxCharsPerSection: 3000,
        maxCharsPerSpeech: 100,
        mergeSectionSpeeches: false,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to generate audio");
    }

    console.log("CORRECT ANSWER FOMR LEMONFOX API");

    const responseData = await response.json();

    console.log(responseData);
    if (responseData.segments?.[0]) {
      const firstSegment = responseData.segments[0];
      const audioBuffer = Uint8Array.from(atob(firstSegment.audioBase64), (c) =>
        c.charCodeAt(0)
      );
      const audioBlob = new Blob([audioBuffer], { type: "audio/mpeg" });

      const audioDuration = await getAudioDurationAccurate(audioBlob);

      //   if (!audioVersionId) {
      //     const { data: newAudioVersion, error: versionError } =
      //       await createAudioVersionAction({
      //         document_version_id: documentVersionId,
      //         tts_model: "lemonfox",
      //         // voice_name: "onyx",
      //         speed: 1.0,
      //       });

      //     if (versionError || !newAudioVersion) {
      //       throw new Error(versionError || "Failed to create audio version");
      //     }

      //     audioVersionId = newAudioVersion.id;
      //     // setCurrentAudioVersionId(newAudioVersion.id);
      //   }

      const audioFile = new File(
        [audioBlob],
        `audio-section-${sectionIndex + 1}.mp3`,
        { type: "audio/mpeg" }
      );

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
            voice_name: "onyx",
          },
          audioFile
        );

      if (segmentError || !audioSegment) {
        throw new Error(segmentError || "Failed to create audio segment");
      }

      const audioUrl = URL.createObjectURL(audioBlob);

      //   if (sectionAudioUrls[sectionIndex]) {
      //     URL.revokeObjectURL(sectionAudioUrls[sectionIndex]);
      //   }

      //   setSectionAudioUrls((prev) => ({
      //     ...prev,
      //     [sectionIndex]: audioUrl,
      //   }));

      console.log(`Audio generated for section ${sectionIndex}:`, {
        sectionTitle: firstSegment.sectionTitle,
        audioDuration,
        audioVersionId,
        segmentNumber: sectionIndex + 1,
      });
    }
  } catch (err) {
    console.error(`Error generating audio for section ${sectionIndex}:`, err);
    // setError(err instanceof Error ? err.message : "Failed to generate audio");
  } finally {
    // setGeneratingAudioSections((prev) => {
    //   const newSet = new Set(prev);
    //   newSet.delete(sectionIndex);
    //   return newSet;
    // });
  }
}
