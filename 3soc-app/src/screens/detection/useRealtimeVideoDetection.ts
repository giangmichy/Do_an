import { useCallback, useEffect, useRef, useState } from 'react';
import { Video } from 'expo-av';
import { apiClient } from '../../api';
import { BACKEND_BASE_URL } from '../../config';
import type { MediaType, ViolationFrame } from './types';

type SseController = {
  close: () => void;
};

const BOX_STALE_MS = 200;

const DETECT_SAMPLE_MS = 180;
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
  currentPositionMsRef: React.MutableRefObject<number>;
  lastStatusPosRef: React.MutableRefObject<number>;
  lastStatusTimeRef: React.MutableRefObject<number>;
  lastRenderPosRef: React.MutableRefObject<number>;
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
  lastStatusPosRef,
  lastStatusTimeRef,
  lastRenderPosRef,
}: UseRealtimeVideoDetectionParams) {
  void mediaUri;
  void isVideoPlaying;
  void videoId;
  void currentPositionMs;

  const [isDetecting, setIsDetecting] = useState(false);
  const [hasDetections, setHasDetections] = useState(false);
  const [violationFrames, setViolationFrames] = useState<ViolationFrame[]>([]);
  const [videoDetections, setVideoDetections] = useState<Map<number, any[]>>(new Map());
  const [currentVideoBoxes, setCurrentVideoBoxes] = useState<any[]>([]);

  const sseRef = useRef<SseController | null>(null);
  const isDetectingRef = useRef(false);
  const seenViolationKeysRef = useRef<Set<string>>(new Set());
  const videoDetectionsRef = useRef<Map<number, any[]>>(new Map());

  // Cập nhật videoDetectionsRef mỗi khi state thay đổi
  useEffect(() => {
    videoDetectionsRef.current = videoDetections;
  }, [videoDetections]);

  // Hàm tính box hiện tại theo position → set state
  const updateCurrentBoxes = useCallback((pos: number) => {
    const map = videoDetectionsRef.current;
    const timestamps = Array.from(map.keys()).sort((a, b) => a - b);
    if (timestamps.length === 0) {
      setCurrentVideoBoxes([]);
      return;
    }
    for (let i = timestamps.length - 1; i >= 0; i--) {
      const ts = timestamps[i];
      if (ts > pos) continue;
      if (pos - ts > BOX_STALE_MS) break;
      const boxes = map.get(ts);
      if (boxes && boxes.length > 0) {
        setCurrentVideoBoxes(boxes);
        return;
      }
    }
    setCurrentVideoBoxes([]);
  }, []);

  // Dùng requestAnimationFrame để cập nhật box mượt 60fps
  // Thay vì chờ parent poll mỗi 50ms → lag do setState + reconcile
  useEffect(() => {
    if (!isDetecting && !hasDetections) return;

    let frameId: number;
    let lastPos = -1;

    const loop = () => {
      const pos = currentPositionMsRef.current;
      if (pos !== lastPos) {
        lastPos = pos;
        updateCurrentBoxes(pos);
      }
      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(frameId);
  }, [isDetecting, hasDetections, updateCurrentBoxes]);

  // Sync position từ native mỗi 100ms để giữ ref đồng bộ
  // Tiếp tục sync khi đã có detection data để box vẫn hiển thị sau khi SSE done
  useEffect(() => {
    if (!isDetecting && !hasDetections) return;

    const syncPosition = () => {
      lastStatusTimeRef.current = Date.now();
      lastStatusPosRef.current = currentPositionMsRef.current;

      try {
        videoRef.current?.getStatusAsync().then((status) => {
          if (status && status.isLoaded) {
            const pos = status.positionMillis;
            currentPositionMsRef.current = pos;
            lastStatusPosRef.current = pos;
            lastStatusTimeRef.current = Date.now();
            lastRenderPosRef.current = pos;
          }
        }).catch(() => { /* ignore */ });
      } catch {
        // ignore
      }
    };

    syncPosition();

    const id = setInterval(syncPosition, 100);

    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDetecting, hasDetections]);

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
    if (boxes && boxes.length > 0) setHasDetections(true);
    // Cập nhật box ngay khi nhận detection mới
    const pos = currentPositionMsRef.current ?? 0;
    if (Math.abs(timestamp - pos) <= BOX_STALE_MS && boxes && boxes.length > 0) {
      setCurrentVideoBoxes(boxes);
    }
  }, [currentPositionMsRef]);

  const stopDetection = useCallback(() => {
    closeSse();
    setIsDetecting(false);
    isDetectingRef.current = false;
  }, [closeSse]);

  const resetRealtimeState = useCallback(() => {
    stopDetection();
    seenViolationKeysRef.current.clear();
    setViolationFrames([]);
    setVideoDetections(new Map());
    videoDetectionsRef.current = new Map();
    setCurrentVideoBoxes([]);
    setHasDetections(false);
    currentPositionMsRef.current = 0;
    lastStatusPosRef.current = 0;
    lastStatusTimeRef.current = 0;
    lastRenderPosRef.current = 0;
  }, [stopDetection, currentPositionMsRef, lastStatusPosRef, lastStatusTimeRef, lastRenderPosRef]);

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
          try {
            xhr.abort();
          } catch {
            // ignore
          }
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
    setViolationFrames([]);
    setVideoDetections(new Map());
    videoDetectionsRef.current = new Map();
    setCurrentVideoBoxes([]);
    setHasDetections(false);
    setIsDetecting(true);
    isDetectingRef.current = true;

    const apiToken = apiClient.getToken();
    const streamUrl = `${BACKEND_BASE_URL}/api/files/${uploadedFileId}/detect-stream?sample_ms=${DETECT_SAMPLE_MS}&cooldown_ms=${SAVE_COOLDOWN_MS}&save_image_ms=${SAVE_IMAGE_MS}${apiToken ? `&token=${encodeURIComponent(apiToken)}` : ''}`;

    sseRef.current = startSseStream(
      streamUrl,
      (raw) => {
        try {
          const payload = JSON.parse(raw);
          if (!payload?.type) return;

          if (payload.type === 'detection') {
            if (!payload.data) return;
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

          if (payload.type === 'complete' && isDetectingRef.current) {
            stopDetection();
          }
        } catch {
          // ignore
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

  return {
    isDetecting,
    violationFrames,
    currentVideoBoxes,
    startVideoDetection,
    stopDetection,
    resetRealtimeState,
  };
}
