# Implementation Plan: 3soc-detection-smooth

## Overview

Nâng cấp toàn bộ pipeline phát hiện vi phạm chủ quyền: tối ưu inference YOLO, stream SSE đầy đủ, CanvasOverlay RAF độc lập, progress bar, auto-scan sau upload, và UI mobile mượt mà.

## Tasks

- [x] 1. Backend — Tối ưu Inference Engine (tasks.py)
  - [x] 1.1 Thêm hằng số inference và convert BGR→RGB trong `3soc/app/utils/tasks.py`
    - Định nghĩa `INFER_IMGSZ=640`, `INFER_CONF=0.20`, `INFER_IOU=0.45` ở đầu file
    - Trong `run_detection_on_frame()`: thêm `frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)` rồi truyền `frame_rgb` vào `model()` với `imgsz=INFER_IMGSZ, conf=INFER_CONF, iou=INFER_IOU, half=False, save=False, verbose=False`
    - Trong `run_detection_on_image_temp()`: đọc ảnh bằng `cv2.imread()`, convert BGR→RGB, truyền cùng tham số
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 1.2 Viết unit test kiểm tra hằng số inference
    - **test_inference_params**: assert `INFER_IMGSZ == 640`, `INFER_CONF == 0.20`, `INFER_IOU == 0.45`
    - Kiểm tra `run_detection_on_frame` và `run_detection_on_image_temp` được gọi với đúng kwargs
    - _Requirements: 1.1, 1.3_

- [x] 2. Backend — Tối ưu stream_cached và JPEG quality (files.py)
  - [x] 2.1 Sửa `stream_cached()` trong router files để emit `detection` event trước `violation` event
    - Tìm hàm `stream_cached()` trong `3soc/app/routers/files.py`
    - Với mỗi violation frame `v` trong `cached`, emit `detection` event (frame_number, timestamp, detections) trước, rồi mới emit `violation` event
    - Đổi `cv2.imwrite(...)` sang `cv2.imwrite(str(frame_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 95])`
    - _Requirements: 2.1, 2.2_

  - [ ]* 2.2 Viết property test kiểm tra thứ tự detection-before-violation
    - **Property 1: stream_cached detection-before-violation ordering**
    - Dùng `hypothesis` generate danh sách cached violations ngẫu nhiên
    - Assert mỗi `violation` event được preceded bởi ít nhất một `detection` event có cùng `timestamp`
    - **Validates: Requirements 2.2**

- [x] 3. Backend — Cập nhật requirements.txt
  - [x] 3.1 Sửa `3soc/requirements.txt`: comment `torch` và `torchvision`, thêm hướng dẫn cài CUDA
    - Comment dòng `torch` và `torchvision` với chú thích lý do (cần cài theo CUDA version)
    - Thêm comment hướng dẫn: lệnh `pip install` cho CUDA 11.8, CUDA 12.1, và CPU-only
    - _Requirements: 13.1, 13.2_

- [x] 4. Checkpoint — Backend hoàn tất
  - Ensure all backend tests pass, ask the user if questions arise.

- [x] 5. Admin Web — Hook useViolationSSE
  - [x] 5.1 Cập nhật `3soc-admin-web/hooks/useViolationSSE.ts`
    - Đọc `detectionFps` từ `localStorage.getItem('detectionFps')` khi khởi tạo SSE, fallback về `50`
    - Thêm `totalFramesRef` lưu `total_frames` từ `metadata` event
    - Tính `scanProgress` từ `detection` event: `Math.min(99, Math.round((frame_number / total_frames) * 100))`
    - `resetViolations()` reset đầy đủ: `violationFrames=[]`, `scanProgress=0`, `scanDone=false`, `totalFramesRef.current=0`
    - _Requirements: 3.1, 3.2, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 5.2 Viết property test cho detectionFps range validation
    - **Property 2: detectionFps input range validation**
    - Dùng `fast-check` generate giá trị `detectionFps` ngẫu nhiên
    - Assert giá trị lưu vào localStorage luôn nằm trong `[50, 200]`
    - **Validates: Requirements 3.3**

  - [ ]* 5.3 Viết property test cho state reset completeness
    - **Property 3: State reset completeness**
    - Dùng `fast-check` generate trạng thái trước đó bất kỳ
    - Assert sau `resetViolations()`: `scanProgress=0`, `scanDone=false`, `violationFrames=[]`
    - **Validates: Requirements 4.6, 5.5**

  - [ ]* 5.4 Viết property test cho scanProgress formula
    - **Property 4: scanProgress formula correctness**
    - Dùng `fast-check` generate `frame_number` và `total_frames > 0`
    - Assert `scanProgress === Math.min(99, Math.round((frame_number / total_frames) * 100))`
    - Assert `scanProgress < 100` cho đến khi nhận `complete` event
    - **Validates: Requirements 5.3**

  - [ ]* 5.5 Viết property test cho resetViolations idempotency
    - **Property 5: resetViolations idempotency**
    - Dùng `fast-check` generate trạng thái bất kỳ
    - Assert `resetViolations()` gọi nhiều lần cho kết quả giống gọi một lần
    - **Validates: Requirements 5.6**

- [x] 6. Admin Web — Hook useRealtimeDetection
  - [x] 6.1 Cập nhật `3soc-admin-web/hooks/useRealtimeDetection.ts`
    - `appendDetectionResult(timestamp, boxes)` luôn lưu entry kể cả khi `boxes=[]`
    - Đảm bảo `MAX_RESULT_ENTRIES = 2000` đã được set (hiện tại đã có)
    - Eviction: xóa entry có timestamp nhỏ nhất (oldest-first) khi vượt giới hạn
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 6.2 Viết property test cho appendDetectionResult với boxes rỗng
    - **Property 6: appendDetectionResult stores empty boxes**
    - Dùng `fast-check` generate timestamp hợp lệ
    - Assert `detectionResults.get(timestamp)` trả về `[]` sau khi gọi với `boxes=[]`
    - **Validates: Requirements 6.1**

  - [ ]* 6.3 Viết property test cho detectionResults size invariant
    - **Property 7: detectionResults size invariant**
    - Dùng `fast-check` generate số lần gọi `appendDetectionResult` bất kỳ (kể cả > 2000)
    - Assert `detectionResults.size <= 2000` sau mọi lần gọi
    - **Validates: Requirements 6.2, 6.4**

  - [ ]* 6.4 Viết property test cho oldest-first eviction
    - **Property 8: Oldest-first eviction**
    - Dùng `fast-check` fill map đến 2000 entries rồi thêm một entry mới
    - Assert entry bị xóa là entry có timestamp nhỏ nhất
    - **Validates: Requirements 6.3**

- [x] 7. Checkpoint — Hooks hoàn tất
  - Ensure all hook tests pass, ask the user if questions arise.

- [x] 8. Admin Web — CanvasOverlay
  - [x] 8.1 Viết lại `3soc-admin-web/components/CanvasOverlay.tsx` với kiến trúc RAF độc lập
    - RAF loop đọc `video.currentTime * 1000` trực tiếp, không qua React state
    - Binary search tìm `insertIdx` trong `sortedTsRef.current`; hiện box khi `currentMs - prevTs <= 80ms`; nhìn trước khi `nextTs - currentMs <= 20ms`
    - `emptyFrameCountRef` đếm frame rỗng liên tiếp; chỉ xóa box khi `>= EMPTY_FRAME_THRESHOLD (2)`
    - `ResizeObserver` sync kích thước canvas với video element
    - Màu: `co3soc=#FF0000`, `duongluoibo=#00FF00`, `vnmap=#0000FF`; label: `co3soc="Cờ 3 sọc"`, `duongluoibo="Đường lưỡi bò"`, `vnmap="VN"`
    - Confidence format: `(confidence * 100).toFixed(0) + "%"`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.3, 8.4, 12.1, 12.2, 12.3_

  - [ ]* 8.2 Viết property test cho binary search correctness
    - **Property 9: Binary search correctness**
    - Dùng `fast-check` generate danh sách timestamps đã sort và `currentMs` bất kỳ
    - Assert kết quả binary search trong `findBoxes()` khớp với linear search
    - **Validates: Requirements 7.2, 7.8**

  - [ ]* 8.3 Viết property test cho BoundingBox display window
    - **Property 10: BoundingBox display window**
    - Dùng `fast-check` generate `currentMs` và `prevTimestamp`
    - Assert hiển thị box khi và chỉ khi `currentMs - prevTimestamp <= 80`
    - **Validates: Requirements 7.3**

  - [ ]* 8.4 Viết property test cho empty frame threshold debounce
    - **Property 11: Empty frame threshold debounce**
    - Dùng `fast-check` generate chuỗi frames với các frame rỗng xen kẽ
    - Assert box chỉ bị xóa sau ít nhất 2 frame rỗng liên tiếp
    - **Validates: Requirements 7.4**

  - [ ]* 8.5 Viết property test cho color và label mapping
    - **Property 12: Color and label mapping consistency**
    - Dùng `fast-check` generate model name từ tập `{co3soc, duongluoibo, vnmap}`
    - Assert mapping màu và label tiếng Việt nhất quán
    - **Validates: Requirements 7.6, 7.7, 8.3, 12.1, 12.2, 12.3**

  - [ ]* 8.6 Viết property test cho confidence formatting
    - **Property 13: Confidence formatting**
    - Dùng `fast-check` generate `confidence` trong `[0, 1]`
    - Assert kết quả là số nguyên phần trăm không có chữ số thập phân (ví dụ: `0.873` → `"87%"`)
    - **Validates: Requirements 8.4**

- [x] 9. Admin Web — page.tsx
  - [x] 9.1 Cập nhật `3soc-admin-web/app/page.tsx`
    - Bỏ `currentTimestamp` state và RAF sync riêng (nếu còn)
    - SSE tự động mở khi `mediaType === 'video' && !!videoId` (không cần `isDetecting`)
    - Đóng SSE cũ (`resetViolations()`) trước khi reset khi upload file mới
    - Loading bar từ `scanProgress`; nút "Xem phát hiện" disabled cho đến `scanDone`
    - Truyền `videoRef` và `detectionResults` thẳng vào `CanvasOverlay`
    - Khi `onViolation` callback: gọi `appendDetectionResult(violation.timestamp, violation.detections)` để lưu vào detection store
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 10. Admin Web — settings/page.tsx
  - [x] 10.1 Cập nhật input `detectionFps` trong `3soc-admin-web/app/settings/page.tsx`
    - Đổi `min="150" max="500"` thành `min="50" max="200" step="10"`
    - Đổi default value từ `210` thành `50` (hoặc đọc từ localStorage)
    - Đảm bảo `handleSettingsChange('detectionFps', ...)` lưu vào localStorage ngay lập tức
    - _Requirements: 3.3, 3.4, 3.5_

- [x] 11. Checkpoint — Admin Web hoàn tất
  - Ensure all admin web tests pass, ask the user if questions arise.

- [x] 12. Mobile App — Hook useRealtimeVideoDetection
  - [x] 12.1 Cập nhật `3soc-app/src/screens/detection/useRealtimeVideoDetection.ts`
    - Đổi `BOX_STALE_MS = 500` thành `BOX_STALE_MS = DETECT_SAMPLE_MS * 2` (= 400 với `DETECT_SAMPLE_MS=200`)
    - Thêm state `scanDone` và `scanProgress`
    - Xử lý `metadata` event: lưu `total_frames`, reset progress
    - Xử lý `detection` event: tính `scanProgress`, gọi `appendVideoDetection`
    - Xử lý `complete` event: `setScanDone(true)`, `setScanProgress(100)`, không gọi `stopDetection()`
    - Expose `scanDone`, `scanProgress` trong return value
    - _Requirements: 9.4, 10.1, 10.2_

  - [ ]* 12.2 Viết property test cho BOX_STALE_MS invariant
    - **Property 14: BOX_STALE_MS invariant**
    - Assert `BOX_STALE_MS === DETECT_SAMPLE_MS * 2`
    - Với `DETECT_SAMPLE_MS = 200`, assert `BOX_STALE_MS === 400`
    - **Validates: Requirements 10.1, 10.2**

  - [ ]* 12.3 Viết property test cho stale box not displayed
    - **Property 15: Stale box not displayed**
    - Dùng `fast-check` generate `currentPositionMs` và `detectionTimestamp`
    - Assert không trả về boxes khi `currentPositionMs - detectionTimestamp > BOX_STALE_MS`
    - **Validates: Requirements 10.3**

- [x] 13. Mobile App — DetectionScreen
  - [x] 13.1 Cập nhật `3soc-app/src/screens/DetectionScreen.tsx`
    - Sau khi upload thành công (`setUploadedFileId(uploaded.id)`), tự động gọi `startVideoDetection()`
    - Hiện loading indicator "Đang xử lý video..." + progress bar `scanProgress` khi `!scanDone && isDetecting`
    - Nút "Xem phát hiện" disabled khi `!scanDone`; unlock khi `scanDone=true`
    - Đổi FlatList violations sang `horizontal` scroll với `showsHorizontalScrollIndicator={false}`
    - Thêm detail modal: khi tap thumbnail → hiện modal với `BoundingBoxOverlay` và nút "Xem trong video"
    - Nút "Xem trong video" trong modal: seek video đến `frame.timestamp`, đóng modal
    - Label tiếng Việt: `co3soc="Cờ 3 sọc"`, `duongluoibo="Đường lưỡi bò"`, `vnmap="VN"`
    - _Requirements: 9.1, 9.2, 9.3, 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3_

- [x] 14. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass across backend, admin web, and mobile app. Ask the user if questions arise.

## Notes

- Tasks đánh dấu `*` là optional, có thể bỏ qua để MVP nhanh hơn
- Mỗi task tham chiếu requirements cụ thể để traceability
- Property tests dùng `hypothesis` (Python) và `fast-check` (TypeScript)
- CanvasOverlay hiện tại đã có kiến trúc RAF — task 8.1 là viết lại/kiểm tra lại toàn bộ theo spec
- `useRealtimeDetection` hiện tại đã có `MAX_RESULT_ENTRIES=2000` — task 6.1 chủ yếu đảm bảo empty boxes được lưu
