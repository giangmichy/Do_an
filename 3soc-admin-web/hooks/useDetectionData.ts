import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/app/api';
import type { BoundingBox } from '@/hooks/useRealtimeDetection';

export type ViolationFrame = {
  frame_number: number;
  timestamp: number;
  image_path: string;
  detections: BoundingBox[];
};

export type DetectionFrame = {
  timestamp: number;
  frame_number: number;
  boxes: BoundingBox[];
};

export type DetectionData = {
  file_id: string;
  video_fps: number;
  total_frames: number;
  scan_sample_ms: number;
  scanned_at: string;
  detections: DetectionFrame[];
  violations: ViolationFrame[];
};

export type ScanStatus = 'idle' | 'processing' | 'completed' | 'error';

const POLL_INTERVAL_MS = 2000;

export function useDetectionData(videoId: string) {
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [scanProgress, setScanProgress] = useState(0);
  const [detectionData, setDetectionData] = useState<DetectionData | null>(null);
  const [violationFrames, setViolationFrames] = useState<ViolationFrame[]>([]);
  const [detectionMap, setDetectionMap] = useState<Map<number, BoundingBox[]>>(new Map());

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fakeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fakeProgressRef = useRef(0);

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (fakeRef.current) clearInterval(fakeRef.current);
    setStatus('idle');
    setScanProgress(0);
    setDetectionData(null);
    setViolationFrames([]);
    setDetectionMap(new Map());
    fakeProgressRef.current = 0;
  };

  useEffect(() => {
    if (!videoId) { reset(); return; }

    reset();
    setStatus('processing');

    // Fake progress: tăng dần đến 95% trong khi đợi
    fakeRef.current = setInterval(() => {
      fakeProgressRef.current = Math.min(95, fakeProgressRef.current + Math.random() * 3);
      setScanProgress(Math.round(fakeProgressRef.current));
    }, 800);

    const poll = async () => {
      try {
        const res = await apiClient.getFileStatus(videoId);

        if (res.status === 'completed') {
          if (pollRef.current) clearInterval(pollRef.current);
          if (fakeRef.current) clearInterval(fakeRef.current);
          setScanProgress(100);
          setStatus('completed');

          const result = await apiClient.getDetections(videoId);
          const data: DetectionData = result.data;
          setDetectionData(data);
          setViolationFrames(data.violations || []);

          // Build Map<timestamp, BoundingBox[]> for CanvasOverlay
          const map = new Map<number, BoundingBox[]>();
          for (const frame of data.detections || []) {
            map.set(frame.timestamp, frame.boxes || []);
          }
          setDetectionMap(map);

        } else if (res.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          if (fakeRef.current) clearInterval(fakeRef.current);
          setStatus('error');
        }
        // 'processing' or 'uploaded' → keep polling
      } catch {
        // network error — keep polling
      }
    };

    // Poll immediately then every 2s
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (fakeRef.current) clearInterval(fakeRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  return { status, scanProgress, detectionData, violationFrames, detectionMap, reset };
}
