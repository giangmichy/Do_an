'use client';
import React, {useState, useEffect, useCallback, useRef, useMemo} from 'react';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {CanvasOverlay} from '@/components/CanvasOverlay';
import {apiClient} from '@/app/api';
import {drawBoundingBoxes} from '@/lib/imageUtils';
import {Play, Pause, Upload, Scan, Image as ImageIcon, Video as VideoIcon} from 'lucide-react';
import {BoundingBox, useRealtimeDetection} from '@/hooks/useRealtimeDetection';
import {useViolationSSE} from '@/hooks/useViolationSSE';

type ViolationFrame = {
    frame_number: number;
    timestamp: number;
    image_path: string;
    detections: BoundingBox[];
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
const BACKEND_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, '');

export default function Home() {
    // --- STATE ---
    const [isProcessing, setIsProcessing] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [bboxImageUrl, setBboxImageUrl] = useState<string | null>(null);
    const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null);
    const [isDetecting, setIsDetecting] = useState(false);
    const [videoId, setVideoId] = useState<string>('');
    const [uploadDone, setUploadDone] = useState(false);
    const [scanReady, setScanReady] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [videoDuration, setVideoDuration] = useState(0);

    // --- REFS ---
    const videoRef      = useRef<HTMLVideoElement>(null);
    const previewUrlRef = useRef<string | null>(null);
    const seekRef       = useRef<HTMLInputElement>(null);
    const previewUrlForDetectRef = useRef<string | null>(null);

    // --- DETECTION HOOKS ---
    const {
        detectionResults,
        appendDetectionResult,
        resetDetections,
        setSingleDetection,
    } = useRealtimeDetection({
        videoRef,
        videoId,
        enabled: mediaType === 'video' && isPlaying && isDetecting,
    });

    const handleViolation = useCallback(
        (violation: ViolationFrame) => {
            appendDetectionResult(violation.timestamp, violation.detections || []);
        },
        [appendDetectionResult],
    );

    const {violationFrames, resetViolations, scanProgress, scanDone} = useViolationSSE({
        videoId,
        enabled: mediaType === 'video' && !!videoId && uploadDone,
        onViolation: handleViolation,
    });

    // --- RESET ---
    const resetDetectionState = useCallback(() => {
        resetDetections();
        resetViolations();
        setVideoDuration(0);
    }, [resetDetections, resetViolations]);

    // Mở khóa nút khi quét xong
    useEffect(() => {
        if (scanDone) setScanReady(true);
    }, [scanDone]);

    // Cleanup object URL khi unmount
    useEffect(() => {
        return () => {
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        };
    }, []);

    // Sync thanh seek theo video (không trigger re-render)
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onTimeUpdate = () => {
            if (seekRef.current) seekRef.current.value = String(video.currentTime * 1000);
        };
        video.addEventListener('timeupdate', onTimeUpdate);
        return () => video.removeEventListener('timeupdate', onTimeUpdate);
    }, []);

    // --- IMAGE DETECTION ---
    const detectImage = useCallback(async (file: File) => {
        setIsProcessing(true);
        setBboxImageUrl(null);
        try {
            const result = await apiClient.detectImage(file);
            if (result.detections && result.detections.length > 0) {
                setSingleDetection(0, result.detections);
                const currentPreviewUrl = previewUrlForDetectRef.current;
                if (currentPreviewUrl) {
                    const imageWithBoxes = await drawBoundingBoxes(currentPreviewUrl, result.detections);
                    setBboxImageUrl(imageWithBoxes);
                }
            }
        } catch (error) {
            console.error('Detection error:', error);
        } finally {
            setIsProcessing(false);
        }
    }, [setSingleDetection]);

    // --- FILE UPLOAD ---
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Dừng pipeline cũ
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.currentTime = 0;
        }
        setIsPlaying(false);
        setIsDetecting(false);
        setVideoId('');
        setUploadDone(false);
        setScanReady(false);

        if (previewUrlRef.current) {
            URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = null;
        }

        const url = URL.createObjectURL(file);
        previewUrlRef.current = url;

        setSelectedFile(file);
        setPreviewUrl(url);
        previewUrlForDetectRef.current = url;
        setBboxImageUrl(null);
        resetDetectionState();

        const type = file.type.startsWith('image/') ? 'image' : 'video';
        setMediaType(type);
        if (type === 'image') setIsDetecting(true);
        if (type === 'video' && videoRef.current) videoRef.current.src = url;

        const newVideoId = type === 'video' ? Date.now().toString() : '';
        // Không set videoId ngay — chờ upload xong mới bật SSE

        try {
            await apiClient.uploadFile(file, newVideoId);
            // Upload xong → set videoId để SSE tự mở
            setVideoId(newVideoId);
            setUploadDone(true);
        } catch (error) {
            console.error('File upload error:', error);
        }
    };

    // --- DETECTION FRAMES LIST (chỉ dùng cho ảnh) ---
    const detectionFramesList = useMemo(() => {
        return Array.from(detectionResults.entries())
            .filter(([, boxes]) => boxes.length > 0)
            .map(([ts, boxes]) => ({ts, count: boxes.length}));
    }, [detectionResults]);

    return (
        <div className="min-h-screen bg-slate-50 p-6">
            <div className="max-w-7xl mx-auto space-y-6">

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

                    {/* Cột trái: Upload & Detect */}
                    <div className="lg:col-span-1 space-y-6">
                        <Card className="shadow-sm">
                            <CardHeader>
                                <CardTitle className="text-sm font-semibold">Cài đặt phân tích</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-xl cursor-pointer hover:bg-slate-100 transition-colors border-slate-200">
                                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                        <Upload className="w-8 h-8 mb-3 text-slate-400"/>
                                        <p className="text-xs text-slate-500 font-medium">Click để tải lên tệp</p>
                                    </div>
                                    <input type="file" className="hidden" accept="image/*,video/*" onChange={handleFileChange}/>
                                </label>

                                {selectedFile && (
                                    <div className="p-3 bg-slate-100 rounded-lg flex items-center gap-3">
                                        {mediaType === 'image' ? <ImageIcon size={18}/> : <VideoIcon size={18}/>}
                                        <span className="text-xs font-medium truncate flex-1">{selectedFile.name}</span>
                                    </div>
                                )}

                                <Button
                                    className="w-full h-11"
                                    disabled={
                                        !selectedFile ||
                                        isProcessing ||
                                        (mediaType === 'video' && !scanReady)
                                    }
                                    onClick={() => {
                                        if (mediaType === 'image' && selectedFile) {
                                            detectImage(selectedFile);
                                        } else if (mediaType === 'video') {
                                            const next = !isDetecting;
                                            setIsDetecting(next);
                                            if (next) {
                                                videoRef.current?.play();
                                            } else {
                                                videoRef.current?.pause();
                                            }
                                        }
                                    }}
                                >
                                    <Scan size={18} className={`mr-2 ${isProcessing ? 'animate-spin' : ''}`}/>
                                    {mediaType === 'video'
                                        ? (isDetecting ? 'Tạm dừng' : 'Xem phát hiện')
                                        : (isProcessing ? 'Đang phân tích...' : 'Bắt đầu phát hiện')}
                                </Button>

                                {mediaType === 'video' && videoId && (
                                    <div className="mt-2">
                                        {!scanDone ? (
                                            <div>
                                                <div className="flex justify-between text-xs text-slate-500 mb-1">
                                                    <span>Đang xử lý video...</span>
                                                    <span>{scanProgress}%</span>
                                                </div>
                                                <div className="w-full bg-slate-100 rounded-full h-1.5">
                                                    <div
                                                        className="bg-primary h-1.5 rounded-full transition-all duration-300"
                                                        style={{width: `${scanProgress}%`}}
                                                    />
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-xs text-green-600 font-medium text-center">
                                                ✓ Sẵn sàng — Bấm &quot;Xem phát hiện&quot; để bắt đầu
                                            </p>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Cột phải: Video Player */}
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

                                        {/* CanvasOverlay: tự đọc video.currentTime qua RAF, không qua React state */}
                                        {mediaType === 'video' && (
                                            <CanvasOverlay
                                                videoRef={videoRef}
                                                detectionResults={detectionResults}
                                                enabled={isDetecting}
                                            />
                                        )}
                                    </>
                                ) : (
                                    <div className="text-slate-500 flex flex-col items-center gap-2">
                                        <VideoIcon size={48} className="opacity-20"/>
                                        <p className="text-sm">Chưa chọn nội dung phân tích</p>
                                    </div>
                                )}
                            </div>

                            {mediaType === 'video' && (
                                <div className="p-4 bg-white border-t space-y-3">
                                    {/* Thanh seek — uncontrolled, cập nhật qua timeupdate event */}
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
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => isPlaying ? videoRef.current?.pause() : videoRef.current?.play()}
                                            >
                                                {isPlaying ? <Pause size={20}/> : <Play size={20}/>}
                                            </Button>
                                            <span className="text-xs font-mono text-slate-500">
                                                {(videoDuration / 1000).toFixed(1)}s
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </Card>
                    </div>
                </div>

                {/* Card dưới: Kết quả phát hiện */}
                <Card className="shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2">
                            Kết quả phát hiện vi phạm
                            <span className="bg-red-100 text-red-600 px-2 py-0.5 rounded-full text-[10px]">
                                {(mediaType === 'video' ? violationFrames.length : detectionFramesList.length)} Frames
                            </span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {(mediaType === 'video' ? violationFrames.length > 0 : detectionFramesList.length > 0) ? (
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
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    detectionFramesList.map((frame) => (
                                        <div
                                            key={frame.ts}
                                            className="group relative border rounded-lg overflow-hidden hover:ring-2 hover:ring-primary transition-all cursor-pointer"
                                        >
                                            <div className="aspect-video bg-slate-200 flex items-center justify-center relative">
                                                <ImageIcon size={16} className="text-slate-400"/>
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
