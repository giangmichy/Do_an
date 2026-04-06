'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import type { BoundingBox } from '@/hooks/useRealtimeDetection';

// Khoảng thời gian chấp nhận bbox trước/sau currentTime
const STALE_AFTER_MS       = 80;  // giữ box tối đa 80ms SAU detection timestamp
const STALE_BEFORE_MS      = 20;  // chấp nhận box đến SỚM hơn 20ms
const EMPTY_FRAME_THRESHOLD = 2;  // cần N frame liên tiếp rỗng mới xóa box

const MODEL_COLORS: Record<string, string> = {
    co3soc:      '#FF0000',
    duongluoibo: '#00FF00',
    vnmap:       '#0000FF',
};

const LABEL_VI: Record<string, string> = {
    co3soc:      'Cờ 3 sọc',
    duongluoibo: 'Đường lưỡi bò',
    vnmap:       'VN',
};

interface CanvasOverlayProps {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    detectionResults: Map<number, BoundingBox[]>;
    enabled: boolean;
}

export const CanvasOverlay = React.memo(function CanvasOverlay({
    videoRef,
    detectionResults,
    enabled,
}: CanvasOverlayProps) {
    const canvasRef    = useRef<HTMLCanvasElement>(null);
    const rafRef       = useRef<number>(0);
    const detectionRef = useRef<Map<number, BoundingBox[]>>(detectionResults);
    const sortedTsRef  = useRef<number[]>([]);
    const lastBoxesRef      = useRef<BoundingBox[]>([]); // giữ box cuối, tránh flash trắng
    const emptyFrameCountRef = useRef<number>(0);        // đếm frame liên tiếp không có vi phạm

    // Sync detectionResults vào ref (không trigger re-render)
    useEffect(() => {
        detectionRef.current = detectionResults;
        sortedTsRef.current  = Array.from(detectionResults.keys()).sort((a, b) => a - b);
    }, [detectionResults]);

    // Tìm boxes phù hợp với thời điểm hiện tại của video
    const findBoxes = useCallback((currentMs: number): BoundingBox[] => {
        const timestamps = sortedTsRef.current;
        if (timestamps.length === 0) return lastBoxesRef.current;

        // Binary search: tìm vị trí chèn của currentMs
        let lo = 0;
        let hi = timestamps.length - 1;
        let insertIdx = timestamps.length;

        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (timestamps[mid] <= currentMs) {
                lo = mid + 1;
            } else {
                insertIdx = mid;
                hi = mid - 1;
            }
        }

        // timestamps[insertIdx - 1] = timestamp lớn nhất <= currentMs (frame vừa qua)
        // timestamps[insertIdx]     = timestamp nhỏ nhất > currentMs  (frame sắp tới)
        const prevIdx = insertIdx - 1;
        const nextIdx = insertIdx;

        // Kiểm tra frame vừa qua
        if (prevIdx >= 0) {
            const prevTs   = timestamps[prevIdx];
            const diffPrev = currentMs - prevTs; // dương = đã qua

            if (diffPrev <= STALE_AFTER_MS) {
                const boxes = detectionRef.current.get(prevTs) || [];
                if (boxes.length > 0) {
                    emptyFrameCountRef.current = 0;
                    lastBoxesRef.current = boxes;
                    return boxes;
                } else {
                    // Frame rỗng — cần N frame liên tiếp mới xóa box
                    emptyFrameCountRef.current += 1;
                    if (emptyFrameCountRef.current >= EMPTY_FRAME_THRESHOLD) {
                        lastBoxesRef.current = [];
                        return [];
                    }
                    return lastBoxesRef.current;
                }
            }
        }

        // Nhìn trước frame sắp tới (compensate render latency)
        if (nextIdx < timestamps.length) {
            const nextTs   = timestamps[nextIdx];
            const diffNext = nextTs - currentMs; // dương = chưa tới

            if (diffNext <= STALE_BEFORE_MS) {
                const boxes = detectionRef.current.get(nextTs) || [];
                if (boxes.length > 0) {
                    emptyFrameCountRef.current = 0;
                    lastBoxesRef.current = boxes;
                    return boxes;
                }
            }
        }

        // Không có frame nào trong khoảng → giữ box cuối (tránh flash trắng)
        return lastBoxesRef.current;
    }, []);

    // Vẽ boxes lên canvas
    const draw = useCallback((
        ctx: CanvasRenderingContext2D,
        canvas: HTMLCanvasElement,
        video: HTMLVideoElement,
        boxes: BoundingBox[],
    ) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (boxes.length === 0) return;

        const vw = video.videoWidth  || canvas.width;
        const vh = video.videoHeight || canvas.height;
        const videoAspect  = vw / vh;
        const canvasAspect = canvas.width / canvas.height;

        let rw: number, rh: number, ox: number, oy: number;
        if (videoAspect > canvasAspect) {
            rw = canvas.width;
            rh = canvas.width / videoAspect;
            ox = 0;
            oy = (canvas.height - rh) / 2;
        } else {
            rh = canvas.height;
            rw = canvas.height * videoAspect;
            ox = (canvas.width - rw) / 2;
            oy = 0;
        }

        const scaleX = rw / vw;
        const scaleY = rh / vh;

        boxes.forEach(box => {
            const x = box.x * scaleX + ox;
            const y = box.y * scaleY + oy;
            const w = box.width  * scaleX;
            const h = box.height * scaleY;

            const color    = MODEL_COLORS[box.label] || '#FFFF00';
            const labelVi  = LABEL_VI[box.label] || box.label;
            const scorePct = box.confidence <= 1
                ? (box.confidence * 100).toFixed(0)
                : box.confidence.toFixed(0);
            const labelText = `${labelVi} ${scorePct}%`;

            // Vẽ khung
            ctx.strokeStyle = color;
            ctx.lineWidth   = 3;
            ctx.strokeRect(x, y, w, h);

            // Vẽ nền label
            ctx.font = 'bold 13px Arial';
            const tw = ctx.measureText(labelText).width + 10;
            const th = 20;
            ctx.fillStyle = color;
            ctx.fillRect(x, y - th - 2, tw, th + 2);

            // Vẽ chữ label
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(labelText, x + 5, y - 5);
        });
    }, []);

    // RAF loop chính — đọc video.currentTime trực tiếp, không qua React state
    useEffect(() => {
        if (!enabled) {
            cancelAnimationFrame(rafRef.current);
            emptyFrameCountRef.current = 0;
            lastBoxesRef.current = [];
            const canvas = canvasRef.current;
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx?.clearRect(0, 0, canvas.width, canvas.height);
            }
            return;
        }

        const loop = () => {
            rafRef.current = requestAnimationFrame(loop);

            const video  = videoRef.current;
            const canvas = canvasRef.current;
            if (!video || !canvas) return;

            // Sync kích thước canvas với video element
            if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
                canvas.width  = video.clientWidth;
                canvas.height = video.clientHeight;
            }

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const currentMs = video.currentTime * 1000;
            const boxes     = findBoxes(currentMs);
            draw(ctx, canvas, video, boxes);
        };

        rafRef.current = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(rafRef.current);
    }, [enabled, videoRef, findBoxes, draw]);

    // ResizeObserver để canvas luôn khớp video
    useEffect(() => {
        const video  = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;

        const ro = new ResizeObserver(() => {
            canvas.width  = video.clientWidth;
            canvas.height = video.clientHeight;
        });
        ro.observe(video);

        canvas.width  = video.clientWidth;
        canvas.height = video.clientHeight;

        return () => ro.disconnect();
    }, [videoRef]);

    return (
        <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 w-full h-full pointer-events-none"
        />
    );
});

CanvasOverlay.displayName = 'CanvasOverlay';
