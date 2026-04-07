'use client';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CanvasOverlay } from '@/components/CanvasOverlay';
import { apiClient } from '@/app/api';
import { drawBoundingBoxes } from '@/lib/imageUtils';
import { Play, Pause, Upload, Image as ImageIcon, Video as VideoIcon } from 'lucide-react';
import { useRealtimeDetection } from '@/hooks/useRealtimeDetection';
import { useDetectionData } from '@/hooks/useDetectionData';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
const BACKEND_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, '');

export default function Home() {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [bboxImageUrl, setBboxImageUrl] = useState<string | null>(null);
    const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [videoId, setVideoId] = useState<string>('');
    const [isPlaying, setIsPlaying] = useState(false);
    const [videoDuration, setVideoDuration] = useState(0);

    const videoRef      = useRef<HTMLVideoElement>(null);
    const previewUrlRef = useRef<string | null>(null);
    const seekRef       = useRef<HTMLInputElement>(null);
    const previewUrlForDetectRef = useRef<string | null>(null);

    // Scan-first: poll status → load detections.json
    const {
        status: scanStatus,
        scanProgress,
        violationFrames,
        detectionMap,
        reset: resetDetectionData,
    } = useDetectionData(videoId);

    const scanDone = scanStatus === 'completed';

    // Image detection store
    const { setSingleDetection, detectionResults: imageDetectionResults } = useRealtimeDetection({
        videoRef,
        videoId: '',
        enabled: false,
    });

    // Cleanup object URL on unmount
    useEffect(() => {
        return () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); };
    }, []);

    // Sync seek bar (uncontrolled — no re-render)
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onTimeUpdate = () => {
            if (seekRef.current) seekRef.current.value = String(video.currentTime * 1000);
        };
        video.addEventListener('timeupdate', onTimeUpdate);
        return () => video.removeEventListener('timeupdate', onTimeUpdate);
    }, []);

    // Image detection
    const detectImage = useCallback(async (file: File) => {
        setIsProcessing(true);
        setBboxImageUrl(null);
        try {
            const result = await apiClient.detectImage(file);
            if (result.detections?.length > 0) {
                setSingleDetection(0, result.detections);
                const url = previewUrlForDetectRef.current;
                if (url) {
                    const withBoxes = await drawBoundingBoxes(url, result.detections);
                    setBboxImageUrl(withBoxes);
                }
            }
        } catch (e) {
            console.error('Detection error:', e);
        } finally {
            setIsProcessing(false);
        }
    }, [setSingleDetection]);

    // File upload
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Reset everything
        resetDetectionData();
        if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0; }
        setIsPlaying(false);
        setVideoId('');
        if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }

        const url = URL.createObjectURL(file);
        previewUrlRef.current = url;
        setSelectedFile(file);
        setPreviewUrl(url);
        previewUrlForDetectRef.current = url;
        setBboxImageUrl(null);
        setVideoDuration(0);

        const type = file.type.startsWith('image/') ? 'image' : 'video';
        setMediaType(type);
        if (type === 'video' && videoRef.current) videoRef.current.src = url;

        const newVideoId = type === 'video' ? Date.now().toString() : '';

        try {
            await apiClient.uploadFile(file, newVideoId);
            // Upload done → set videoId → useDetectionData starts polling
            if (type === 'video') setVideoId(newVideoId);
        } catch (err) {
            console.error('Upload error:', err);
        }
    };

    const imageDetectionList = useMemo(() => {
        return Array.from(imageDetectionResults.entries())
            .filter(([, boxes]) => boxes.length > 0)
            .map(([ts, boxes]) => ({ ts, count: boxes.length }));
    }, [imageDetectionResults]);

    return (
        <div className="min-h-screen bg-slate-50 p-6">
            <div className="max-w-7xl mx-auto space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

                    {/* Left: Upload + status */}
                    <div className="lg:col-span-1 space-y-6">
                        <Card className="shadow-sm">
                            <CardHeader>
                                <CardTitle className="text-sm font-semibold">Cài đặt phân tích</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-xl cursor-pointer hover:bg-slate-100 transition-colors border-slate-200">
                                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                        <Upload className="w-8 h-8 mb-3 text-slate-400" />
                                        <p className="text-xs text-slate-500 font-medium">Click để tải lên tệp</p>
                                    </div>
                                    <input type="file" className="hidden" accept="image/*,video/*" onChange={handleFileChange} />
                                </label>

                                {selectedFile && (
                                    <div className="p-3 bg-slate-100 rounded-lg flex items-center gap-3">
                                        {mediaType === 'image' ? <ImageIcon size={18} /> : <VideoIcon size={18} />}
                                        <span className="text-xs font-medium truncate flex-1">{selectedFile.name}</span>
                                    </div>
                                )}

                                {/* Image: detect button */}
                                {mediaType === 'image' && (
                                    <Button
                                        className="w-full h-11"
                                        disabled={!selectedFile || isProcessing}
                                        onClick={() => selectedFile && detectImage(selectedFile)}
                                    >
                                        {isProcessing ? 'Đang phân tích...' : 'Bắt đầu phát hiện'}
                                    </Button>
                                )}

                                {/* Video: scan status */}
                                {mediaType === 'video' && videoId && (
                                    <div className="mt-2">
                                        {!scanDone ? (
                                            <div>
                                                <div className="flex justify-between text-xs text-slate-500 mb-1">
                                                    <span>Đang quét vi phạm...</span>
                                                    <span>{scanProgress}%</span>
                                                </div>
                                                <div className="w-full bg-slate-100 rounded-full h-1.5">
                                                    <div
                                                        className="bg-primary h-1.5 rounded-full transition-all duration-300"
                                                        style={{ width: `${scanProgress}%` }}
                                                    />
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-xs text-green-600 font-medium text-center">
                                                ✓ Hoàn tất — {violationFrames.length} vi phạm
                                            </p>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Right: Video player */}
                    <div className="lg:col-span-3">
                        <Card className="overflow-hidden shadow-sm border-0">
                            <div className="relative bg-white w-full h-[500px] flex items-center justify-center">
                                {previewUrl ? (
                                    <>
                                        {mediaType === 'video' ? (
                                            <video
                                                ref={videoRef}
                                                src={previewUrl}
                                                className="w-full h-full object-contain"
                                                crossOrigin="anonymous"
                                                onPlay={() => setIsPlaying(true)}
                                                onPause={() => setIsPlaying(false)}
                                                onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration * 1000)}
                                            />
                                        ) : (
                                            <div className="relative w-full h-full flex items-center justify-center bg-black">
                                                <img
                                                    src={bboxImageUrl || previewUrl}
                                                    className="max-w-full max-h-full object-contain"
                                                    alt="Preview"
                                                />
                                            </div>
                                        )}

                                        {mediaType === 'video' && (
                                            <CanvasOverlay
                                                videoRef={videoRef}
                                                detectionResults={detectionMap}
                                                enabled={isPlaying && scanDone}
                                            />
                                        )}
                                    </>
                                ) : (
                                    <div className="text-slate-500 flex flex-col items-center gap-2">
                                        <VideoIcon size={48} className="opacity-20" />
                                        <p className="text-sm">Chưa chọn nội dung phân tích</p>
                                    </div>
                                )}
                            </div>

                            {mediaType === 'video' && (
                                <div className="p-4 bg-white border-t space-y-3">
                                    <input
                                        type="range"
                                        min="0"
                                        max={videoDuration}
                                        defaultValue={0}
                                        ref={seekRef}
                                        className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-primary"
                                        onChange={(e) => {
                                            const val = Number(e.target.value);
                                            if (videoRef.current) videoRef.current.currentTime = val / 1000;
                                        }}
                                    />
                                    <div className="flex items-center gap-3">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => isPlaying ? videoRef.current?.pause() : videoRef.current?.play()}
                                        >
                                            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                                        </Button>
                                        <span className="text-xs font-mono text-slate-500">
                                            {(videoDuration / 1000).toFixed(1)}s
                                        </span>
                                    </div>
                                </div>
                            )}
                        </Card>
                    </div>
                </div>

                {/* Violation list */}
                <Card className="shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2">
                            Kết quả phát hiện vi phạm
                            <span className="bg-red-100 text-red-600 px-2 py-0.5 rounded-full text-[10px]">
                                {mediaType === 'video' ? violationFrames.length : imageDetectionList.length} Frames
                            </span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {mediaType === 'video' && !scanDone ? (
                            <div className="h-32 flex items-center justify-center border-2 border-dashed rounded-lg text-slate-400 text-sm">
                                {videoId ? 'Đang quét vi phạm...' : 'Chưa chọn video'}
                            </div>
                        ) : (mediaType === 'video' ? violationFrames.length > 0 : imageDetectionList.length > 0) ? (
                            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
                                {mediaType === 'video' ? (
                                    violationFrames.map((frame) => (
                                        <div
                                            key={frame.frame_number}
                                            className="group relative border rounded-lg overflow-hidden hover:ring-2 hover:ring-primary transition-all cursor-pointer"
                                            onClick={() => {
                                                if (videoRef.current) videoRef.current.currentTime = frame.timestamp / 1000;
                                            }}
                                        >
                                            <div className="aspect-video bg-slate-200 relative overflow-hidden">
                                                <img
                                                    src={`${BACKEND_BASE_URL}${frame.image_path}`}
                                                    alt={`Violation frame ${frame.frame_number}`}
                                                    className="w-full h-full object-cover"
                                                />
                                                <div className="absolute top-1 right-1 bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-md font-bold">
                                                    {frame.detections?.length || 0}
                                                </div>
                                            </div>
                                            <div className="p-1.5 bg-white text-center">
                                                <p className="text-[10px] font-medium text-slate-600">{(frame.timestamp / 1000).toFixed(1)}s</p>
                                                <p className="text-[9px] text-slate-400 truncate">
                                                    {frame.detections?.map(d => d.label).join(', ')}
                                                </p>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    imageDetectionList.map((frame) => (
                                        <div key={frame.ts} className="group relative border rounded-lg overflow-hidden">
                                            <div className="aspect-video bg-slate-200 flex items-center justify-center relative">
                                                <ImageIcon size={16} className="text-slate-400" />
                                                <div className="absolute top-1 right-1 bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-md font-bold">
                                                    {frame.count}
                                                </div>
                                            </div>
                                            <div className="p-1.5 bg-white text-center">
                                                <p className="text-[10px] font-medium text-slate-600">{(frame.ts / 1000).toFixed(1)}s</p>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        ) : (
                            <div className="h-32 flex items-center justify-center border-2 border-dashed rounded-lg text-slate-400 text-sm">
                                Chưa có dữ liệu vi phạm được phát hiện
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
