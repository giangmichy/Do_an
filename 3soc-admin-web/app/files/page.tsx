'use client';

import React, {useState, useEffect} from 'react';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {apiClient, VideoFile, DetectionResponse, SortOrder} from '@/app/api';
import {FileVideo, Image as ImageIcon, Trash2, Eye, Scan} from 'lucide-react';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {useToast} from '@/hooks/use-toast';
import DetectionModal from '@/components/DetectionModal';
import { escapeHtml } from '@/lib/escapeHtml';
import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious
} from '@/components/ui/pagination';
import { useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';


export default function FilesPage() {
    const {toast} = useToast();
    const [files, setFiles] = useState<VideoFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [detecting, setDetecting] = useState(false);
    const [resultModalOpen, setResultModalOpen] = useState(false);
    const [detectionResult, setDetectionResult] = useState<DetectionResponse | null>(null);
    const [currentFileName, setCurrentFileName] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize] = useState(10);
    const [totalPages, setTotalPages] = useState(0);
    const [totalFiles, setTotalFiles] = useState(0);
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [fileToDelete, setFileToDelete] = useState<{id: string, filename: string} | null>(null);
    const { isAdmin } = useAuth();
    useEffect(() => {
        loadFiles(page);
    }, [page, sortOrder]);

    const loadFiles = async (targetPage = page) => {
        try {
            setLoading(true);
            const data = await apiClient.getFiles({page: targetPage, pageSize, sortOrder});

            // If current page becomes invalid after mutation (e.g., delete), move to last valid page.
            if (data.meta.total_pages > 0 && targetPage > data.meta.total_pages) {
                setPage(data.meta.total_pages);
                return;
            }

            setFiles(data.items);
            setTotalPages(data.meta.total_pages);
            setTotalFiles(data.meta.total);
            setError('');
        } catch (err: any) {
            setError(err.message || 'Failed to load files');
        } finally {
            setLoading(false);
        }
    };

    const handleDetect = async (file: VideoFile) => {
        try {
            setDetecting(true);
            setError('');
            setDetectionResult(null);
            setCurrentFileName(file.filename);
            setResultModalOpen(true); // Open modal immediately

            if (file.type === 'image') {
                const imageResult = await apiClient.detectSavedImage(file.id);
                setDetectionResult({
                    media_type: 'image',
                    detection_id: imageResult.file_id,
                    total_frames: 1,
                    processed_frames: 1,
                    violation_count: imageResult.violation?.detections?.length ? 1 : 0,
                    violations: imageResult.violation ? [imageResult.violation] : [],
                    cached: imageResult.cached,
                });
                setDetecting(false);
                return;
            }

            const eventSource = new EventSource(
                `http://localhost:8000/api/files/${file.id}/detect-stream?token=${encodeURIComponent(localStorage.getItem('access_token') || '')}`
            );

            let violations: any[] = [];

            eventSource.addEventListener('message', (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    console.log("SSE RAW:", event.data);
                    if (msg.type === 'violation') {
                        violations.push(msg.data);
                        setDetectionResult((prev) => {
                            if (!prev) return prev;
                            const processed = Math.max(prev.processed_frames || 0, msg.data?.frame_number || 0);
                            return {
                                ...prev,
                                violations,
                                violation_count: violations.length,
                                processed_frames: processed,
                            };
                        });
                    } else if (msg.type === 'complete') {
                        eventSource.close();
                        setDetecting(false);
                    } else if (msg.type === 'metadata') {
                        setDetectionResult({
                            media_type: 'video',
                            detection_id: msg.detection_id || '',
                            total_frames: msg.total_frames || 0,
                            processed_frames: msg.processed_frames || 0,
                            violation_count: 0,
                            violations: [],
                            cached: false,
                        });
                    } else if (msg.type === 'init') {
                        setDetectionResult({
                            media_type: 'video',
                            detection_id: msg.detection_id || '',
                            total_frames: msg.total_frames || 0,
                            processed_frames: 0,
                            violation_count: 0,
                            violations: [],
                            cached: false,
                        });
                    }
                } catch (e) {
                    console.error('Error parsing SSE message:', e);
                }
            });

            eventSource.addEventListener('error', () => {
                eventSource.close();
                setDetecting(false);
                setError('Stream connection error');
            });
            // }
        } catch (err: any) {
            setError(err.message || 'Detection failed');
            setDetecting(false);
        }
    };

    const handleDelete = async (id: string, filename: string) => {
        setFileToDelete({id, filename});
        setDeleteDialogOpen(true);
    };

    const confirmDelete = async () => {
        if (!fileToDelete) return;

        try {
            await apiClient.deleteFile(fileToDelete.id);
            setDeleteDialogOpen(false);
            loadFiles(page);
            setError('');
        } catch (err: any) {
            const errorMsg = err.message || 'Failed to delete file';
            setError(errorMsg);
            setDeleteDialogOpen(false);
        }
    };

    const formatFileSize = (bytes?: number) => {
        if (!bytes) return 'N/A';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
    };

    const formatDuration = (seconds?: number) => {
        if (!seconds) return 'N/A';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        if (mins === 0) {
            return `${secs}s`;
        }
        return `${mins}p ${secs}s`;
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('vi-VN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    };


    const visiblePages = (() => {
        if (totalPages <= 5) {
            return Array.from({length: totalPages}, (_, i) => i + 1);
        }

        const start = Math.max(1, page - 2);
        const end = Math.min(totalPages, start + 4);
        return Array.from({length: end - start + 1}, (_, i) => start + i);
    })();

    return (
        <ProtectedRoute>
            <div className="min-h-screen bg-background p-6">
                <div className="max-w-7xl mx-auto">
                    <div className="mb-8">
                        <div className="flex items-center gap-3 mb-2">
                            <FileVideo className="text-primary" size={32}/>
                            <h1 className="text-3xl font-bold">Quản lý file</h1>
                        </div>
                        <p className="text-muted-foreground">Danh sách file đã tải lên</p>
                    </div>

                    {error && (
                        <Alert variant="destructive" className="mb-4">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    <Card>
                        <CardContent>
                            {loading ? (
                                <div className="text-center py-8 text-muted-foreground">Loading...</div>
                            ) : files.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground">No files found</div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                        <tr className="border-b">
                                            <th className="text-left p-4">STT</th>
                                            <th className="text-left p-4">Tên</th>
                                            <th className="text-left p-4">Kích thước</th>
                                            <th className="text-left p-4">Thời gian</th>
                                            <th className="text-left p-4">Người tạo</th>
                                            <th className="text-left p-4">Thời gian tạo</th>
                                            <th className="text-right p-4">Thao tác</th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {files.map((file, index) => (
                                            <tr key={file.id} className="border-b hover:bg-muted/50">
                                                <td className="p-4">{(page - 1) * pageSize + index + 1}</td>
                                                <td className="p-4">
                                                    <div className="flex items-center gap-2">
                                                        {file.type === 'image' ? (
                                                            <ImageIcon size={16} className="text-muted-foreground"/>
                                                        ) : (
                                                            <FileVideo size={16} className="text-muted-foreground"/>
                                                        )}
                                                        <span className="font-medium">{escapeHtml(file.filename)}</span>
                                                    </div>
                                                </td>
                                                <td className="p-4 text-sm text-muted-foreground">{formatFileSize(file.file_size)}</td>
                                                <td className="p-4 text-sm text-muted-foreground">{formatDuration(file.duration)}</td>
                                                <td className="p-4 text-sm font-medium">
                                                    {file.owner ? escapeHtml(file.owner.username) : 'N/A'}
                                                </td>
                                                <td className="p-4 text-sm text-muted-foreground">{formatDate(file.created_at)}</td>
                                                <td className="p-4">
                                                    <div className="flex gap-2 justify-end">
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => window.open(file.filepath, '_blank')}
                                                        >
                                                            <Eye size={14}/>
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => handleDetect(file)}
                                                            disabled={detecting}
                                                        >
                                                            <Scan size={14}/>
                                                        </Button>
                                                       {isAdmin && (
                                                        <Button size="sm" variant="destructive"
                                                                onClick={() => handleDelete(file.id, file.filename)}>
                                                            <Trash2 size={14}/>
                                                        </Button>)}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table>

                                    <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                                            <p className="text-sm text-muted-foreground">
                                                Tổng {totalFiles} file
                                            </p>
                                            <select
                                                value={sortOrder}
                                                onChange={(e) => {
                                                    setSortOrder(e.target.value as SortOrder);
                                                    setPage(1);
                                                }}
                                                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                                            >
                                                <option value="desc">Mới nhất</option>
                                                <option value="asc">Cũ nhất</option>
                                            </select>
                                        </div>

                                        <Pagination className="mx-0 w-auto justify-end">
                                            <PaginationContent>
                                                <PaginationItem>
                                                    <PaginationPrevious
                                                        href="#"
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            if (page > 1) {
                                                                setPage(page - 1);
                                                            }
                                                        }}
                                                        className={page <= 1 ? 'pointer-events-none opacity-50' : ''}
                                                    />
                                                </PaginationItem>

                                                {visiblePages.map((pageNum) => (
                                                    <PaginationItem key={pageNum}>
                                                        <PaginationLink
                                                            href="#"
                                                            isActive={pageNum === page}
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                setPage(pageNum);
                                                            }}
                                                        >
                                                            {pageNum}
                                                        </PaginationLink>
                                                    </PaginationItem>
                                                ))}

                                                <PaginationItem>
                                                    <PaginationNext
                                                        href="#"
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            if (page < totalPages) {
                                                                setPage(page + 1);
                                                            }
                                                        }}
                                                        className={page >= totalPages || totalPages === 0 ? 'pointer-events-none opacity-50' : ''}
                                                    />
                                                </PaginationItem>
                                            </PaginationContent>
                                        </Pagination>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                <DetectionModal
                    open={resultModalOpen}
                    onOpenChange={setResultModalOpen}
                    data={detectionResult}
                    fileName={currentFileName}
                />

                <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Xác nhận xóa tệp</AlertDialogTitle>
                            <AlertDialogDescription>
                                Bạn có chắc chắn muốn xóa tệp <span className="font-semibold">{fileToDelete?.filename}</span>? Hành động này không thể hoàn tác.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Hủy</AlertDialogCancel>
                            <AlertDialogAction onClick={confirmDelete} className="bg-destructive hover:bg-destructive/90">
                                Xóa
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </ProtectedRoute>
    );
}

