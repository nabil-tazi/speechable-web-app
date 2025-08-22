import { Badge } from "@/components/ui/badge";
import type { AudioVersionWithSegments } from "../../audio/types";
import type { DocumentVersion } from "../types";
import {
  AudioWaveform,
  CalendarFold,
  Clock,
  LanguagesIcon,
  MicVocal,
  Rabbit,
} from "lucide-react";
import { formatProcessingType } from "../utils";
import { getLanguageName } from "@/app/api/classify-document/constants";
import { formatDuration } from "../../audio/utils";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { WaveSurferPlayer } from "../../audio/components/wave-surfer-player";

export function DocumentVersionContent({
  documentVersion,
  audioVersions,
}: {
  documentVersion: DocumentVersion;
  audioVersions: AudioVersionWithSegments[];
}) {
  // Find audio versions for this document version
  const versionAudioVersions = audioVersions.filter(
    (av) => av.document_version_id === documentVersion.id
  );

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">{documentVersion.version_name}</h2>
      {/* Processed Text Section */}
      <div>
        {/* Audio Sections */}
        {versionAudioVersions.length > 0 && (
          <div>
            {versionAudioVersions.map((audioVersion) => (
              <div key={audioVersion.id} className="mb-6">
                <div className="flex items-center gap-1 mb-6">
                  {Number(documentVersion.processing_type) > 0 && (
                    <Badge variant="secondary">
                      <AudioWaveform />
                      {formatProcessingType(documentVersion.processing_type)}
                    </Badge>
                  )}
                  <Badge variant="secondary">
                    <MicVocal />{" "}
                    {audioVersion.segments.map((s) => s.voice_name).join(", ")}
                  </Badge>
                  {documentVersion.language && (
                    <Badge variant="secondary">
                      <LanguagesIcon />
                      {getLanguageName(
                        documentVersion.language
                      ).toLocaleLowerCase()}
                    </Badge>
                  )}
                  <Badge variant="secondary">
                    <Clock />
                    {formatDuration(
                      audioVersion.segments.reduce(
                        (acc, curr) => acc + (curr.audio_duration || 0),
                        0
                      )
                    )}
                  </Badge>
                  <Badge variant="secondary">
                    <Rabbit />×{audioVersion.speed}
                  </Badge>
                  <Badge variant="secondary">
                    <CalendarFold />
                    {new Date(documentVersion.created_at).toLocaleDateString(
                      "en-US"
                    )}
                  </Badge>
                </div>

                {audioVersion.segments.length > 0 ? (
                  <div className="space-y-3">
                    <Accordion
                      type="single"
                      collapsible={audioVersion.segments.length > 1}
                      className={`w-full`}
                      defaultValue="1"
                    >
                      {audioVersion.segments
                        .sort((a, b) => a.segment_number - b.segment_number)
                        .map((segment) => (
                          <AccordionItem
                            value={segment.segment_number.toString()}
                            key={segment.segment_number}
                          >
                            {audioVersion.segments.length > 1 && (
                              <AccordionTrigger className="text-2xl font-semibold">
                                {segment.section_title}
                              </AccordionTrigger>
                            )}
                            <AccordionContent>
                              <WaveSurferPlayer
                                key={segment.id}
                                segment={segment}
                              />
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                    </Accordion>
                  </div>
                ) : (
                  <p className="text-gray-500 italic">
                    No audio segments available.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* <h3 className="text-lg font-semibold mb-4">Document Content</h3>
        <div className="prose max-w-none">
          {documentVersion.processed_text ? (
            <div className="whitespace-pre-wrap text-sm leading-relaxed">
              {documentVersion.processed_text}
            </div>
          ) : (
            <p className="text-gray-500 italic">
              No processed text available for this version.
            </p>
          )}
        </div> */}
      </div>

      {versionAudioVersions.length === 0 && (
        <div className="text-center py-8">
          <p className="text-gray-500">
            No audio versions available for this document version.
          </p>
        </div>
      )}
    </div>
  );
}
