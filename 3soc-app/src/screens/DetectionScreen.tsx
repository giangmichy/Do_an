import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  FlatList,
  Modal,
  useWindowDimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../api';
import { BACKEND_BASE_URL } from '../config';
import BoundingBoxOverlay from '../components/BoundingBoxOverlay';
import { useRealtimeVideoDetection } from './detection/useRealtimeVideoDetection';
import type { MediaType, ViolationFrame } from './detection/types';

export default function DetectionScreen() {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const videoAreaHeight = screenHeight * 0.52;

  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<MediaType>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [videoId, setVideoId] = useState<string>('');
  const [uploadedFileId, setUploadedFileId] = useState<string>('');
  const [imageDetections, setImageDetections] = useState<any[]>([]);
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 });
  const [imageLayoutSize, setImageLayoutSize] = useState({ width: 0, height: 0 });
  const [videoLayoutSize, setVideoLayoutSize] = useState({ width: 0, height: 0 });
  const [videoNaturalSize, setVideoNaturalSize] = useState({ width: 0, height: 0 });
  const [currentPositionMs, setCurrentPositionMs] = useState(0);
  const currentPositionMsRef = useRef(0);
  const lastStatusTimeRef = useRef(0);
  const lastStatusPosRef = useRef(0);
  const [videoDurationMs, setVideoDurationMs] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenLayoutSize, setFullscreenLayoutSize] = useState({ width: 0, height: 0 });

  const videoRef = useRef<Video>(null);
  const lastRenderPosRef = useRef(0);

  useEffect(() => {
    if (!isVideoPlaying) return;
    // Poll position thật từ video element mỗi 50ms (giống web dùng video.currentTime)
    // Thay vì nội suy từ onPlaybackStatusUpdate (không ổn định, drift sau vài giây)
    let inFlight = false;
    const id = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      videoRef.current?.getStatusAsync().then((status) => {
        if (status && status.isLoaded) {
          const pos = status.positionMillis;
          currentPositionMsRef.current = pos;
          lastStatusPosRef.current = pos;
          lastStatusTimeRef.current = Date.now();
          if (pos - lastRenderPosRef.current >= 80) {
            lastRenderPosRef.current = pos;
            setCurrentPositionMs(pos);
          }
        }
        inFlight = false;
      }).catch(() => { inFlight = false; });
    }, 50);
    return () => clearInterval(id);
  }, [isVideoPlaying]);

  const {
    isDetecting,
    violationFrames,
    currentVideoBoxes,
    startVideoDetection,
    stopDetection,
    resetRealtimeState,
  } = useRealtimeVideoDetection({
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
  });

  const modelColorMap: Record<string, string> = {
    co3soc: '#ef4444',
    duongluoibo: '#22c55e',
    vnmap: '#3b82f6',
  };

  const modelNameMap: Record<string, string> = {
    co3soc: 'Cờ 3 sọc',
    duongluoibo: 'Đường lưỡi bò',
    vnmap: 'Bản đồ VN',
  };

  const detectImageBySource = useCallback(async (uri: string, name: string) => {
    setIsProcessing(true);
    setImageDetections([]);
    try {
      const result = await apiClient.detectImage(uri, name);
      if (result.detections && result.detections.length > 0) {
        setImageDetections(result.detections);
      } else {
        Alert.alert('Kết quả', 'Không phát hiện vi phạm nào');
      }
    } catch (err: any) {
      Alert.alert('Lỗi', err.message || 'Phát hiện thất bại');
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const clearMedia = () => {
    resetRealtimeState();
    setMediaUri(null);
    setMediaType(null);
    setFileName('');
    setImageDetections([]);
    setUploadedFileId('');
    setVideoId('');
    currentPositionMsRef.current = 0;
    lastStatusPosRef.current = 0;
    lastStatusTimeRef.current = 0;
    lastRenderPosRef.current = 0;
    setCurrentPositionMs(0);
    setVideoDurationMs(0);
    setImageNaturalSize({ width: 0, height: 0 });
    setVideoNaturalSize({ width: 0, height: 0 });
    setVideoLayoutSize({ width: 0, height: 0 });
    setImageLayoutSize({ width: 0, height: 0 });
  };

  const pickMedia = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const type: MediaType = asset.type === 'video' ? 'video' : 'image';
    const name = asset.fileName || `file_${Date.now()}.${type === 'video' ? 'mp4' : 'jpg'}`;

    resetRealtimeState();
    setImageDetections([]);
    setUploadedFileId('');
    setIsUploadingVideo(false);
    currentPositionMsRef.current = 0;
    lastStatusPosRef.current = 0;
    lastStatusTimeRef.current = 0;
    lastRenderPosRef.current = 0;
    setCurrentPositionMs(0);
    setVideoDurationMs(0);
    setImageNaturalSize({ width: 0, height: 0 });
    setVideoNaturalSize({ width: 0, height: 0 });
    setMediaUri(asset.uri);
    setMediaType(type);
    setFileName(name);

    if (type === 'video') {
      try {
        await videoRef.current?.setStatusAsync({ shouldPlay: false, positionMillis: 0 });
      } catch { /* ignore */ }
      const vid = Date.now().toString();
      setVideoId(vid);
      setIsUploadingVideo(true);
      try {
        const uploaded = await apiClient.uploadFile(asset.uri, name, vid);
        setUploadedFileId(uploaded.id);
      } catch (err: any) {
        Alert.alert('Upload lỗi', err?.message || 'Không thể tải video lên backend');
      } finally {
        setIsUploadingVideo(false);
      }
      return;
    }
    setVideoId('');
  };

  const handleDetect = () => {
    if (mediaType === 'image') {
      if (!mediaUri || !fileName) return;
      void detectImageBySource(mediaUri, fileName);
      return;
    }
    if (mediaType === 'video') {
      if (isDetecting) {
        stopDetection();
      } else {
        if (isUploadingVideo || !uploadedFileId) {
          Alert.alert('Đang chuẩn bị', 'Video đang upload, vui lòng chờ upload xong rồi bấm detect.');
          return;
        }
        const ok = startVideoDetection();
        if (!ok) Alert.alert('Thiếu dữ liệu', 'Chưa có file upload để bắt đầu phát hiện');
      }
    }
  };

  const handleSeekToViolation = async (timestamp: number) => {
    if (!videoRef.current) return;
    try {
      await videoRef.current.setPositionAsync(timestamp);
      setCurrentPositionMs(timestamp);
    } catch { /* ignore */ }
  };

  const renderViolationItem = ({ item }: { item: ViolationFrame }) => {
    const imageUrl = item.image_path?.startsWith('http')
      ? item.image_path
      : `${BACKEND_BASE_URL}${item.image_path}`;
    return (
      <TouchableOpacity style={styles.violationCard} onPress={() => handleSeekToViolation(item.timestamp)}>
        <Image source={{ uri: imageUrl }} style={styles.violationImage} resizeMode="cover" />
        <View style={styles.violationBadge}>
          <Text style={styles.violationBadgeText}>{item.detections?.length || 0}</Text>
        </View>
        <Text style={styles.violationTime}>{(item.timestamp / 1000).toFixed(1)}s</Text>
      </TouchableOpacity>
    );
  };

  // --- Status bar logic ---
  const showStatusBar = isUploadingVideo || isDetecting || (!isDetecting && violationFrames.length > 0 && mediaType === 'video');
  const isDetectDone = !isDetecting && violationFrames.length > 0 && mediaType === 'video' && !!uploadedFileId;

  const isDetectDisabled = !mediaUri || isProcessing || (mediaType === 'video' && (isUploadingVideo || !uploadedFileId));

  return (
    <View style={styles.root}>
      {/* ── TẦNG 1: VIDEO / ẢNH ── */}
      <View
        style={[styles.videoArea, { width: screenWidth, height: videoAreaHeight }]}
      >
        {mediaUri ? (
          mediaType === 'video' ? (
            <>
              {!isFullscreen && (
                <View
                  style={StyleSheet.absoluteFill}
                  onLayout={(e) => {
                    const { width, height } = e.nativeEvent.layout;
                    setVideoLayoutSize({ width, height });
                  }}
                >
                  <Video
                    ref={videoRef}
                    source={{ uri: mediaUri }}
                    style={StyleSheet.absoluteFill}
                    shouldPlay={false}
                    useNativeControls={false}
                  progressUpdateIntervalMillis={80}
                  resizeMode={ResizeMode.CONTAIN}
                  onReadyForDisplay={(event) => {
                    const ns = event.naturalSize;
                    if (ns?.width && ns?.height) setVideoNaturalSize({ width: ns.width, height: ns.height });
                  }}
                  onPlaybackStatusUpdate={(status: AVPlaybackStatus) => {
                    if (!status.isLoaded) return;
                    const posMs = status.positionMillis || 0;
                    lastStatusPosRef.current = posMs;
                    lastStatusTimeRef.current = Date.now();
                    setIsVideoPlaying(!!status.isPlaying);
                    setVideoDurationMs(status.durationMillis || 0);
                  }}
                />
                {videoNaturalSize.width > 0 && videoLayoutSize.width > 0 && (
                  <BoundingBoxOverlay
                    detections={currentVideoBoxes}
                    containerSize={videoLayoutSize}
                    sourceSize={videoNaturalSize}
                    colorMap={modelColorMap}
                    labelMap={modelNameMap}
                  />
                )}
                </View>
              )}
              {/* Video controls */}
              <View style={styles.videoControls}>
                <TouchableOpacity
                  style={styles.videoControlBtn}
                  onPress={async () => {
                    if (!videoRef.current) return;
                    if (isVideoPlaying) await videoRef.current.pauseAsync();
                    else await videoRef.current.playAsync();
                  }}
                >
                  <Ionicons name={isVideoPlaying ? 'pause' : 'play'} size={22} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.videoControlTime}>
                  {(currentPositionMs / 1000).toFixed(1)}s / {(videoDurationMs / 1000).toFixed(1)}s
                </Text>
                <TouchableOpacity style={styles.videoControlBtn} onPress={() => setIsFullscreen(true)}>
                  <Ionicons name="expand-outline" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Image
                source={{ uri: mediaUri }}
                style={StyleSheet.absoluteFill}
                resizeMode="contain"
                onLoad={(event) => {
                  const src = event.nativeEvent.source;
                  if (src?.width && src?.height) setImageNaturalSize({ width: src.width, height: src.height });
                }}
              />
              <View
                style={StyleSheet.absoluteFill}
                onLayout={(e) => {
                  const { width, height } = e.nativeEvent.layout;
                  setImageLayoutSize({ width, height });
                }}
                pointerEvents="none"
              >
                <BoundingBoxOverlay
                  detections={imageDetections}
                  containerSize={imageLayoutSize}
                  sourceSize={imageNaturalSize}
                  colorMap={modelColorMap}
                  labelMap={modelNameMap}
                />
              </View>
            </>
          )
        ) : (
          <View style={styles.videoPlaceholder}>
            <Ionicons name="videocam-outline" size={52} color="#475569" />
            <Text style={styles.videoPlaceholderText}>Chưa có video</Text>
          </View>
        )}
      </View>

      {/* ── TẦNG 2: STATUS BAR ──
      {showStatusBar && (
        <View style={[styles.statusBar, isDetectDone && styles.statusBarDone]}>
          {isUploadingVideo ? (
            <>
              <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.statusText}>⬆ Đang tải video lên...</Text>
            </>
          ) : isDetecting ? (
            <>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>Đang phân tích</Text>
              {violationFrames.length > 0 && (
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>{violationFrames.length} vi phạm</Text>
                </View>
              )}
            </>
          ) : isDetectDone ? (
            <Text style={styles.statusText}>✓ Hoàn tất — {violationFrames.length} vi phạm phát hiện</Text>
          ) : null}
        </View>
      )} */}

      {/* ── TẦNG 3: PHẦN DƯỚI (scroll) ── */}
      <ScrollView style={styles.bottomArea} contentContainerStyle={styles.bottomContent}>

        {/* Upload / file info */}
        {!mediaUri ? (
          <TouchableOpacity style={styles.uploadAreaLarge} onPress={pickMedia}>
            <Ionicons name="cloud-upload-outline" size={48} color="#3b82f6" />
            <Text style={styles.uploadTextLarge}>Nhấn để chọn ảnh hoặc video</Text>
            <Text style={styles.uploadSubText}>Hỗ trợ MP4, MOV, JPG, PNG</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.fileBar}>
            <Ionicons
              name={mediaType === 'video' ? 'videocam' : 'image'}
              size={18}
              color="#3b82f6"
            />
            <Text style={styles.fileBarName} numberOfLines={1}>{fileName}</Text>
            <TouchableOpacity style={styles.fileBarBtn} onPress={pickMedia}>
              <Ionicons name="swap-horizontal-outline" size={18} color="#64748b" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.fileBarBtn} onPress={clearMedia}>
              <Ionicons name="trash-outline" size={18} color="#ef4444" />
            </TouchableOpacity>
          </View>
        )}

        {/* Detect button */}
        {mediaUri && (
          <TouchableOpacity
            style={[
              styles.detectButton,
              isDetecting && styles.detectButtonStop,
              isDetectDisabled && styles.detectButtonDisabled,
            ]}
            onPress={handleDetect}
            disabled={isDetectDisabled}
          >
            {isProcessing || isUploadingVideo ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons
                name={isDetecting ? 'stop-circle-outline' : 'scan-outline'}
                size={22}
                color="#fff"
              />
            )}
            <Text style={styles.detectButtonText}>
              {mediaType === 'video'
                ? isUploadingVideo
                  ? 'Đang upload video...'
                  : isDetecting
                    ? 'Dừng phát hiện'
                    : 'Bắt đầu phát hiện'
                : isProcessing
                  ? 'Đang phân tích...'
                  : 'Bắt đầu phát hiện'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Violation frames */}
        {mediaType === 'video' && (
          <View style={styles.resultCard}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Vi phạm phát hiện</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{violationFrames.length} ảnh</Text>
              </View>
            </View>
            {violationFrames.length > 0 ? (
              <FlatList
                data={violationFrames}
                renderItem={renderViolationItem}
                keyExtractor={(item) => `${item.frame_number}-${item.timestamp}`}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.violationList}
              />
            ) : isDetecting ? (
              /* Skeleton placeholders */
              <View style={styles.skeletonRow}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={styles.skeletonCard}>
                    <View style={styles.skeletonImage} />
                    <View style={styles.skeletonText} />
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="shield-outline" size={32} color="#cbd5e1" />
                <Text style={styles.emptyText}>Không có dữ liệu</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* ── FULLSCREEN MODAL ── */}
      <Modal
        visible={isFullscreen}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setIsFullscreen(false)}
      >
        <View style={styles.fullscreenContainer}>
          <View
            style={StyleSheet.absoluteFill}
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              setFullscreenLayoutSize({ width, height });
            }}
          >
            <Video
              ref={videoRef}
              source={{ uri: mediaUri || '' }}
              style={StyleSheet.absoluteFill}
              shouldPlay={isVideoPlaying}
              useNativeControls={false}
              progressUpdateIntervalMillis={80}
              resizeMode={ResizeMode.CONTAIN}
              positionMillis={lastStatusPosRef.current}
              onReadyForDisplay={(event) => {
                const ns = event.naturalSize;
                if (ns?.width && ns?.height) setVideoNaturalSize({ width: ns.width, height: ns.height });
              }}
              onPlaybackStatusUpdate={(status: AVPlaybackStatus) => {
                if (!status.isLoaded) return;
                const posMs = status.positionMillis || 0;
                lastStatusPosRef.current = posMs;
                lastStatusTimeRef.current = Date.now();
                setIsVideoPlaying(!!status.isPlaying);
                setVideoDurationMs(status.durationMillis || 0);
              }}
            />
          </View>
          {videoNaturalSize.width > 0 && fullscreenLayoutSize.width > 0 && (
            <BoundingBoxOverlay
              detections={currentVideoBoxes}
              containerSize={fullscreenLayoutSize}
              sourceSize={videoNaturalSize}
              colorMap={modelColorMap}
              labelMap={modelNameMap}
            />
          )}
          <View style={styles.fullscreenControls}>
            <TouchableOpacity
              style={styles.videoControlBtn}
              onPress={async () => {
                if (!videoRef.current) return;
                if (isVideoPlaying) await videoRef.current.pauseAsync();
                else await videoRef.current.playAsync();
              }}
            >
              <Ionicons name={isVideoPlaying ? 'pause' : 'play'} size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.videoControlTime}>
              {(currentPositionMs / 1000).toFixed(1)}s / {(videoDurationMs / 1000).toFixed(1)}s
            </Text>
            <TouchableOpacity style={styles.videoControlBtn} onPress={() => setIsFullscreen(false)}>
              <Ionicons name="contract-outline" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },

  // Video area
  videoArea: {
    backgroundColor: '#000',
    position: 'relative',
    overflow: 'hidden',
  },
  videoPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  videoPlaceholderText: { fontSize: 14, color: '#475569', fontWeight: '500' },
  videoControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  videoControlBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  videoControlTime: { flex: 1, color: '#fff', fontSize: 12, fontWeight: '500', textAlign: 'center' },

  // Status bar
  statusBar: {
    height: 36,
    backgroundColor: '#1e293b',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 8,
  },
  statusBarDone: { backgroundColor: '#14532d' },
  statusDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  statusText: { fontSize: 12, color: '#e2e8f0', fontWeight: '500', flex: 1 },
  statusBadge: {
    backgroundColor: '#ef4444',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  // Bottom scroll area
  bottomArea: { flex: 1, backgroundColor: '#f8fafc' },
  bottomContent: { padding: 14, gap: 12, paddingBottom: 32 },

  // Upload
  uploadAreaLarge: {
    borderWidth: 2,
    borderColor: '#93c5fd',
    borderStyle: 'dashed',
    borderRadius: 16,
    paddingVertical: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    gap: 10,
  },
  uploadTextLarge: { fontSize: 15, color: '#1d4ed8', fontWeight: '600' },
  uploadSubText: { fontSize: 12, color: '#64748b' },

  // File bar
  fileBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  fileBarName: { flex: 1, fontSize: 13, color: '#334155', fontWeight: '500' },
  fileBarBtn: { padding: 6 },

  // Detect button
  detectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1d4ed8',
    borderRadius: 12,
    height: 48,
    gap: 10,
  },
  detectButtonStop: { backgroundColor: '#dc2626' },
  detectButtonDisabled: { backgroundColor: '#94a3b8' },
  detectButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Result card
  resultCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 2,
  },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#1e293b', marginBottom: 10 },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },

  // Detection rows (image)
  detectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  detectionDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  detectionLabel: { flex: 1, fontSize: 14, color: '#334155', fontWeight: '500' },
  detectionConf: { fontSize: 13, color: '#64748b' },

  // Count badge
  countBadge: {
    backgroundColor: '#fef2f2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  countBadgeText: { fontSize: 11, color: '#dc2626', fontWeight: '600' },

  // Violation list
  violationList: { gap: 10, paddingVertical: 4 },
  violationCard: {
    width: 110,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  violationImage: { width: 110, height: 75, backgroundColor: '#e2e8f0' },
  violationBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    backgroundColor: '#ef4444',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  violationBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  violationTime: { textAlign: 'center', fontSize: 12, color: '#475569', fontWeight: '500', paddingVertical: 5 },

  // Skeleton
  skeletonRow: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  skeletonCard: { width: 110, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#e2e8f0' },
  skeletonImage: { width: 110, height: 75, backgroundColor: '#e2e8f0', opacity: 0.5 },
  skeletonText: { height: 20, margin: 6, borderRadius: 4, backgroundColor: '#e2e8f0', opacity: 0.4 },

  // Empty state
  emptyState: {
    height: 90,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
    borderRadius: 10,
    gap: 8,
  },
  emptyText: { fontSize: 13, color: '#94a3b8' },

  // Fullscreen
  fullscreenContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  fullscreenControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
});
