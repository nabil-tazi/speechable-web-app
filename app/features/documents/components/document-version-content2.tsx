import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import { useState, useEffect, useMemo, useCallback } from "react";
import { WaveSurferPlayer } from "../../audio/components/wave-surfer-player";
import { UnifiedAudioPlayer } from "../../audio/components/unified-wave-surfer-player";

interface AudioSegment {
  id: string;
  audio_version_id: string;
  segment_number: number;
  section_title?: string;
  start_page?: number;
  end_page?: number;
  text_start_index?: number;
  text_end_index?: number;
  audio_path: string;
  audio_duration?: number;
  audio_file_size: number;
  word_timestamps?: Array<{
    word: string;
    start: number;
    end: number;
  }>;
  created_at: string;
}

interface SectionToggleState {
  [segmentId: string]: boolean;
}

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

  // State for section toggles
  const [sectionToggles, setSectionToggles] = useState<SectionToggleState>({});

  // Get all segments from all audio versions, sorted by segment number
  const allSegments = useMemo(() => {
    const segments: AudioSegment[] = [];
    versionAudioVersions.forEach((audioVersion) => {
      segments.push(...audioVersion.segments);
    });
    return segments.sort((a, b) => a.segment_number - b.segment_number);
  }, [versionAudioVersions]);

  // Initialize section toggles (all enabled by default)
  useEffect(() => {
    if (allSegments.length > 0 && Object.keys(sectionToggles).length === 0) {
      const initialToggles: SectionToggleState = {};
      allSegments.forEach((segment) => {
        initialToggles[segment.id] = true;
      });
      setSectionToggles(initialToggles);
    }
  }, [allSegments.length]);

  // Get enabled segment IDs based on toggle state
  const enabledSegmentIds = useMemo(() => {
    if (Object.keys(sectionToggles).length === 0) return [];
    return allSegments
      .filter((segment) => sectionToggles[segment.id])
      .map((segment) => segment.id);
  }, [allSegments, sectionToggles]);

  // Calculate total duration of enabled segments
  const totalDuration = useMemo(() => {
    const enabledSegments = allSegments.filter((segment) =>
      enabledSegmentIds.includes(segment.id)
    );
    return enabledSegments.reduce(
      (acc, segment) => acc + (segment.audio_duration || 0),
      0
    );
  }, [allSegments, enabledSegmentIds]);

  // Handle section toggle
  const handleSectionToggle = useCallback(
    (segmentId: string, enabled: boolean) => {
      setSectionToggles((prev) => ({
        ...prev,
        [segmentId]: enabled,
      }));
    },
    []
  );

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">{documentVersion.version_name}</h2>

      {versionAudioVersions.length > 0 && (
        <div className="space-y-6">
          {/* Version Info Badges */}
          <div className="flex items-center gap-1 flex-wrap">
            {Number(documentVersion.processing_type) > 0 && (
              <Badge variant="secondary">
                <AudioWaveform className="w-3 h-3 mr-1" />
                {formatProcessingType(documentVersion.processing_type)}
              </Badge>
            )}
            {versionAudioVersions[0] && (
              <Badge variant="secondary">
                <MicVocal className="w-3 h-3 mr-1" />
                {[
                  ...new Set(
                    versionAudioVersions[0].segments.map((s) => s.voice_name)
                  ),
                ].join(", ")}
              </Badge>
            )}
            {documentVersion.language && (
              <Badge variant="secondary">
                <LanguagesIcon className="w-3 h-3 mr-1" />
                {getLanguageName(documentVersion.language).toLowerCase()}
              </Badge>
            )}
            <Badge variant="secondary">
              <Clock className="w-3 h-3 mr-1" />
              {formatDuration(totalDuration)}
            </Badge>
            {versionAudioVersions[0] && (
              <Badge variant="secondary">
                <Rabbit className="w-3 h-3 mr-1" />×
                {versionAudioVersions[0].speed}
              </Badge>
            )}
            <Badge variant="secondary">
              <CalendarFold className="w-3 h-3 mr-1" />
              {new Date(documentVersion.created_at).toLocaleDateString("en-US")}
            </Badge>
          </div>

          {/* Section Controls */}
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-4">Select Sections to Include</h3>
              <div className="space-y-3">
                {allSegments.map((segment) => (
                  <div
                    key={segment.id}
                    className={`flex items-center justify-between p-3 rounded-lg border-2 transition-all ${
                      sectionToggles[segment.id]
                        ? "border-blue-200 bg-blue-50"
                        : "border-gray-200 bg-gray-50 opacity-60"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Switch
                        id={segment.id}
                        checked={sectionToggles[segment.id] || false}
                        onCheckedChange={(checked) =>
                          handleSectionToggle(segment.id, checked)
                        }
                      />
                      <Label
                        htmlFor={segment.id}
                        className="font-medium cursor-pointer"
                      >
                        {segment.section_title ||
                          `Section ${segment.segment_number}`}
                      </Label>
                    </div>
                    <div className="text-sm text-gray-600">
                      {formatDuration(segment.audio_duration || 0)}
                    </div>
                  </div>
                ))}
              </div>

              {enabledSegmentIds.length === 0 && (
                <div className="text-center py-6 text-gray-500">
                  <p>
                    No sections selected. Enable sections above to create your
                    custom audio experience.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Unified Audio Player */}
          {enabledSegmentIds.length > 0 && (
            <UnifiedAudioPlayer
              segments={allSegments}
              enabledSegmentIds={enabledSegmentIds}
            />
          )}

          {/* Individual Section Players */}
          {/* {enabledSegmentIds.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-semibold">Individual Section Players</h3>
              <div className="space-y-4">
                {allSegments
                  .filter((segment) => enabledSegmentIds.includes(segment.id))
                  .map((segment) => (
                    <div
                      key={segment.id}
                      className="border-2 rounded-lg p-4 border-blue-200 bg-blue-50"
                    >
                      <h4 className="text-lg font-medium mb-3">
                        {segment.section_title ||
                          `Section ${segment.segment_number}`}
                      </h4>
                      <WaveSurferPlayer segment={segment} />
                    </div>
                  ))}
              </div>
            </div>
          )} */}
        </div>
      )}

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
