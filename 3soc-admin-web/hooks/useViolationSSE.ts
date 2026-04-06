import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoundingBox } from '@/hooks/useRealtimeDetection';

export type ViolationFrame = {
  frame_number: number;
  timestamp: number;
  image_path: string;
  detections: BoundingBox[];
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
const DETECT_SAMPLE_MS = 50;
const SAVE_COOLDOWN_MS = 200;
const SAVE_IMAGE_MS = 2000;

export function useViolationSSE({
  videoId,
  enabled,
  onViolation,
}: {
  videoId: string;
  enabled: boolean;
  onViolation?: (violation: ViolationFrame) => void;
}) {
  const sseRef = useRef<EventSource | null>(null);
  const onViolationRef = useRef<typeof onViolation>(onViolation);
  const seenKeysRef = useRef<Set<string>>(new Set());
  const [violationFrames, setViolationFrames] = useState<ViolationFrame[]>([]);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanDone, setScanDone] = useState(false);
  const totalFramesRef = useRef(0);

  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  const appendViolation = useCallback((violation: ViolationFrame) => {
    const key = `${violation.frame_number}-${violation.timestamp}`;
    if (seenKeysRef.current.has(key)) return;
    seenKeysRef.current.add(key);

    setViolationFrames((prev) => {
      return [...prev, violation];
    });
  }, []);

  const resetViolations = useCallback(() => {
    seenKeysRef.current.clear();
    setViolationFrames([]);
    setScanProgress(0);
    setScanDone(false);
    totalFramesRef.current = 0;
  }, []);

  useEffect(() => {
    if (!enabled || !videoId) return;

    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }

    const es = new EventSource(
      `${API_BASE_URL}/files/${videoId}/detect-stream?sample_ms=${DETECT_SAMPLE_MS}&cooldown_ms=${SAVE_COOLDOWN_MS}&save_image_ms=${SAVE_IMAGE_MS}`
    );
    sseRef.current = es;

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (!payload?.type) return;

        if (payload.type === 'metadata') {
          totalFramesRef.current = payload.total_frames || 0;
          setScanProgress(0);
          setScanDone(false);
          return;
        }

        if (payload.type === 'detection') {
          const detection = {
            frame_number: payload.data?.frame_number ?? 0,
            timestamp: payload.data?.timestamp,
            image_path: '',
            detections: payload.data?.detections || [],
          } as ViolationFrame;
          onViolationRef.current?.(detection);

          // Cập nhật tiến độ
          if (totalFramesRef.current > 0) {
            const pct = Math.min(99, Math.round(
              ((payload.data?.frame_number || 0) / totalFramesRef.current) * 100
            ));
            setScanProgress(pct);
          }
          return;
        }

        if (payload.type === 'violation') {
          const violation = (payload.data ?? payload) as ViolationFrame;
          appendViolation(violation);
          onViolationRef.current?.(violation);
          return;
        }

        if (payload.type === 'complete') {
          setScanProgress(100);
          setScanDone(true);
          return;
        }
      } catch (error) {
        console.error('[SSE] Invalid payload:', error);
      }
    };

    es.onerror = () => {
      console.warn('[SSE] Stream disconnected, waiting for auto-reconnect...');
    };

    return () => {
      es.close();
      if (sseRef.current === es) {
        sseRef.current = null;
      }
    };
  }, [enabled, videoId, appendViolation]);

  useEffect(() => {
    return () => {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
    };
  }, []);

  return {
    violationFrames,
    resetViolations,
    scanProgress,
    scanDone,
  };
}
