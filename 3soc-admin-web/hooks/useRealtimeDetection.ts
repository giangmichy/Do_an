import { useCallback, useState } from 'react';
const MAX_RESULT_ENTRIES = 2000;

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  confidence: number;
}

export function useRealtimeDetection({
  videoRef: _videoRef,
  videoId: _videoId,
  enabled: _enabled,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoId: string;
  enabled: boolean;
}) {
  void _videoRef;
  void _videoId;
  void _enabled;
  const [detectionResults, setDetectionResults] = useState<Map<number, BoundingBox[]>>(new Map());

  const appendDetectionResult = useCallback((timestamp: number, boxes: BoundingBox[]) => {
    if (!Number.isFinite(timestamp)) return;

    setDetectionResults((prev) => {
      const next = new Map(prev);

      next.set(timestamp, boxes || []);

      if (next.size > MAX_RESULT_ENTRIES) {
        let minTs: number | undefined;
        for (const ts of next.keys()) {
          if (minTs === undefined || ts < minTs) minTs = ts;
        }
        if (minTs !== undefined) {
          next.delete(minTs);
        }
      }

      return next;
    });
  }, []);

  const resetDetections = useCallback(() => {
    setDetectionResults(new Map());
  }, []);

  const setSingleDetection = useCallback((timestamp: number, boxes: BoundingBox[]) => {
    setDetectionResults(new Map([[timestamp, boxes || []]]));
  }, []);

  return {
    detectionResults,
    appendDetectionResult,
    resetDetections,
    setSingleDetection,
  };
}
