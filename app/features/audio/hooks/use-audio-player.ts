import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { AudioSegment, AudioVersionWithSegments } from "../types";
import { getAudioUrl } from "@/app/utils/storage";
import WaveSurfer from "wavesurfer.js";

interface SectionToggleState {
  [segmentId: string]: boolean;
}

export interface UseAudioPlayerProps {
  audioVersions: AudioVersionWithSegments[];
  documentVersionId: string;
}

export function useAudioPlayer({
  audioVersions,
  documentVersionId,
}: UseAudioPlayerProps) {
  // Find audio versions for this document version
  const versionAudioVersions = useMemo(
    () =>
      audioVersions.filter(
        (av) => av.document_version_id === documentVersionId
      ),
    [audioVersions, documentVersionId]
  );

  // Get all segments from all audio versions, sorted by segment number
  const allSegments = useMemo(() => {
    const segments: AudioSegment[] = [];
    versionAudioVersions.forEach((audioVersion) => {
      segments.push(...audioVersion.segments);
    });
    return segments.sort((a, b) => a.segment_number - b.segment_number);
  }, [versionAudioVersions]);

  // State for section toggles
  const [sectionToggles, setSectionToggles] = useState<SectionToggleState>({});

  // Audio state
  const [isLoading, setIsLoading] = useState(false);
  const [waveformReady, setWaveformReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [browserDuration, setBrowserDuration] = useState(0);
  const [concatenatedBuffer, setConcatenatedBuffer] =
    useState<AudioBuffer | null>(null);
  const [concatenatedUrl, setConcatenatedUrl] = useState<string | null>(null);
  const [gain, setGain] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Derived state that depends on toggles
  const [enabledSegmentIds, setEnabledSegmentIds] = useState<string[]>([]);
  const [enabledSegments, setEnabledSegments] = useState<AudioSegment[]>([]);
  const [totalDuration, setTotalDuration] = useState(0);

  // Refs
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Reset section toggles when document version changes
  useEffect(() => {
    if (allSegments.length > 0) {
      const initialToggles: SectionToggleState = {};
      allSegments.forEach((segment) => {
        initialToggles[segment.id] = true;
      });
      setSectionToggles(initialToggles);
    }
  }, [documentVersionId, allSegments]);

  // Update enabled segments when toggles change
  useEffect(() => {
    if (Object.keys(sectionToggles).length === 0) {
      setEnabledSegmentIds([]);
      setEnabledSegments([]);
      return;
    }

    const enabledIds = allSegments
      .filter((segment) => sectionToggles[segment.id])
      .map((segment) => segment.id);

    const enabled = allSegments
      .filter((segment) => sectionToggles[segment.id])
      .sort((a, b) => a.segment_number - b.segment_number);

    const total = enabled.reduce(
      (acc, segment) => acc + (segment.audio_duration || 0),
      0
    );

    setEnabledSegmentIds(enabledIds);
    setEnabledSegments(enabled);
    setTotalDuration(total);
  }, [allSegments, sectionToggles]);

  // Calculate segment timeline
  const segmentTimeline = useMemo(() => {
    let cumulativeTime = 0;
    return enabledSegments.map((segment) => {
      const startTime = cumulativeTime;
      const duration = Math.max(
        segment?.word_timestamps?.[segment?.word_timestamps.length - 1].end ||
          0,
        segment?.audio_duration || 0
      );
      const endTime = cumulativeTime + duration;
      cumulativeTime += duration;

      return {
        segmentId: segment.id,
        startTime,
        endTime,
        duration,
        segment,
      };
    });
  }, [enabledSegments]);

  // Gain calculation
  function getGainAtTime(buffer: AudioBuffer, time: number, windowSize = 1024) {
    const sampleRate = buffer.sampleRate;
    const channelData = buffer.getChannelData(0);

    const centerIndex = Math.floor(time * sampleRate);
    const start = Math.max(0, centerIndex - windowSize / 2);
    const end = Math.min(channelData.length, centerIndex + windowSize / 2);

    let sumSquares = 0;
    for (let i = start; i < end; i++) {
      const sample = channelData[i];
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / (end - start));
    return rms;
  }

  // Update gain
  useEffect(() => {
    if (!concatenatedBuffer) return;

    let rafId: number;
    const updateGain = () => {
      const g = getGainAtTime(concatenatedBuffer, currentTime, 2048);
      setGain(g);
      rafId = requestAnimationFrame(updateGain);
    };
    updateGain();

    return () => cancelAnimationFrame(rafId);
  }, [concatenatedBuffer, currentTime]);

  // Convert AudioBuffer to WAV Blob
  const audioBufferToBlob = useCallback(
    async (buffer: AudioBuffer): Promise<Blob> => {
      const numberOfChannels = buffer.numberOfChannels;
      const length = buffer.length;
      const sampleRate = buffer.sampleRate;

      const arrayBuffer = new ArrayBuffer(44 + length * numberOfChannels * 2);
      const view = new DataView(arrayBuffer);
      const writeString = (offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
        }
      };
      writeString(0, "RIFF");
      view.setUint32(4, 36 + length * numberOfChannels * 2, true);
      writeString(8, "WAVE");
      writeString(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, numberOfChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * numberOfChannels * 2, true);
      view.setUint16(32, numberOfChannels * 2, true);
      view.setUint16(34, 16, true);
      writeString(36, "data");
      view.setUint32(40, length * numberOfChannels * 2, true);
      let offset = 44;
      for (let i = 0; i < length; i++) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
          const sample = Math.max(
            -1,
            Math.min(1, buffer.getChannelData(channel)[i])
          );
          view.setInt16(
            offset,
            sample < 0 ? sample * 0x8000 : sample * 0x7fff,
            true
          );
          offset += 2;
        }
      }
      return new Blob([arrayBuffer], { type: "audio/wav" });
    },
    []
  );
  // Load and concatenate audio
  useEffect(() => {
    let mounted = true;

    const concatenateAudio = async () => {
      if (enabledSegmentIds.length === 0) {
        if (mounted) {
          setConcatenatedUrl(null);
          setIsLoading(false);
        }
        return;
      }

      if (mounted) {
        setIsLoading(true);
      }

      try {
        const ctx = new (window.AudioContext ||
          (window as any).webkitAudioContext)();

        const segmentsToUse = allSegments
          .filter((segment) => enabledSegmentIds.includes(segment.id))
          .sort((a, b) => a.segment_number - b.segment_number);

        const audioBuffers: AudioBuffer[] = [];
        let totalLength = 0;

        for (const segment of segmentsToUse) {
          if (!mounted) break;

          const audioUrl = await getAudioUrl(segment.audio_path);
          if (!audioUrl) continue;

          const response = await fetch(audioUrl);
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

          audioBuffers.push(audioBuffer);
          totalLength += audioBuffer.length;
        }

        if (!mounted || audioBuffers.length === 0) return;

        const numberOfChannels = audioBuffers[0].numberOfChannels;
        const sampleRate = audioBuffers[0].sampleRate;
        const concatenated = ctx.createBuffer(
          numberOfChannels,
          totalLength,
          sampleRate
        );

        let offset = 0;
        for (let channel = 0; channel < numberOfChannels; channel++) {
          const outputData = concatenated.getChannelData(channel);
          offset = 0;

          for (const buffer of audioBuffers) {
            const inputData = buffer.getChannelData(channel);
            outputData.set(inputData, offset);
            offset += buffer.length;
          }
        }

        if (mounted) {
          setConcatenatedBuffer(concatenated);
        }

        const blob = await audioBufferToBlob(concatenated);
        const url = URL.createObjectURL(blob);

        if (mounted) {
          setConcatenatedUrl(url);
        }
      } catch (error) {
        console.error("Error concatenating audio:", error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    concatenateAudio();

    return () => {
      mounted = false;
      if (concatenatedUrl) {
        URL.revokeObjectURL(concatenatedUrl);
      }
    };
  }, [enabledSegmentIds.join(","), allSegments]);

  // Initialize WaveSurfer with concatenated audio
  useEffect(() => {
    if (!containerRef.current || !concatenatedUrl) return;

    if (wavesurferRef.current) {
      try {
        wavesurferRef.current.destroy();
      } catch (error) {
        console.warn("Error destroying previous wavesurfer instance:", error);
      }
    }

    try {
      const wavesurfer = WaveSurfer.create({
        container: containerRef.current,
        waveColor: "rgba(75, 85, 99, 0.9)",
        progressColor: "rgba(148, 163, 184, 0.6)",
        cursorColor: "transparent",
        barWidth: 1,
        barGap: 1,
        barRadius: 2,
        height: 40,
        normalize: true,
        interact: false,
        backend: "MediaElement",
        mediaControls: false,
        audioRate: 1,
        hideScrollbar: true,
      });

      wavesurferRef.current = wavesurfer;

      wavesurfer.on("ready", () => {
        setWaveformReady(true);
        setIsReady(true);
      });

      wavesurfer.on("error", (error: any) => {
        console.error("WaveSurfer error:", error);
      });

      wavesurfer.load(concatenatedUrl);
    } catch (error) {
      console.error("Error initializing WaveSurfer:", error);
    }
  }, [concatenatedUrl]);

  // Create audio element for playback
  useEffect(() => {
    if (!concatenatedUrl) return;

    const audio = new Audio(concatenatedUrl);
    audio.preload = "metadata";
    audioRef.current = audio;

    let animationFrameId: number;
    let isAnimating = false;

    const smoothUpdateTime = () => {
      if (!isDragging && audio && !audio.paused) {
        setCurrentTime(audio.currentTime);
        setProgress((audio.currentTime / totalDuration) * 100);
      }

      if (isAnimating) {
        animationFrameId = requestAnimationFrame(smoothUpdateTime);
      }
    };

    const updateTime = () => {
      if (!isDragging && audio && !isAnimating) {
        setCurrentTime(audio.currentTime);
        setProgress((audio.currentTime / totalDuration) * 100);
      }
    };

    const handlePlay = () => {
      isAnimating = true;
      smoothUpdateTime();
    };

    const handlePause = () => {
      isAnimating = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };

    const handleLoadedMetadata = () => {
      setBrowserDuration(audio.duration);
      setIsReady(true);
    };

    const handleEnded = () => {
      isAnimating = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      setIsPlaying(false);
      setCurrentTime(0);
      setProgress(0);
    };

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);

    return () => {
      isAnimating = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }

      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audio.pause();
      audio.src = "";
    };
  }, [concatenatedUrl, totalDuration]);

  // Get effective duration
  const getEffectiveDuration = useCallback(() => {
    return totalDuration && totalDuration > 0 ? totalDuration : browserDuration;
  }, [totalDuration, browserDuration]);

  // Playback controls
  const togglePlayback = useCallback(() => {
    if (!isReady || !audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch((error) => {
          console.error("Error playing audio:", error);
        });
    }
  }, [isPlaying, isReady]);

  const seekToTime = useCallback(
    (targetTime: number) => {
      if (!audioRef.current) return;

      const effectiveDuration = getEffectiveDuration();
      const clampedTime = Math.max(0, Math.min(targetTime, effectiveDuration));

      if (
        totalDuration &&
        browserDuration > 0 &&
        Math.abs(browserDuration - totalDuration) >= 0.1
      ) {
        const mappedTime = (clampedTime / totalDuration) * browserDuration;
        audioRef.current.currentTime = Math.max(
          0,
          Math.min(mappedTime, browserDuration)
        );
      } else {
        audioRef.current.currentTime = clampedTime;
      }

      setCurrentTime(clampedTime);
      setProgress((clampedTime / effectiveDuration) * 100);
    },
    [totalDuration, browserDuration, getEffectiveDuration]
  );

  const skipBackward = useCallback(() => {
    const newTime = Math.max(0, currentTime - 10);
    seekToTime(newTime);
  }, [currentTime, seekToTime]);

  const skipForward = useCallback(() => {
    const newTime = Math.min(totalDuration, currentTime + 10);
    seekToTime(newTime);
  }, [currentTime, totalDuration, seekToTime]);

  // Progress bar handlers
  const handleProgressClick = useCallback(
    (e: React.MouseEvent) => {
      const container = e.currentTarget;
      const audio = audioRef.current;
      const effectiveDuration = getEffectiveDuration();

      if (!container || !audio || effectiveDuration === 0 || !isReady) return;

      const rect = container.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percentage = Math.max(
        0,
        Math.min(100, (clickX / rect.width) * 100)
      );

      const newTime = (percentage / 100) * effectiveDuration;
      seekToTime(newTime);
    },
    [isReady, getEffectiveDuration, seekToTime]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true);
      handleProgressClick(e);
    },
    [handleProgressClick]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      handleProgressClick(e);
    },
    [isDragging, handleProgressClick]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  return {
    // Audio state
    isLoading,
    waveformReady,
    isPlaying,
    currentTime,
    progress,
    isDragging,
    isReady,
    totalDuration,
    gain,
    playbackSpeed,
    concatenatedBuffer,
    audioBufferToBlob,

    // Segments
    allSegments,
    enabledSegments,
    enabledSegmentIds,
    segmentTimeline,
    sectionToggles,

    // Refs
    containerRef,

    // Handlers
    togglePlayback,
    skipBackward,
    skipForward,
    handleProgressClick,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    seekToTime,
    setSectionToggles,
    setPlaybackSpeed: (speed: number) => {
      setPlaybackSpeed(speed);
      if (audioRef.current) {
        audioRef.current.playbackRate = speed;
      }
    },
  };
}

export type AudioPlayerHook = ReturnType<typeof useAudioPlayer>;
