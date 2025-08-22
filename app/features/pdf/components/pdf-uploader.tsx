"use client";

import { useState } from "react";

import { ParsedPDF, PreprocessingLevel, ProcessingMetadata } from "../types";
import ProcessingLevelSelector from "../../speech/components/processing-level-selector";
import PDFUploadArea from "./upload-area";
import PDFResultsDisplay from "./pdf-results-display";
import PDFDocumentOverview from "./pdf-overview";
import { processPDFFile } from "../utils/pdf-processing";

import {
  createDocumentAction,
  createDocumentVersionAction,
  updateDocumentAction,
  uploadDocumentThumbnailAction,
} from "../../documents/actions";
import {
  createAudioSegmentAction,
  createAudioVersionAction,
  deleteAudioVersionAction,
} from "../../audio/actions";
import { getAudioDuration, getAudioDurationAccurate } from "../../audio/utils";
import { ProcessedText } from "../../documents/types";
import { Button } from "@/components/ui/button";
import { assignVoicesToReaders } from "../../documents/utils";

// Add new types for document classification
type DocumentClassification = {
  documentType: string;
  language: string;
};

// Add type for file info
type FileInfo = {
  name: string;
  size: number;
  thumbnailUrl: string | null;
};

type Props = {
  userId: string;
};

export default function PDFUploader({ userId }: Props) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [isCleaningText, setIsCleaningText] = useState(false);
  const [customText, setCustomText] = useState("");
  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(
    null
  );
  const [currentDocumentVersionId, setCurrentDocumentVersionId] = useState<
    string | null
  >(null);
  const [currentAudioVersionId, setCurrentAudioVersionId] = useState<
    string | null
  >(null);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [parsedPDF, setParsedPDF] = useState<ParsedPDF | null>(null);
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [classification, setClassification] =
    useState<DocumentClassification | null>(null);
  const [cleanedText, setCleanedText] = useState<ProcessedText | null>(null);
  const [preprocessingLevel, setPreprocessingLevel] =
    useState<PreprocessingLevel>(0);
  const [processingMetadata, setProcessingMetadata] =
    useState<ProcessingMetadata | null>(null);
  // const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const [sectionAudioUrls, setSectionAudioUrls] = useState<
    Record<number, string>
  >({});
  const [generatingAudioSections, setGeneratingAudioSections] = useState<
    Set<number>
  >(new Set());
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const pdfFile = files.find((file) => file.type === "application/pdf");

    if (pdfFile) {
      processPDF(pdfFile);
    } else {
      setError("Please upload a PDF file");
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type === "application/pdf") {
        processPDF(file);
      } else {
        setError("Please select a PDF file");
      }
    }
  };

  // Function to generate PDF thumbnail
  const generatePDFThumbnail = async (file: File): Promise<string | null> => {
    try {
      const pdfjsLib = await import("pdfjs-dist");

      // Configure worker
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1); // Get first page

      const scale = 0.5; // Reduce scale for thumbnail
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) return null;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
        canvas: canvas,
      };

      await page.render(renderContext).promise;

      return canvas.toDataURL("image/png");
    } catch (error) {
      console.error("Error generating PDF thumbnail:", error);
      return null;
    }
  };

  async function classifyDocument(
    text: string
  ): Promise<{ documentType: string; language: string } | null> {
    setIsClassifying(true);
    setError(null);

    try {
      const response = await fetch("/api/classify-document", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Classification failed: ${response.status}`
        );
      }

      const data = await response.json();
      const classification = {
        documentType: data.documentType,
        language: data.language,
      };

      setClassification(classification);
      setError(null);

      return classification; // Return the classification object
    } catch (err) {
      console.error("Error classifying document:", err);
      setError(
        err instanceof Error ? err.message : "Failed to classify document"
      );
      return null; // Return null on error
    } finally {
      setIsClassifying(false);
    }
  }

  async function cleanTextWithOpenAI(text: string, retryCount = 0) {
    const maxRetries = 2;
    setIsCleaningText(true);
    setError(null);

    try {
      const response = await fetch("/api/openai-advanced", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: text,
          level: preprocessingLevel,
          documentType: classification?.documentType,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        // Handle specific error codes (same as original)
        if (
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504
        ) {
          if (retryCount < maxRetries) {
            setError(
              `Server temporarily unavailable, retrying... (${retryCount + 1}/${
                maxRetries + 1
              })`
            );
            await new Promise((resolve) =>
              setTimeout(resolve, (retryCount + 1) * 1000)
            );
            return cleanTextWithOpenAI(text, retryCount + 1);
          } else {
            throw new Error(
              "OpenAI service is temporarily unavailable. Please try again in a few minutes."
            );
          }
        } else if (response.status === 429) {
          throw new Error(
            "Rate limit exceeded. Please wait a moment and try again."
          );
        } else if (response.status === 401) {
          throw new Error(
            "Authentication failed. Please check your API configuration."
          );
        } else if (response.status >= 400 && response.status < 500) {
          throw new Error(
            errorData.error ||
              `Request failed (${response.status}). Please check your input and try again.`
          );
        } else {
          throw new Error(
            errorData.error || `OpenAI API error: ${response.status}`
          );
        }
      }

      const data = await response.json();
      setError(null);

      console.log(data.message);

      return {
        cleanedText: data.message,
        metadata: data.metadata,
      };
    } catch (err) {
      console.error("Error processing text:", err);

      if (err instanceof TypeError && err.message.includes("fetch")) {
        setError("Network error. Please check your connection and try again.");
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to process text with AI. Please try again.");
      }

      throw err; // Re-throw so startProcessing can handle it
    } finally {
      setIsCleaningText(false);
    }
  }

  // async function generateAudio(customText?: string) {
  //   if (!currentDocumentVersionId) {
  //     setError("No document version available for audio generation");
  //     return;
  //   }

  //   setIsGeneratingAudio(true);
  //   setError(null);

  //   try {
  //     let requestBody: any;

  //     if (customText) {
  //       // Handle custom text by converting to ProcessedText structure
  //       const processedText: ProcessedText = {
  //         processed_text: {
  //           sections: [
  //             {
  //               title: "Custom Text",
  //               content: {
  //                 speech: [
  //                   {
  //                     text: customText,
  //                     reader_id: "default",
  //                   },
  //                 ],
  //               },
  //             },
  //           ],
  //         },
  //       };

  //       requestBody = {
  //         processedText: processedText,
  //         sectionIndex: 3,
  //         voice: "onyx",
  //         response_format: "mp3",
  //         word_timestamps: true,
  //         maxCharsPerSection: 1000,
  //         maxCharsPerSpeech: 300,
  //         mergeSectionSpeeches: true,
  //       };
  //     } else if (
  //       cleanedText &&
  //       typeof cleanedText === "object" &&
  //       cleanedText.processed_text?.sections
  //     ) {
  //       // Use structured content - generate audio for first section only
  //       requestBody = {
  //         processedText: cleanedText,
  //         sectionIndex: 3,
  //         voice: "onyx",
  //         response_format: "mp3",
  //         word_timestamps: true,
  //         maxCharsPerSection: 1000,
  //         maxCharsPerSpeech: 300,
  //         mergeSectionSpeeches: true,
  //       };
  //     } else {
  //       setError("No text available for audio generation");
  //       return;
  //     }

  //     // Before making the API call, check the content:
  //     if (cleanedText?.processed_text?.sections?.[0]?.content?.speech) {
  //       const firstSection = cleanedText.processed_text.sections[0];
  //       const totalText = firstSection.content.speech
  //         .map((s) => s.text)
  //         .join(" ");
  //       console.log("Text to process:", totalText.substring(0, 100) + "...");
  //       console.log("Text length:", totalText.length);

  //       if (!totalText.trim()) {
  //         setError("First section contains no text content");
  //         return;
  //       }
  //     }

  //     // Call the new structured audio API
  //     const response = await fetch("/api/lemonfox-structured", {
  //       method: "POST",
  //       headers: {
  //         "Content-Type": "application/json",
  //       },
  //       body: JSON.stringify(requestBody),
  //     });

  //     if (!response.ok) {
  //       const errorData = await response.json().catch(() => ({}));
  //       throw new Error(errorData.error || "Failed to generate audio");
  //     }

  //     // Always JSON response now
  //     const responseData = await response.json();

  //     if (!responseData.segments || responseData.segments.length === 0) {
  //       throw new Error("No audio segments generated");
  //     }

  //     // Use the first segment
  //     const firstSegment = responseData.segments[0];
  //     const audioBuffer = Uint8Array.from(atob(firstSegment.audioBase64), (c) =>
  //       c.charCodeAt(0)
  //     );
  //     const audioBlob = new Blob([audioBuffer], { type: "audio/mpeg" });

  //     // Calculate duration
  //     const audioDuration = await getAudioDurationAccurate(audioBlob);

  //     if (!audioDuration || !isFinite(audioDuration) || audioDuration <= 0) {
  //       throw new Error("Invalid audio duration calculated");
  //     }

  //     console.log(
  //       `Calculated audio duration: ${audioDuration.toFixed(2)} seconds`
  //     );

  //     // Create AudioVersion
  //     const { data: audioVersion, error: versionError } =
  //       await createAudioVersionAction({
  //         document_version_id: currentDocumentVersionId,
  //         tts_model: "lemonfox",
  //         voice_name: "onyx",
  //         speed: 1.0,
  //       });

  //     if (versionError || !audioVersion) {
  //       throw new Error(versionError || "Failed to create audio version");
  //     }

  //     // Convert to File for upload
  //     const audioFile = new File(
  //       [audioBlob],
  //       `audio-segment-${firstSegment.sectionIndex + 1}.mp3`,
  //       {
  //         type: "audio/mpeg",
  //       }
  //     );

  //     // Create AudioSegment with word timestamps
  //     const { data: audioSegment, error: segmentError } =
  //       await createAudioSegmentAction(
  //         {
  //           audio_version_id: audioVersion.id,
  //           segment_number: 1,
  //           section_title: firstSegment.sectionTitle,
  //           text_start_index: 0,
  //           text_end_index: firstSegment.textLength,
  //           audio_duration: Math.round(audioDuration * 100) / 100,
  //           word_timestamps: firstSegment.word_timestamps || [],
  //         },
  //         audioFile
  //       );

  //     if (segmentError || !audioSegment) {
  //       await deleteAudioVersionAction(audioVersion.id);
  //       throw new Error(segmentError || "Failed to create audio segment");
  //     }

  //     // Create local URL for playback
  //     const newAudioUrl = URL.createObjectURL(audioBlob);

  //     if (audioUrl) {
  //       URL.revokeObjectURL(audioUrl);
  //     }

  //     setAudioUrl(newAudioUrl);
  //     setCurrentAudioVersionId(audioVersion.id);

  //     console.log("Audio generated successfully:", {
  //       sectionTitle: firstSegment.sectionTitle,
  //       sectionIndex: firstSegment.sectionIndex,
  //       audioDuration,
  //       textLength: firstSegment.textLength,
  //       hasWordTimestamps: !!firstSegment.word_timestamps,
  //       totalSegments: responseData.totalSegments,
  //     });
  //   } catch (err) {
  //     console.error("Error generating audio:", err);
  //     setError(err instanceof Error ? err.message : "Failed to generate audio");
  //   } finally {
  //     setIsGeneratingAudio(false);
  //   }
  // }

  async function generateAudioTest() {
    console.log(customText);
    const response = await fetch("/api/lemonfox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: customText, // Changed from processedText to input to match API
        voice: "onyx",
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to generate audio");
    }

    // Get the audio data as ArrayBuffer (not JSON)
    const audioBuffer = await response.arrayBuffer();

    // Create blob and URL
    const audioBlob = new Blob([audioBuffer], { type: "audio/mpeg" });
    const audioUrl = URL.createObjectURL(audioBlob);

    // Create download link and trigger download
    const downloadLink = document.createElement("a");
    downloadLink.href = audioUrl;
    downloadLink.download = "speech.mp3"; // Set filename
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);

    // Clean up the object URL to free memory
    URL.revokeObjectURL(audioUrl);
  }

  const generateAudioForSection = async (
    sectionIndex: number,
    readerVoiceMap: Record<string, string>,
    existingAudioVersionId?: string
  ) => {
    if (
      !cleanedText ||
      !isStructuredContent(cleanedText) ||
      !currentDocumentVersionId
    ) {
      setError("Missing requirements for audio generation");
      return;
    }

    setGeneratingAudioSections((prev) => new Set(prev).add(sectionIndex));
    setError(null);

    try {
      const response = await fetch("/api/lemonfox-structured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          processedText: cleanedText,
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

      const responseData = await response.json();

      console.log(responseData);
      if (responseData.segments?.[0]) {
        const firstSegment = responseData.segments[0];
        const audioBuffer = Uint8Array.from(
          atob(firstSegment.audioBase64),
          (c) => c.charCodeAt(0)
        );
        const audioBlob = new Blob([audioBuffer], { type: "audio/mpeg" });

        const audioDuration = await getAudioDurationAccurate(audioBlob);

        // Use provided audio version ID or create a new one
        let audioVersionId = existingAudioVersionId || currentAudioVersionId;

        if (!audioVersionId) {
          const { data: newAudioVersion, error: versionError } =
            await createAudioVersionAction({
              document_version_id: currentDocumentVersionId,
              tts_model: "lemonfox",
              // voice_name: "onyx",
              speed: 1.0,
            });

          if (versionError || !newAudioVersion) {
            throw new Error(versionError || "Failed to create audio version");
          }

          audioVersionId = newAudioVersion.id;
          setCurrentAudioVersionId(newAudioVersion.id);
        }

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

        if (sectionAudioUrls[sectionIndex]) {
          URL.revokeObjectURL(sectionAudioUrls[sectionIndex]);
        }

        setSectionAudioUrls((prev) => ({
          ...prev,
          [sectionIndex]: audioUrl,
        }));

        console.log(`Audio generated for section ${sectionIndex}:`, {
          sectionTitle: firstSegment.sectionTitle,
          audioDuration,
          audioVersionId,
          segmentNumber: sectionIndex + 1,
        });
      }
    } catch (err) {
      console.error(`Error generating audio for section ${sectionIndex}:`, err);
      setError(err instanceof Error ? err.message : "Failed to generate audio");
    } finally {
      setGeneratingAudioSections((prev) => {
        const newSet = new Set(prev);
        newSet.delete(sectionIndex);
        return newSet;
      });
    }
  };

  const generateAllAudio = async () => {
    if (!cleanedText || !isStructuredContent(cleanedText)) {
      setError("No structured content available for audio generation");
      return;
    }

    if (!currentDocumentVersionId) {
      setError("No document version selected audio generation");
      return;
    }

    const readerVoiceMap = assignVoicesToReaders(cleanedText, [
      "heart",
      "fable",
    ]);

    // Create ONE audio version for all sections
    const { data: audioVersion, error: versionError } =
      await createAudioVersionAction({
        document_version_id: currentDocumentVersionId,
        tts_model: "lemonfox",
        // voice_name: "onyx",
        speed: 1.0,
      });

    if (versionError || !audioVersion) {
      setError(versionError || "Failed to create audio version");
      return;
    }

    setCurrentAudioVersionId(audioVersion.id);
    const totalSections = cleanedText.processed_text.sections.length;

    // Generate audio for each section using the same audio version
    for (let i = 0; i < totalSections; i++) {
      await generateAudioForSection(i, readerVoiceMap, audioVersion.id); // Pass the audio version ID
    }
  };

  const isStructuredContent = (content: any): content is ProcessedText => {
    return (
      content && typeof content === "object" && content.processed_text?.sections
    );
  };

  const processPDF = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setParsedPDF(null);
    setFileInfo(null);
    setClassification(null);
    setCleanedText(null);
    setProcessingMetadata(null);

    // if (audioUrl) {
    //   URL.revokeObjectURL(audioUrl);
    // }
    // setAudioUrl(null);

    try {
      // Generate thumbnail and process PDF in parallel
      const thumbnailPromise = generatePDFThumbnail(file);
      const pdfProcessingPromise = processPDFFile(file);

      const [pdfData, thumbnailDataUrl] = await Promise.all([
        pdfProcessingPromise,
        thumbnailPromise,
      ]);

      setParsedPDF(pdfData);

      let thumbnailFile: File | null = null;
      let thumbnailUrl: string | null = null;

      // Handle thumbnail data URL
      if (thumbnailDataUrl) {
        // Use the data URL directly for display
        thumbnailUrl = thumbnailDataUrl;

        // Convert data URL to File for upload to Supabase
        try {
          const response = await fetch(thumbnailDataUrl);
          const blob = await response.blob();
          thumbnailFile = new File([blob], `${file.name}-thumbnail.png`, {
            type: "image/png",
          });
        } catch (error) {
          console.warn("Failed to convert thumbnail data URL to File:", error);
        }
      }

      setFileInfo({
        name: file.name,
        size: file.size,
        thumbnailUrl: thumbnailUrl,
      });

      console.log(userId);

      // Create document record
      const { data: doc, error: docError } = await createDocumentAction({
        mime_type: file.type || "application/pdf",
        filename: file.name, // Use actual filename
        original_filename: file.name, // Use actual original filename
        document_type: "",
        raw_text: pdfData.text, // Store the extracted text
        page_count: pdfData.numPages, // Store page count if available
        file_size: file.size,
        metadata: {
          // Store any additional PDF metadata
          extractedAt: new Date().toISOString(),
          processingMethod: "client-side", // or whatever method you're using
          ...pdfData.metadata, // Include any metadata from PDF processing
        },
      });

      // Check for errors
      if (docError || !doc) {
        throw new Error(docError || "Failed to create document");
      }

      // Upload thumbnail to Supabase Storage (only if thumbnail was generated)
      if (thumbnailDataUrl) {
        console.log("About to upload thumbnail for document:", doc.id);
        console.log(
          "Thumbnail data URL length:",
          formatBytes(base64FileSize(thumbnailDataUrl))
        );

        const { success, error: thumbError } =
          await uploadDocumentThumbnailAction(doc.id, thumbnailDataUrl);

        if (!success) {
          console.error("Thumbnail upload failed:", thumbError);
          // Don't throw here, just warn since document creation succeeded
          setError(
            `Document created but thumbnail upload failed: ${thumbError}`
          );
        } else {
          console.log("Thumbnail uploaded successfully");
        }
      }

      // Clean up the local thumbnail URL after upload
      // (Keep it for now if you want to display it immediately)

      // Store document ID for later use (creating versions, etc.)
      setCurrentDocumentId(doc.id); // You'll need this state

      // Classify document if we have text
      if (pdfData.text.trim().length > 0) {
        const result = await classifyDocument(pdfData.text.trim());

        if (result) {
          updateDocumentAction(doc.id, {
            language: result.language,
            document_type: result.documentType,
          });
        }
      }

      console.log("Document created successfully:", doc);
    } catch (err) {
      console.error("Error processing PDF:", err);
      setError("Failed to process PDF. Please try again.");

      // Clean up thumbnail URL on error
      // if (thumbnailUrl) {
      //   URL.revokeObjectURL(thumbnailUrl);
      // }
    } finally {
      setIsProcessing(false);
    }
  };

  const resetDocument = () => {
    setParsedPDF(null);
    setFileInfo(null);
    setClassification(null);
    setCleanedText(null);
    setProcessingMetadata(null);
    setError(null);

    // Clean up all section audio URLs
    Object.values(sectionAudioUrls).forEach((url) => {
      URL.revokeObjectURL(url);
    });
    setSectionAudioUrls({});
    setGeneratingAudioSections(new Set());
  };

  const startProcessing = async () => {
    if (!parsedPDF?.text || !currentDocumentId) {
      setError("No document or text available for processing");
      return;
    }

    try {
      // Clean the text with OpenAI and get the structured result
      const processedContent = await cleanTextWithOpenAI(parsedPDF.text);

      if (processedContent) {
        // Store the structured content directly
        setCleanedText(processedContent.cleanedText); // This should now be the ProcessedText object
        setProcessingMetadata(processedContent.metadata);

        // Create document version with the structured content
        const { data: version, error: versionError } =
          await createDocumentVersionAction({
            document_id: currentDocumentId,
            version_name: `Processed - Level ${preprocessingLevel}`,
            processed_text: JSON.stringify(processedContent.cleanedText), // Store as JSON string in DB
            processing_type: preprocessingLevel.toString(),
            processing_metadata: processedContent.metadata || undefined,
          });

        if (versionError) {
          console.error("Failed to create document version:", versionError);
          setError(
            `Text processed successfully, but failed to save version: ${versionError}`
          );
        } else if (version) {
          setCurrentDocumentVersionId(version.id);
        }
      }
    } catch (error) {
      console.error("Error in processing workflow:", error);
      setError("Failed to process document. Please try again.");
    }
  };
  const reprocessText = () => {
    if (parsedPDF?.text) {
      cleanTextWithOpenAI(parsedPDF.text);
    }
  };

  const handleTextUpdate = (newText: string) => {
    // Convert string back to ProcessedText structure or handle appropriately
    // For now, you might want to store the edited text differently
    // or convert it back to the structured format

    // Simple approach: store as a single section
    const processedText: ProcessedText = {
      processed_text: {
        sections: [
          {
            title: "Edited Content",
            content: {
              speech: [
                {
                  text: newText,
                  reader_id: "default",
                },
              ],
            },
          },
        ],
      },
    };

    setCleanedText(processedText);

    // if (audioUrl) {
    //   URL.revokeObjectURL(audioUrl);
    //   setAudioUrl(null);
    // }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">
            PDF to Speech with AI Processing
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Upload a PDF file for document classification and AI processing.
          </p>
        </div>

        {/* Conditional Upload Area or Document Overview */}
        {!parsedPDF ? (
          /* Upload Area */
          <PDFUploadArea
            isDragOver={isDragOver}
            isProcessing={isProcessing || isClassifying}
            error={error}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onFileSelect={handleFileSelect}
          />
        ) : (
          /* Document Overview */
          <PDFDocumentOverview
            parsedPDF={parsedPDF}
            fileInfo={fileInfo}
            classification={classification}
            isClassifying={isClassifying}
            onReset={resetDocument}
          />
        )}

        {/* Processing Controls - Only show after classification */}
        {parsedPDF && classification && (
          <>
            {/* Processing Level Selector */}
            <ProcessingLevelSelector
              level={preprocessingLevel}
              onLevelChange={setPreprocessingLevel}
              canReprocess={!!cleanedText}
              isProcessing={isCleaningText}
              onReprocess={reprocessText}
              handleProcessWithAi={startProcessing}
            />
          </>
        )}

        <div className={`border rounded-lg p-4 `}>
          <textarea
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            className="w-full h-64 p-3 border border-gray-300 rounded-md resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            placeholder="Edit your text here..."
            spellCheck={false}
          />
          <Button onClick={() => generateAudioTest()}>test</Button>
        </div>

        {/* Results Display */}
        {parsedPDF && cleanedText && (
          <div className="p-6">
            <PDFResultsDisplay
              parsedPDF={parsedPDF}
              cleanedText={cleanedText}
              processingMetadata={processingMetadata}
              isCleaningText={isCleaningText}
              error={error}
              onProcessText={startProcessing}
              onTextUpdate={handleTextUpdate}
              // New section-based props
              sectionAudioUrls={sectionAudioUrls}
              generatingAudioSections={generatingAudioSections}
              onGenerateAudioForSection={generateAudioForSection}
              onGenerateAllAudio={generateAllAudio}
              voiceMap={assignVoicesToReaders(cleanedText, ["heart", "fable"])}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function base64FileSize(base64String: string): number {
  // Remove metadata part of the data URL
  const base64 = base64String.split(",")[1];
  // Calculate size
  return (
    (base64.length * 3) / 4 -
    (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0)
  );
}
