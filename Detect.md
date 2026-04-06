# Detect.md — Luồng xử lý Detection toàn hệ thống

> Cập nhật lần cuối: phản ánh đúng code hiện tại sau tất cả các lần sửa

## Tổng quan

```
User (Web / Mobile)
      │
      │  1. Upload video (HTTP POST multipart)
      │  2. SSE stream nhận kết quả realtime (chỉ mở SAU khi upload xong)
      │
      ▼
Backend FastAPI :8000
      │
      ├── Lưu file vào /uploads/
      ├── Lưu metadata vào MySQL (video_files)
      ├── Đọc video frame-by-frame (OpenCV)
      ├── Chạy 3 YOLO models song song trên GPU
      ├── Lưu ảnh vi phạm vào /uploads/violations/{video_id}/
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
- `sample_ms` (default 100ms): khoảng cách giữa các frame lấy mẫu
- `cooldown_ms` (default 500ms): cooldown per-label trước khi lưu ảnh violation tiếp
- `save_image_ms` (default 2000ms): cooldown toàn cục giữa các lần lưu ảnh

```
Kiểm tra cache:
  └── Nếu video đã có violations trong DB → stream cached results ngay (không chạy lại AI)
      Events: init → metadata → [violation x N] → complete

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
       - INSERT vào bảng violations (video_id, frame_number, timestamp, image_path, detections JSON)
       - Emit event "violation":
         data: {"type":"violation","data":{"frame_number":N,"timestamp":T,"image_path":"...","detections":[...]}}

  4. Khi xong tất cả frames:
     - Cập nhật video_files.status = "completed"
     - Emit event "complete": data: {"type":"complete","total_violations":N}
```

### YOLO Inference
**File**: `3soc/app/utils/tasks.py`

```
3 models được load lên GPU lúc khởi động:
  - co3soc      → models/3soc.pt        → phát hiện cờ 3 sọc
  - duongluoibo → models/duongluoibo.pt → phát hiện đường lưỡi bò
  - vnmap       → models/vnmap.pt       → phát hiện bản đồ sai

run_detection_on_frame(frame: numpy.ndarray):
  for model_name, model in _MODELS.items():
      results = model(frame, save=False, verbose=False)
      boxes = results[0].boxes  → xyxy + conf + cls
      → gắn thêm model_name vào mỗi box
  return aggregate_results  (tất cả boxes từ 3 models)

Device: CUDA nếu có GPU, fallback CPU
Warm-up: chạy 1 lần lúc startup để giảm latency lần đầu
```

### Cooldown System
```
Mục đích: tránh lưu quá nhiều ảnh trùng lặp

Per-label cooldown (cooldown_ms):
  last_saved_label_ms = {"co3soc": 1000, "duongluoibo": 2500, ...}
  Chỉ lưu label X nếu: current_timestamp - last_saved_label_ms[X] >= cooldown_ms

Global cooldown (save_image_ms):
  last_saved_image_ms = 2000
  Chỉ lưu ảnh nếu: current_timestamp - last_saved_image_ms >= save_image_ms

→ Kết quả: tối đa 1 ảnh mỗi save_image_ms, mỗi loại vi phạm có cooldown riêng
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
  1. Pause + reset video cũ, setVideoId(''), setUploadDone(false)
  2. Tạo ObjectURL cho preview
  3. newVideoId = Date.now().toString()  ← tạo ID trước
  4. Gọi await apiClient.uploadFile(file, newVideoId)
     → POST /api/files/upload (multipart)
     → Token lấy lazy từ localStorage mỗi lần gọi (tránh stale token)
  5. Upload thành công → setVideoId(newVideoId) + setUploadDone(true)
     ← CHỈ LÚC NÀY SSE mới được phép mở (tránh 404)

⚠️ Lỗi cũ đã sửa: videoId được set TRƯỚC await upload → SSE mở sớm → 404 Not Found
```

### Bước 2: SSE tự động quét ngầm
**File**: `3soc-admin-web/hooks/useViolationSSE.ts`

```
Tham số SSE hiện tại:
  DETECT_SAMPLE_MS = 50    ← lấy mẫu mỗi 50ms (~20fps detection)
  SAVE_COOLDOWN_MS = 200   ← cooldown per-label
  SAVE_IMAGE_MS    = 2000  ← cooldown toàn cục lưu ảnh

useEffect chạy khi: enabled=true && videoId có giá trị
  enabled = mediaType === 'video' && !!videoId && uploadDone

Mở EventSource:
  GET /api/files/{videoId}/detect-stream?sample_ms=50&cooldown_ms=200&save_image_ms=2000

Xử lý từng event type:
  "metadata" → totalFramesRef.current = total_frames; setScanProgress(0); setScanDone(false)
  "detection" → gọi onViolation(detection) → appendDetectionResult(timestamp, boxes)
               → tính % tiến độ: (frame_number / total_frames) * 100 → setScanProgress
  "violation" → appendViolation(violation) → hiện thumbnail
               → gọi onViolation(violation) → appendDetectionResult(timestamp, boxes)
  "complete"  → setScanProgress(100); setScanDone(true)

State export ra ngoài:
  violationFrames  → danh sách frames có vi phạm (thumbnail grid)
  scanProgress     → 0-100 (loading bar)
  scanDone         → true khi quét xong (mở khóa nút Play)
```

### Bước 3: Lưu detection results vào Map
**File**: `3soc-admin-web/hooks/useRealtimeDetection.ts`

```
detectionResults: Map<timestamp_ms, BoundingBox[]>
MAX_RESULT_ENTRIES = 2000  ← tăng từ 500 vì sample_ms=50ms dày hơn

appendDetectionResult(timestamp, boxes):
  → Map.set(timestamp, boxes)  ← lưu TẤT CẢ timestamps, kể cả boxes=[]
  → Giới hạn 2000 entries (xóa entry cũ nhất nếu vượt)

⚠️ Thay đổi quan trọng: trước đây bỏ qua frame rỗng (boxes=[]) → CanvasOverlay
   không biết frame nào thật sự không có vi phạm. Giờ lưu hết để CanvasOverlay
   phân biệt chính xác "chưa có data" vs "frame sạch không vi phạm".

Map này được truyền thẳng vào CanvasOverlay (không qua React state)
```

### Bước 4: Hiển thị loading bar + mở khóa nút
**File**: `3soc-admin-web/app/page.tsx`

```
Trong khi SSE đang chạy:
  → Hiện loading bar: "Đang xử lý video... {scanProgress}%"
  → Nút "Xem phát hiện" bị disabled (scanReady = false)

Khi scanDone = true:
  → useEffect: setScanReady(true)
  → Hiện: "✓ Sẵn sàng — Bấm 'Xem phát hiện' để bắt đầu"
  → Nút được mở khóa
```

### Bước 5: Bấm "Xem phát hiện" → Video play + bbox hiện
**File**: `3soc-admin-web/app/page.tsx` — onClick nút Scan

```
setIsDetecting(true)
videoRef.current.play()
  → Video bắt đầu chạy từ đầu
  → CanvasOverlay nhận enabled=true → bắt đầu RAF loop
```

### Bước 6: CanvasOverlay vẽ bbox realtime
**File**: `3soc-admin-web/components/CanvasOverlay.tsx`

```
Không phụ thuộc React re-render — tự chạy requestAnimationFrame loop (~60fps)

Tham số hiện tại:
  STALE_AFTER_MS       = 80ms   ← giữ box tối đa 80ms SAU detection timestamp
  STALE_BEFORE_MS      = 20ms   ← nhìn trước 20ms để compensate render latency
  EMPTY_FRAME_THRESHOLD = 2     ← cần 2 frame rỗng liên tiếp mới xóa box

Mỗi frame RAF:
  1. Đọc video.currentTime * 1000 → currentMs
  2. findBoxes(currentMs) — Binary search O(log n):
     - Tìm insertIdx: vị trí đầu tiên trong sortedTs[] mà ts > currentMs
     - prevIdx = insertIdx - 1  → frame vừa qua (ts <= currentMs)
     - nextIdx = insertIdx      → frame sắp tới (ts > currentMs)

     Kiểm tra frame vừa qua (prevIdx):
       diff = currentMs - prevTs
       if diff <= STALE_AFTER_MS (80ms):
         - boxes.length > 0 → vẽ, reset emptyFrameCount
         - boxes.length = 0 → emptyFrameCount++
           if emptyFrameCount >= 2 → xóa box (lastBoxesRef = [])
           else → giữ box cũ (tránh flash trắng từ 1 frame rỗng lẻ)

     Kiểm tra frame sắp tới (nextIdx):
       diff = nextTs - currentMs
       if diff <= STALE_BEFORE_MS (20ms) && boxes.length > 0:
         → hiện trước để mượt

     Không tìm được frame nào → giữ lastBoxesRef (tránh flash trắng)

  3. draw(ctx, canvas, video, boxes):
     - Scale boxes theo tỉ lệ video/canvas (letterbox aware)
     - Vẽ rectangle + label với màu theo model:
       co3soc=#FF0000, duongluoibo=#00FF00, vnmap=#0000FF
     - Label: "{tên tiếng Việt} {confidence}%"

Khi enabled=false:
  → cancelAnimationFrame
  → emptyFrameCountRef.current = 0  ← reset để lần sau không bị stale
  → lastBoxesRef.current = []
  → clearRect canvas

ResizeObserver: tự resize canvas khi video element thay đổi kích thước
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

---

## Sơ đồ dữ liệu detection event

```
Backend SSE                         Frontend
──────────────────────────────────────────────────────────────
{"type":"init"}                 →   (khởi tạo state)

{"type":"metadata",                 totalFramesRef = total_frames
 "total_frames":360}            →   setScanProgress(0)

{"type":"detection",                appendDetectionResult(timestamp, boxes)
 "data":{                       →   Map.set(timestamp, [])  ← frame rỗng cũng lưu
   "timestamp":50,                  setScanProgress(frame_number/total * 100)
   "detections":[]}}                CanvasOverlay: emptyFrameCount++, giữ box cũ

{"type":"detection",                appendDetectionResult(timestamp, boxes)
 "data":{                       →   Map.set(timestamp, [...boxes])
   "timestamp":100,                 CanvasOverlay: tìm thấy boxes → vẽ
   "detections":[...]}}

{"type":"violation",                appendViolation(violation) → thumbnail grid
 "data":{                       →   appendDetectionResult(timestamp, boxes)
   "timestamp":2000,
   "image_path":"/uploads/violations/...",
   "detections":[...]}}

{"type":"complete"}             →   setScanDone(true) → setScanReady(true) → nút mở khóa
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
| SSE 404 khi upload | `setVideoId()` gọi trước `await uploadFile()` → SSE mở khi file chưa có trong DB | Set `videoId` + `uploadDone=true` chỉ sau khi upload thành công |
| Bbox nhấp nháy 100ms | `DETECT_SAMPLE_MS=100` quá thưa | Giảm xuống `50ms` |
| Flash trắng giữa 2 detection | Frame rỗng xóa `lastBoxesRef` ngay | Cần 2 frame rỗng liên tiếp (`EMPTY_FRAME_THRESHOLD=2`) mới xóa |
| Map không biết frame sạch | `appendDetectionResult` bỏ qua `boxes=[]` | Lưu tất cả timestamps kể cả rỗng |
| Hydration error | Browser extension inject attributes vào `<body>` | Thêm `suppressHydrationWarning` vào `<body>` |
| Settings 404 | `API_URL` bị double `/api` | Strip `/api` suffix trước khi dùng |
| Upload 401 | `apiClient` singleton khởi tạo server-side, `localStorage` chưa có | `getHeaders()` đọc token lazy mỗi lần gọi |
| Menu "Người dùng" ẩn | `TopBar` gọi sai URL → `userRole=null` | Fix `API_URL` trong TopBar |
| `@/lib/WebSocketClient` not found | Import sai path | Đổi sang `@/hooks/useRealtimeDetection` |
