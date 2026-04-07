import { useCallback, useMemo, useRef, useState } from 'react';
import { Video } from 'expo-av';
import { apiClient } from '../../api';
import { BACKEND_BASE_URL } from '../../config';
import type { MediaType, ViolationFrame } from './types';

type SseController = {
  close: () => void;
};

const DETECT_SAMPLE_MS = 200;
const BOX_STALE_MS = DETECT_SAMPLE_MS * 2; // = 400ms
const SAVE_COOLDOWN_MS = 200;
const SAVE_IMAGE_MS = 2000;

type UseRealtimeVideoDetectionParams = {
  videoRef: React.RefObject<Video | null>;
  mediaUri: string | null;
  mediaType: MediaType;
  videoId: string;
  uploadedFileId: string;
  isVideoPlaying: boolean;
  currentPositionMs: number;
  currentPositionMsRef: React.RefObject<number>;
};

export function useRealtimeVideoDetection({
  videoRef,
  mediaUri,
  mediaType,
  videoId,
  uploadedFileId,
  isVideoPlaying,
  currentPositionMs,
  currentPositionMsRef,
}: UseRealtimeVideoDetectionParams) {
  void videoRef;
  void mediaUri;
  void isVideoPlaying;

  const [isDetecting, setIsDetecting] = useState(false);
  const [violationFrames, setViolationFrames] = useState<ViolationFrame[]>([]);
  const [videoDetections, setVideoDetections] = useState<Map<number, any[]>>(new Map());
  const [scanDone, setScanDone] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);

  const sseRef = useRef<SseController | null>(null);
  const isDetectingRef = useRef(false);
  const seenViolationKeysRef = useRef<Set<string>>(new Set());
  const totalFramesRef = useRef(0);

  const normalizeTimestampMs = useCallback((rawTs: any) => {
    const ts = Number(rawTs ?? 0);
    if (!Number.isFinite(ts) || ts < 0) return 0;
    if (Number.isInteger(ts)) return ts;
    if (ts < 1000) return ts * 1000;
    return ts;
  }, []);

  const extractBoxes = useCallback((payload: any): any[] => {
    if (Array.isArray(payload?.detections)) return payload.detections;
    if (Array.isArray(payload?.boxes)) return payload.boxes;
    return [];
  }, []);

  const closeSse = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
  }, []);

  const appendViolation = useCallback((violation: ViolationFrame) => {
    const key = `${violation.frame_number}-${violation.timestamp}`;
    if (seenViolationKeysRef.current.has(key)) return;
    seenViolationKeysRef.current.add(key);
    setViolationFrames((prev) => [...prev, violation]);
  }, []);

  const appendVideoDetection = useCallback((timestamp: number, boxes: any[]) => {
    setVideoDetections((prev) => {
      const next = new Map(prev);
      next.set(timestamp, boxes || []);
      if (next.size > 1200) {
        const firstKey = next.keys().next().value;
        if (firstKey !== undefined) next.delete(firstKey);
      }
      return next;
    });
  }, []);

  const stopDetection = useCallback(() => {
    closeSse();
    setIsDetecting(false);
    isDetectingRef.current = false;
  }, [closeSse]);

  const resetRealtimeState = useCallback(() => {
    stopDetection();
    seenViolationKeysRef.current.clear();
    totalFramesRef.current = 0;
    setViolationFrames([]);
    setVideoDetections(new Map());
    setScanDone(false);
    setScanProgress(0);
  }, [stopDetection]);

  const startSseStream = useCallback(
    (
      url: string,
      onMessage: (rawData: string) => void,
      onEnd?: () => void,
      onError?: (error: Error) => void,
    ): SseController => {
      const xhr = new XMLHttpRequest();
      let lastProcessedIndex = 0;
      let buffer = '';

      const flushBuffer = () => {
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        events.forEach((eventBlock) => {
          if (!eventBlock.trim()) return;
          const dataLines = eventBlock
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart());
          if (dataLines.length === 0) return;
          onMessage(dataLines.join('\n'));
        });
      };

      xhr.onprogress = () => {
        const responseText = xhr.responseText || '';
        if (responseText.length <= lastProcessedIndex) return;
        const chunk = responseText.slice(lastProcessedIndex);
        lastProcessedIndex = responseText.length;
        buffer += chunk.replace(/\r\n/g, '\n');
        flushBuffer();
      };

      xhr.onreadystatechange = () => {
        if (xhr.readyState !== XMLHttpRequest.DONE) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          if (buffer.trim()) {
            buffer += '\n\n';
            flushBuffer();
          }
          onEnd?.();
          return;
        }
        if (xhr.status !== 0) {
          onError?.(new Error(`SSE request failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => onError?.(new Error('SSE network error'));

      xhr.open('GET', url, true);
      xhr.setRequestHeader('Accept', 'text/event-stream');
      xhr.setRequestHeader('Cache-Control', 'no-cache');

      const token = apiClient.getToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.send();

      return {
        close: () => {
          try { xhr.abort(); } catch { /* ignore */ }
        },
      };
    },
    [],
  );

  const startVideoDetection = useCallback(() => {
    if (mediaType !== 'video') return false;
    if (!uploadedFileId) return false;

    closeSse();
    seenViolationKeysRef.current.clear();
    totalFramesRef.current = 0;
    setViolationFrames([]);
    setVideoDetections(new Map());
    setScanDone(false);
    setScanProgress(0);
    setIsDetecting(true);
    isDetectingRef.current = true;

    const streamUrl = `${BACKEND_BASE_URL}/api/files/${uploadedFileId}/detect-stream?sample_ms=${DETECT_SAMPLE_MS}&cooldown_ms=${SAVE_COOLDOWN_MS}&save_image_ms=${SAVE_IMAGE_MS}`;

    sseRef.current = startSseStream(
      streamUrl,
      (raw) => {
        try {
          const payload = JSON.parse(raw);
          if (!payload?.type) return;

          if (payload.type === 'metadata') {
            totalFramesRef.current = payload.total_frames ?? 0;
            setScanProgress(0);
            return;
          }

          if (payload.type === 'detection') {
            if (!payload.data) return;
            const frameNumber = payload.data.frame_number ?? 0;
            const total = totalFramesRef.current;
            if (total > 0) {
              setScanProgress(Math.min(99, Math.round((frameNumber / total) * 100)));
            }
            appendVideoDetection(
              normalizeTimestampMs(payload.data.timestamp ?? 0),
              extractBoxes(payload.data),
            );
            return;
          }

          if (payload.type === 'violation') {
            if (!payload.data) return;
            const violation = payload.data as ViolationFrame;
            appendViolation(violation);
            appendVideoDetection(
              normalizeTimestampMs(violation.timestamp ?? 0),
              extractBoxes(violation),
            );
            return;
          }

          if (payload.type === 'complete') {
            setScanDone(true);
            setScanProgress(100);
            // Do NOT call stopDetection() — keep isDetecting=true so UI stays consistent
          }
        } catch {
          // ignore invalid chunk
        }
      },
      () => {
        if (isDetectingRef.current) stopDetection();
      },
      () => {
        if (isDetectingRef.current) stopDetection();
      },
    );

    return true;
  }, [
    appendVideoDetection,
    appendViolation,
    closeSse,
    extractBoxes,
    mediaType,
    normalizeTimestampMs,
    stopDetection,
    startSseStream,
    uploadedFileId,
  ]);

  const videoDetectionTimestamps = useMemo(
    () => Array.from(videoDetections.keys()).sort((a, b) => a - b),
    [videoDetections],
  );

  const currentVideoBoxes = useMemo(() => {
    const posMs = currentPositionMsRef.current ?? 0;
    if (videoDetectionTimestamps.length === 0) return [];

    let result: any[] = [];
    for (let i = videoDetectionTimestamps.length - 1; i >= 0; i--) {
      const ts = videoDetectionTimestamps[i];
      if (ts > posMs) continue;
      if (posMs - ts > BOX_STALE_MS) break;
      const boxes = videoDetections.get(ts) || [];
      if (boxes.length > 0) { result = boxes; break; }
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPositionMs, currentPositionMsRef, videoDetectionTimestamps, videoDetections]);

  return {
    isDetecting,
    violationFrames,
    currentVideoBoxes,
    scanDone,
    scanProgress,
    startVideoDetection,
    stopDetection,
    resetRealtimeState,
  };
}
