# Detect.md — Luồng xử lý Detection toàn hệ thống

> Cập nhật lần cuối: sau spec `3soc-detection-smooth` — inference tối ưu, SSE đầy đủ, RAF độc lập, auto-scan, mobile scanDone/scanProgress

## Tổng quan

```
User (Web / Mobile)
      │
      │  1. Upload video (HTTP POST multipart)
      │  2. SSE stream tự động mở SAU khi upload xong
      │     → Backend quét ngầm toàn bộ video
      │     → FE tính scanProgress từ detection events
      │     → Loading bar 0→100%
      │     → scanDone=true → nút "Xem phát hiện" mở khóa
      │  3. Bấm Play → bbox bám sát vật thể vi phạm
      │
      ▼
Backend FastAPI :8000
      │
      ├── Lưu file vào /uploads/
      ├── Lưu metadata vào MySQL (video_files)
      ├── Đọc video frame-by-frame (OpenCV)
      ├── Convert BGR→RGB trước khi inference
      ├── Chạy 3 YOLO models với tham số tối ưu
      ├── Lưu ảnh vi phạm JPEG quality=95
      ├── Lưu violations vào MySQL
      └── Stream kết quả về FE qua SSE
```

---

## BACKEND — Luồng xử lý chi tiết

### Bước 1: Upload video
**Endpoint**: `POST /api/files/upload`
**File**: `3soc/app/routers/files.py`

```
Client gửi multipart/form-data:
  - file: video file (.mp4, .mov...)
  - video_id: string (Date.now() từ frontend, tạo TRƯỚC khi upload)

Backend:
  1. Xác thực JWT token từ Authorization header
  2. Kiểm tra content_type phải là video/*
  3. Lưu file vào: uploads/{video_id}.{ext}
  4. Đọc duration bằng OpenCV (CAP_PROP_FPS + CAP_PROP_FRAME_COUNT)
  5. Tạo record trong bảng video_files:
     - id = video_id
     - filepath = /uploads/{video_id}.{ext}  (web path)
     - status = "uploaded"
  6. Trả về VideoFileResponse
```

### Bước 2: SSE Detection Stream
**Endpoint**: `GET /api/files/{file_id}/detect-stream`
**File**: `3soc/app/routers/files.py`

**Query params:**
- `sample_ms` (default 50ms): khoảng cách giữa các frame lấy mẫu (đọc từ localStorage `detectionFps` phía FE)
- `cooldown_ms` (default 200ms): cooldown per-label trước khi lưu ảnh violation tiếp
- `save_image_ms` (default 2000ms): cooldown toàn cục giữa các lần lưu ảnh

```
Kiểm tra cache:
  └── Nếu video đã có violations trong DB → stream cached results ngay (không chạy lại AI)
      Events: init → metadata → [detection + violation x N] → complete
      ⚠️ stream_cached() emit "detection" TRƯỚC "violation" cho mỗi frame
         để FE tính được scanProgress từ detection events

Nếu chưa có cache → chạy realtime detection:
  1. Cập nhật video_files.status = "processing"
  2. Khởi động 2 thread song song:
     ┌─ Thread 1: Frame Reader (OpenCV)
     │   - Mở video bằng cv2.VideoCapture
     │   - Tính frame_interval = fps * (sample_ms / 1000)
     │   - Đọc từng frame, chỉ lấy frame tại bội số của frame_interval
     │   - Tính timestamp = (frame_index / fps) * 1000  (milliseconds)
     │   - Đẩy (frame_number, timestamp, frame_numpy) vào frame_queue
     │
     └─ Thread 2: Detection Worker (YOLO)
         - Lấy frame từ frame_queue
         - Gọi tasks.run_detection_on_frame(frame)
           → Convert BGR→RGB trước khi inference
           → Chạy 3 models: co3soc, duongluoibo, vnmap
           → Mỗi model trả về list boxes: {x1,y1,x2,y2,score,class,model}
           → Normalize sang format: {x,y,width,height,label,confidence}
         - Đẩy kết quả vào result_queue

  3. Main thread đọc result_queue và stream SSE:

     Mỗi frame → emit event "detection":
     data: {"type":"detection","data":{"frame_number":N,"timestamp":T,"detections":[...]}}
     (detections có thể là [] nếu frame không có vi phạm)

     Nếu có vi phạm + qua cooldown:
       - Kiểm tra per-label cooldown: mỗi label phải cách lần lưu trước >= cooldown_ms
       - Kiểm tra global cooldown: phải cách lần lưu ảnh trước >= save_image_ms
       - Lưu frame thành JPG: uploads/violations/{video_id}/ts_{timestamp}_f{frame}.jpg
         với JPEG quality=95 (cv2.IMWRITE_JPEG_QUALITY, 95)
       - INSERT vào bảng violations (video_id, frame_number, timestamp, image_path, detections JSON)
       - Emit event "violation":
         data: {"type":"violation","data":{"frame_number":N,"timestamp":T,"image_path":"...","detections":[...]}}

  4. Khi xong tất cả frames:
     - Cập nhật video_files.status = "completed"
     - Emit event "complete": data: {"type":"complete","total_violations":N}
```

### YOLO Inference
**File**: `3soc/app/utils/tasks.py`

```python
# Hằng số inference (tối ưu để khớp với script Python test trực tiếp)
INFER_IMGSZ = 640
INFER_CONF  = 0.20
INFER_IOU   = 0.45

# 3 models được load lên GPU lúc khởi động:
#   co3soc      → models/3soc.pt        → phát hiện cờ 3 sọc
#   duongluoibo → models/duongluoibo.pt → phát hiện đường lưỡi bò
#   vnmap       → models/vnmap.pt       → phát hiện bản đồ sai

def run_detection_on_frame(frame):
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)  # ← convert BGR→RGB
    for model_name, model in _MODELS.items():
        results = model(frame_rgb, imgsz=INFER_IMGSZ, conf=INFER_CONF,
                        iou=INFER_IOU, half=False, save=False, verbose=False)
        ...

def run_detection_on_image_temp(image_path):
    img = cv2.imread(str(image_path))
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)  # ← convert BGR→RGB
    for model_name, model in _MODELS.items():
        results = model(img, imgsz=INFER_IMGSZ, conf=INFER_CONF,
                        iou=INFER_IOU, half=False, save=False, verbose=False)
        ...

Device: CUDA nếu có GPU, fallback CPU
```

### Cooldown System
```
Mục đích: tránh lưu quá nhiều ảnh trùng lặp

Per-label cooldown (cooldown_ms = 200ms):
  last_saved_label_ms = {"co3soc": 1000, "duongluoibo": 2500, ...}
  Chỉ lưu label X nếu: current_timestamp - last_saved_label_ms[X] >= cooldown_ms

Global cooldown (save_image_ms = 2000ms):
  last_saved_image_ms = 2000
  Chỉ lưu ảnh nếu: current_timestamp - last_saved_image_ms >= save_image_ms

→ Kết quả: tối đa 1 ảnh mỗi 2000ms, mỗi loại vi phạm có cooldown riêng
```

### Database Schema
```sql
-- Người dùng
users: id, username, email, password_hash (argon2), role, is_active, created_at

-- Video đã upload
video_files: id (=video_id từ FE), filename, filepath, user_id, file_size,
             duration, status, detection_id, created_at

-- Vi phạm phát hiện được
violations: id, video_id (FK), frame_number, timestamp (ms),
            image_path (web path), detections (JSON), created_at
```

---

## FRONTEND WEB — Luồng xử lý (3soc-admin-web)

### Bước 1: Upload file
**File**: `3soc-admin-web/app/page.tsx` — `handleFileChange()`

```
User chọn file:
  1. Gọi resetViolations() TRƯỚC — đóng SSE cũ, tránh race condition
  2. Pause + reset video cũ, setVideoId('')
  3. Tạo ObjectURL cho preview
  4. newVideoId = Date.now().toString()  ← tạo ID trước
  5. Gọi await apiClient.uploadFile(file, newVideoId)
     → POST /api/files/upload (multipart)
  6. Upload thành công → setVideoId(newVideoId)
     ← CHỈ LÚC NÀY SSE mới tự động mở (enabled = mediaType==='video' && !!videoId)

⚠️ Lỗi cũ đã sửa: videoId được set TRƯỚC await upload → SSE mở sớm → 404 Not Found
```

### Bước 2: SSE tự động quét ngầm
**File**: `3soc-admin-web/hooks/useViolationSSE.ts`

```
SSE tự động mở khi: enabled = mediaType === 'video' && !!videoId
(không cần isDetecting — quét ngầm ngay sau upload)

Tham số SSE:
  detectionFps  = parseInt(localStorage.getItem('detectionFps') || '50')  ← đọc từ Settings
  SAVE_COOLDOWN_MS = 200
  SAVE_IMAGE_MS    = 2000

URL: GET /api/files/{videoId}/detect-stream?sample_ms={detectionFps}&cooldown_ms=200&save_image_ms=2000

Xử lý từng event type:
  "metadata" → totalFramesRef.current = total_frames; setScanProgress(0); setScanDone(false)
  "detection" → gọi onViolation(detection) → appendDetectionResult(timestamp, boxes)
               → tính % tiến độ: Math.min(99, Math.round(frame_number/total_frames*100))
               → setScanProgress(pct)
  "violation" → appendViolation(violation) → hiện thumbnail
               → gọi onViolation(violation) → appendDetectionResult(timestamp, boxes)
  "complete"  → setScanProgress(100); setScanDone(true)

resetViolations():
  → seenKeysRef.clear()
  → setViolationFrames([])
  → setScanProgress(0); setScanDone(false)
  → totalFramesRef.current = 0
  (idempotent — gọi nhiều lần cho kết quả giống nhau)

State export:
  violationFrames  → danh sách frames có vi phạm (thumbnail grid)
  scanProgress     → 0-100 (loading bar, tối đa 99 cho đến khi nhận "complete")
  scanDone         → true khi quét xong (mở khóa nút "Xem phát hiện")
  resetViolations  → hàm reset + đóng SSE
```

### Bước 3: Lưu detection results vào Map
**File**: `3soc-admin-web/hooks/useRealtimeDetection.ts`

```
detectionResults: Map<timestamp_ms, BoundingBox[]>
MAX_RESULT_ENTRIES = 2000

appendDetectionResult(timestamp, boxes):
  → Map.set(timestamp, boxes || [])  ← lưu TẤT CẢ timestamps, kể cả boxes=[]
  → Nếu size > 2000: xóa entry có timestamp NHỎ NHẤT (oldest-first eviction)
    (linear scan để tìm min key — đảm bảo đúng, không phụ thuộc insertion order)

⚠️ Thay đổi quan trọng: trước đây bỏ qua frame rỗng (boxes=[]) → CanvasOverlay
   không biết frame nào thật sự không có vi phạm. Giờ lưu hết để CanvasOverlay
   phân biệt chính xác "chưa có data" vs "frame sạch không vi phạm".

Map này được truyền thẳng vào CanvasOverlay qua ref (không qua React state)
```

### Bước 4: Hiển thị loading bar + mở khóa nút
**File**: `3soc-admin-web/app/page.tsx`

```
Trong khi SSE đang chạy (scanDone=false):
  → Hiện loading bar: "Đang xử lý video... {scanProgress}%"
  → Nút "Xem phát hiện" bị disabled

Khi scanDone = true:
  → Hiện: "✓ Sẵn sàng — Bấm 'Xem phát hiện' để bắt đầu"
  → Nút được mở khóa
```

### Bước 5: Bấm "Xem phát hiện" → Video play + bbox hiện
**File**: `3soc-admin-web/app/page.tsx` — onClick nút Scan

```
setIsDetecting(true)
videoRef.current.play()
  → Video bắt đầu chạy
  → CanvasOverlay đã enabled=true từ khi videoId có giá trị → RAF loop đang chạy sẵn
```

### Bước 6: CanvasOverlay vẽ bbox realtime
**File**: `3soc-admin-web/components/CanvasOverlay.tsx`

```
Không phụ thuộc React re-render — tự chạy requestAnimationFrame loop (~60fps)

Hằng số:
  STALE_AFTER_MS        = 80ms   ← giữ box tối đa 80ms SAU detection timestamp
  STALE_BEFORE_MS       = 20ms   ← nhìn trước 20ms để compensate render latency
  EMPTY_FRAME_THRESHOLD = 2      ← cần 2 frame rỗng liên tiếp mới xóa box

Màu và label:
  MODEL_COLORS = { co3soc: '#FF0000', duongluoibo: '#00FF00', vnmap: '#0000FF' }
  LABEL_VI     = { co3soc: 'Cờ 3 sọc', duongluoibo: 'Đường lưỡi bò', vnmap: 'VN' }
  Confidence format: (confidence * 100).toFixed(0) + '%'

Mỗi frame RAF:
  1. Đọc video.currentTime * 1000 → currentMs
  2. findBoxes(currentMs) — Binary search O(log n):
     - Tìm insertIdx: vị trí đầu tiên trong sortedTs[] mà ts > currentMs
     - prevIdx = insertIdx - 1  → frame vừa qua (ts <= currentMs)
     - nextIdx = insertIdx      → frame sắp tới (ts > currentMs)

     Kiểm tra frame vừa qua (prevIdx):
       diff = currentMs - prevTs
       if diff <= 80ms:
         - boxes.length > 0 → vẽ, reset emptyFrameCount
         - boxes.length = 0 → emptyFrameCount++
           if emptyFrameCount >= 2 → xóa box (lastBoxesRef = [])
           else → giữ box cũ (tránh flash trắng từ 1 frame rỗng lẻ)

     Kiểm tra frame sắp tới (nextIdx):
       diff = nextTs - currentMs
       if diff <= 20ms && boxes.length > 0:
         → hiện trước để mượt

     Không tìm được frame nào → giữ lastBoxesRef (tránh flash trắng)

  3. draw(ctx, canvas, video, boxes):
     - Scale boxes theo tỉ lệ video/canvas (letterbox aware)
     - Vẽ rectangle + label với màu theo model
     - Label: "{tên tiếng Việt} {confidence}%"

Khi enabled=false:
  → cancelAnimationFrame
  → emptyFrameCountRef.current = 0
  → lastBoxesRef.current = []
  → clearRect canvas

ResizeObserver: tự resize canvas khi video element thay đổi kích thước
(thay thế setTimeout cũ)
```

### Bước 7: Thanh seek
**File**: `3soc-admin-web/app/page.tsx`

```
Uncontrolled input (không dùng React state → không trigger re-render):
  - ref={seekRef}
  - Cập nhật qua video "timeupdate" event:
    video.addEventListener('timeupdate', () => seekRef.current.value = video.currentTime * 1000)
  - onChange: videoRef.current.currentTime = val / 1000
```

### Cài đặt detectionFps
**File**: `3soc-admin-web/app/settings/page.tsx`

```
Input: min=50, max=200, step=10 (ms)
Default: 50ms (đọc từ localStorage với fallback 50)
Lưu vào localStorage key 'detectionFps' ngay khi thay đổi
useViolationSSE đọc giá trị này mỗi lần mở SSE connection mới
```

---

## FRONTEND MOBILE — Luồng xử lý (3soc-app)

### Khác biệt so với Web

**SSE implementation**: Mobile không dùng `EventSource`.
Thay bằng `XMLHttpRequest` với `onprogress`:

```typescript
// 3soc-app/src/screens/detection/useRealtimeVideoDetection.ts
xhr.onprogress = () => {
  const chunk = xhr.responseText.slice(lastProcessedIndex);
  buffer += chunk;
  // Split by \n\n để tách SSE events
  // Parse từng event thủ công
}
```

**Hằng số:**
```typescript
const DETECT_SAMPLE_MS = 200;           // hardcode, không có UI thay đổi trên Mobile
const BOX_STALE_MS     = DETECT_SAMPLE_MS * 2;  // = 400ms (invariant: luôn = DETECT_SAMPLE_MS * 2)
```

**Auto-start detection sau upload:**
```typescript
// Sau khi upload thành công:
setUploadedFileId(uploaded.id);
// useEffect theo dõi uploadedFileId → tự gọi startVideoDetection()
```

**scanDone / scanProgress:**
```typescript
// Xử lý SSE events:
"metadata" → totalFramesRef.current = total_frames; setScanProgress(0)
"detection" → setScanProgress(Math.min(99, Math.round(frameNumber/total*100)))
              appendVideoDetection(timestamp, boxes)
"violation" → appendViolation(violation); appendVideoDetection(timestamp, boxes)
"complete"  → setScanDone(true); setScanProgress(100)
              // KHÔNG gọi stopDetection() — giữ isDetecting=true

// Return value:
return { isDetecting, violationFrames, currentVideoBoxes,
         scanDone, scanProgress,
         startVideoDetection, stopDetection, resetRealtimeState }
```

**Video position sync**: Không dùng React state cho timestamp.
Dùng extrapolation từ last known status:

```typescript
// Mỗi 16ms
const elapsed = Date.now() - lastStatusTimeRef.current;
const pos = lastStatusPosRef.current + elapsed;
currentPositionMsRef.current = pos;
// Re-render chỉ mỗi 80ms
```

**Secure storage**: Token lưu trong `expo-secure-store` (encrypted) thay vì `localStorage`.

### DetectionScreen
**File**: `3soc-app/src/screens/DetectionScreen.tsx`

```
Upload flow:
  1. User chọn file → pickMedia()
  2. Upload video → apiClient.uploadFile()
  3. Upload xong → setUploadedFileId(uploaded.id) → auto startVideoDetection()
  4. Hiện loading: "Đang xử lý video..." + progress bar scanProgress
  5. scanDone=true → nút "Xem phát hiện" unlock (không auto-play)

Violation list:
  - FlatList horizontal, showsHorizontalScrollIndicator=false
  - Tap thumbnail → mở detail modal

Detail modal:
  - Hiện ảnh thumbnail + BoundingBoxOverlay
  - Danh sách detections với label tiếng Việt + confidence
  - Nút "Xem trong video": seek đến frame.timestamp, đóng modal

Label tiếng Việt:
  LABEL_VI = { co3soc: 'Cờ 3 sọc', duongluoibo: 'Đường lưỡi bò', vnmap: 'VN' }
```

---

## Sơ đồ dữ liệu SSE events

```
Backend SSE                         Frontend (Web & Mobile)
──────────────────────────────────────────────────────────────
{"type":"init"}                 →   (khởi tạo state)

{"type":"metadata",                 totalFramesRef = total_frames
 "total_frames":360}            →   setScanProgress(0)

{"type":"detection",                appendDetectionResult(timestamp, [])
 "data":{                       →   Map.set(timestamp, [])  ← frame rỗng cũng lưu
   "frame_number":1,                scanProgress = Math.min(99, round(1/360*100)) = 0%
   "timestamp":50,
   "detections":[]}}

{"type":"detection",                appendDetectionResult(timestamp, [...boxes])
 "data":{                       →   Map.set(timestamp, [...boxes])
   "frame_number":72,               scanProgress = Math.min(99, round(72/360*100)) = 20%
   "timestamp":2000,
   "detections":[...]}}

{"type":"violation",                appendViolation(violation) → thumbnail grid
 "data":{                       →   appendDetectionResult(timestamp, boxes)
   "timestamp":2000,
   "image_path":"/uploads/violations/...",
   "detections":[...]}}

{"type":"complete"}             →   setScanDone(true), setScanProgress(100)
                                    → nút "Xem phát hiện" mở khóa
```

---

## Bounding Box format

```
Backend trả về (normalized trong files.py):
{
  x: number,          // tọa độ góc trái trên (pixel, tọa độ gốc video)
  y: number,
  width: number,      // chiều rộng (pixel)
  height: number,     // chiều cao (pixel)
  label: string,      // "co3soc" | "duongluoibo" | "vnmap"
  confidence: number  // 0.0 - 1.0
}

CanvasOverlay scale về kích thước hiển thị (letterbox aware):
  videoAspect = videoWidth / videoHeight
  canvasAspect = canvas.width / canvas.height

  if videoAspect > canvasAspect:   // video rộng hơn → letterbox trên/dưới
    rw = canvas.width
    rh = canvas.width / videoAspect
    ox = 0
    oy = (canvas.height - rh) / 2
  else:                            // video cao hơn → letterbox trái/phải
    rh = canvas.height
    rw = canvas.height * videoAspect
    ox = (canvas.width - rw) / 2
    oy = 0

  scaleX = rw / videoWidth
  scaleY = rh / videoHeight
  x_canvas = box.x * scaleX + ox
  y_canvas = box.y * scaleY + oy
```

---

## Các lỗi đã sửa (lịch sử)

| Lỗi | Nguyên nhân | Fix |
|-----|-------------|-----|
| SSE 404 khi upload | `setVideoId()` gọi trước `await uploadFile()` → SSE mở khi file chưa có trong DB | Set `videoId` chỉ sau khi upload thành công |
| Bbox nhấp nháy | `DETECT_SAMPLE_MS` quá thưa, thiếu tham số inference | Giảm xuống 50ms (Web), thêm `INFER_IMGSZ/CONF/IOU`, convert BGR→RGB |
| Flash trắng giữa 2 detection | Frame rỗng xóa `lastBoxesRef` ngay | Cần 2 frame rỗng liên tiếp (`EMPTY_FRAME_THRESHOLD=2`) mới xóa |
| Map không biết frame sạch | `appendDetectionResult` bỏ qua `boxes=[]` | Lưu tất cả timestamps kể cả rỗng |
| Eviction sai thứ tự | Dùng `keys().next().value` (insertion order) thay vì min timestamp | Linear scan tìm min key trước khi delete |
| stream_cached không có scanProgress | Không emit `detection` event khi stream cached | Emit `detection` trước `violation` cho mỗi frame |
| Ảnh thumbnail chất lượng thấp | `cv2.imwrite` không có quality param | Thêm `[cv2.IMWRITE_JPEG_QUALITY, 95]` |
| Kết quả inference kém hơn script Python | Thiếu `imgsz`, `conf`, `iou`; frame BGR không convert | Thêm hằng số `INFER_*`, convert BGR→RGB |
| detectionFps range sai | Settings cho phép 150-500ms | Đổi thành 50-200ms, step=10 |
| SSE race condition khi upload file mới | SSE cũ chưa đóng khi reset state | Gọi `resetViolations()` trước khi reset state |
| Mobile không auto-start detection | Phải bấm nút thủ công | Auto gọi `startVideoDetection()` sau upload |
| Mobile bbox stale quá lâu | `BOX_STALE_MS=500` hardcode | Đổi thành `DETECT_SAMPLE_MS * 2 = 400ms` |
| Hydration error | Browser extension inject attributes vào `<body>` | Thêm `suppressHydrationWarning` vào `<body>` |
| Settings 404 | `API_URL` bị double `/api` | Strip `/api` suffix trước khi dùng |
| Upload 401 | `apiClient` singleton khởi tạo server-side, `localStorage` chưa có | `getHeaders()` đọc token lazy mỗi lần gọi |
| Menu "Người dùng" ẩn | `TopBar` gọi sai URL → `userRole=null` | Fix `API_URL` trong TopBar |
