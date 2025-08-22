import { createAudioVersionAction } from "../audio/actions";
import { Language } from "../audio/voice-types";
import { createDocumentVersionAction } from "../documents/actions";
import { generateAllAudio, isStructuredContent } from "./audio-generation";
import { cleanTextWithOpenAI } from "./text-processing";

type GenerateWithAiInput = {
  documentId: string;
  rawInputText: string;
  processingLevel: 0 | 1 | 2 | 3;
  voicesArray: string[];
  targetLanguage?: Language;
};

export async function generateWithAi({
  documentId,
  rawInputText,
  processingLevel,
  voicesArray,
  targetLanguage = "en",
}: GenerateWithAiInput) {
  const { cleanedText: processedText, metadata } = await cleanTextWithOpenAI({
    rawInputText,
    processingLevel,
  });

  const { data: documentVersion, error: versionError } =
    await createDocumentVersionAction({
      document_id: documentId,
      version_name: `Processed - Level ${processingLevel}`,
      processed_text: JSON.stringify(processedText), // Store as JSON string in DB
      processing_type: processingLevel.toString(),
      processing_metadata: metadata,
    });

  if (documentVersion) {
    console.log("about to create the audio version");
    const { data: audioVersion, error: versionError2 } =
      await createAudioVersionAction({
        document_version_id: documentVersion.id,
        tts_model: "lemonfox",
        speed: 1.0,
      });
    if (audioVersion) {
      console.log("created the audio version");

      if (!isStructuredContent(processedText)) {
        // setError("No structured content available for audio generation");
        return;
      }

      console.log("about to generate all audio");

      await generateAllAudio({
        audioVersion,
        processedText,
        documentVersionId: documentVersion.id,
        voicesArray,
      });
    }
  }

  return;
}
