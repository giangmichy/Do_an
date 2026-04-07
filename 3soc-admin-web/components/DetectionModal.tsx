'use client';

import {useState, useEffect} from 'react';
import {DetectionResponse, DetectionBox} from '@/app/api';

import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {X} from 'lucide-react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
const BACKEND_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, '');

const toAbsoluteUrl = (path?: string) => {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return `${BACKEND_BASE_URL}${path}`;
};

const getViolationImagePath = (v: any) => {
    return toAbsoluteUrl(v?.image_path || v?.imagePath || '');
};

const mapLabelModelToDisplayName = (model: string) => {
    const mapping: Record<string, string> = {
        'co3soc': 'Cờ 3 sọc',
        'duongluoibo': 'Đường lưỡi bò',
        'vnmap': 'Bản đồ Việt Nam'
    };
    return mapping[model] || model;
};

const DetectionModal = ({open, onOpenChange, data, fileName}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    data: DetectionResponse | null;
    fileName: string;
}) => {
    const [selectedViolation, setSelectedViolation] = useState<any>(null);

    useEffect(() => {
        if (!open || !data) {
            setSelectedViolation(null);
        }
    }, [open, data]);

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="w-[70vw] h-[85vh] max-w-none sm:max-w-none p-0 flex flex-col">
                    <DialogHeader className="shrink-0 border-b pb-4 px-6 pt-6">
                        <DialogTitle>Kết quả phát hiện ({fileName || '—'})</DialogTitle>
                    </DialogHeader>
                    <div className="overflow-y-auto flex-1 px-6 py-4">
                        {data ? (
                            <div className="space-y-3">
                                {/* Summary Stats */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="p-3 rounded-lg bg-muted">
                                        <p className="text-xs text-muted-foreground">Ảnh vi phạm</p>
                                        <p className="text-2xl font-bold text-red-600">{data.violation_count}</p>
                                    </div>
                                    <div className="p-3 rounded-lg bg-muted">
                                        <p className="text-xs text-muted-foreground">Ảnh đã xử lý</p>
                                        <p className="text-2xl font-bold">{data.processed_frames}</p>
                                    </div>
                                </div>

                                {/* Violation Images Grid */}
                                {data && data.violation_count !== undefined && data.violation_count > 0 ? (
                                    <div>
                                        <h3 className="text-sm font-semibold mb-3">Ảnh vi phạm ({data.violations.length})</h3>
                                        <div className="grid grid-cols-6 gap-3 max-h-[500px] overflow-y-auto border rounded-lg p-3 bg-muted/50">
                                            {data.violations.map((v, idx) => (
                                                <div
                                                    key={idx}
                                                    className="cursor-pointer rounded-lg overflow-hidden border hover:border-primary transition-colors group"
                                                    onClick={() => setSelectedViolation(v)}
                                                >
                                                    <div className="relative w-full aspect-video bg-black">
                                                        <img
                                                            src={getViolationImagePath(v)}
                                                            alt={`Frame ${v.frame_number}`}
                                                            className="w-full h-full object-cover group-hover:opacity-75 transition-opacity"
                                                        />
                                                        <div className="absolute top-1 right-1 bg-red-600 text-white text-xs px-2 py-1 rounded font-semibold">
                                                            {v.detections.length}
                                                        </div>
                                                        <div className="absolute bottom-1 left-1 bg-black/70 text-white text-xs px-2 py-1 rounded">
                                                            {(v.timestamp / 1000).toFixed(2)}s
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="p-8 rounded-lg bg-muted text-center text-muted-foreground">
                                        <p className="text-base">✓ Không phát hiện vi phạm</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full space-y-4">
                                <div className="w-12 h-12 rounded-full border-4 border-muted border-t-primary animate-spin"/>
                                <p className="text-sm text-muted-foreground">Đang xử lý detection...</p>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Violation Detail Popup */}
            <Dialog open={!!selectedViolation} onOpenChange={(v) => { if (!v) setSelectedViolation(null); }}>
                <DialogContent className="w-[60vw] max-w-none sm:max-w-none p-0 flex flex-col">
                    <DialogHeader className="shrink-0 border-b pb-3 px-6 pt-5">
                        <DialogTitle className="text-sm">
                            Chi tiết vi phạm — {selectedViolation ? `${(selectedViolation.timestamp / 1000).toFixed(2)}s` : ''}
                        </DialogTitle>
                    </DialogHeader>
                    {selectedViolation && (
                        <div className="p-6">
                            <div className="grid grid-cols-5 gap-4">
                                <div className="col-span-3">
                                    <ViolationImageViewer
                                        imagePath={getViolationImagePath(selectedViolation)}
                                        detections={selectedViolation.detections}
                                    />
                                </div>
                                <div className="col-span-2 space-y-3">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="p-3 rounded-lg bg-muted">
                                            <p className="text-xs text-muted-foreground mb-2">Số phát hiện</p>
                                            <p className="text-2xl font-bold text-red-600">{selectedViolation.detections.length}</p>
                                        </div>
                                        <div className="p-3 rounded-lg bg-muted">
                                            <p className="text-xs text-muted-foreground">Thời gian</p>
                                            <p className="text-xl font-bold">{(selectedViolation.timestamp / 1000).toFixed(2)}s</p>
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-xs font-semibold mb-2">Chi tiết phát hiện</p>
                                        <div className="max-h-48 overflow-y-auto bg-muted rounded p-2 border">
                                            {selectedViolation.detections.length === 0 ? (
                                                <p className="text-xs text-muted-foreground text-center py-4">Không có chi tiết</p>
                                            ) : (
                                                <table className="w-full text-xs">
                                                    <thead className="border-b sticky top-0 bg-muted">
                                                    <tr>
                                                        <th className="text-left p-1 font-semibold">Nhãn</th>
                                                        <th className="text-left p-1 font-semibold">Độ chính xác</th>
                                                    </tr>
                                                    </thead>
                                                    <tbody>
                                                    {selectedViolation.detections.map((d: any, i: number) => (
                                                        <tr key={i} className="border-b last:border-0 hover:bg-muted/80">
                                                            <td className="p-1 font-medium">{mapLabelModelToDisplayName(d.label)}</td>
                                                            <td className="p-1 text-muted-foreground">{(d.confidence * 100)?.toFixed(3)}%</td>
                                                        </tr>
                                                    ))}
                                                    </tbody>
                                                </table>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}


export default DetectionModal


// Component to display violation image with bounding boxes
function ViolationImageViewer({imagePath, detections}: { imagePath: string; detections: DetectionBox[] }) {
    const [bboxImage, setBboxImage] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    console.log('[ViolationImageViewer] Props:', {imagePath, detections});
    useEffect(() => {
        const drawBoxes = async () => {
            setLoading(true);
            try {
                const result = await drawBboxOnImage(imagePath, detections);
                setBboxImage(result);
            } catch (e) {
                console.error('Error drawing bboxes:', e);
                setBboxImage(imagePath); // Fallback to original
            }
            setLoading(false);
        };

        if (detections && detections.length > 0) {
            drawBoxes();
        } else {
            setBboxImage(imagePath);
            setLoading(false);
        }
    }, [imagePath, detections]);

    if (loading) {
        return <div className="w-full h-96 rounded-lg bg-muted animate-pulse"/>;
    }

    return (
        <img
            src={bboxImage || imagePath}
            alt="violation with bbox"
            className="w-full rounded-lg max-h-96 object-contain border"
        />
    );
}


// Function to draw bounding boxes on canvas
const drawBboxOnImage = async (imagePath: string, detections: DetectionBox[]): Promise<string> => {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');

            // Draw image
            ctx?.drawImage(img, 0, 0);

            // Draw bounding boxes
            if (ctx && detections && detections.length > 0) {
                const colors = {
                    'co3soc': '#FF0000',      // Red (đỏ)
                    'duongluoibo': '#00FF00',  // Green (xanh lá)
                    'vnmap': '#0000FF',
                };

                detections.forEach((det: any) => {
                    const label = det.label || det.model || 'object';
                    const score = det.confidence ?? det.score ?? 0;
                    const color = colors[label as keyof typeof colors] || '#FFFFFF';
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;
                    ctx.font = 'bold 12px Arial';
                    ctx.fillStyle = color;

                    // Support both xyxy and xywh payloads
                    const x1 = det.x1 ?? det.x ?? 0;
                    const y1 = det.y1 ?? det.y ?? 0;
                    const x2 = det.x2 ?? ((det.x ?? 0) + (det.width ?? 0));
                    const y2 = det.y2 ?? ((det.y ?? 0) + (det.height ?? 0));
                    const width = Math.max(0, x2 - x1);
                    const height = Math.max(0, y2 - y1);

                    if (width <= 0 || height <= 0) {
                        return;
                    }

                    ctx.strokeRect(x1, y1, width, height);

                    // Draw label
                    const labelText = `${label} ${(score * 100).toFixed(0)}%`;
                    ctx.fillRect(x1, y1 - 20, ctx.measureText(labelText).width + 4, 20);
                    ctx.fillStyle = '#000000';
                    ctx.fillText(labelText, x1 + 2, y1 - 5);
                });
            }

            resolve(canvas.toDataURL('image/jpeg'));
        };
        img.onerror = () => resolve(imagePath);
        img.src = imagePath;
    });
};
