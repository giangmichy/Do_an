# Requirements Document

## Introduction

Tính năng này nâng cấp toàn bộ pipeline phát hiện vi phạm chủ quyền Việt Nam (YOLOv11) để trải nghiệm demo trên Web (Next.js) và Mobile (React Native Expo) đạt chất lượng ngang với script Python test trực tiếp. Vấn đề cốt lõi hiện tại: bbox nhấp nháy, không bám sát vật thể, hay bỏ sót khi demo — trong khi test bằng script Python thì cực kỳ chuẩn và mượt.

Luồng mục tiêu: Upload video → Backend xử lý ngầm toàn bộ (quét hết video, lưu kết quả) → Loading bar tiến độ → Xong → Bấm Play → Video chạy, bbox bám sát vật thể vi phạm ngay lập tức → Thẻ vi phạm xuất hiện bên dưới → Click thẻ → Seek đến đúng thời điểm.

## Glossary

- **System**: Toàn bộ hệ thống 3SOC gồm Backend, Admin Web và Mobile App
- **Backend**: FastAPI server tại `3soc/`, xử lý inference YOLO và streaming SSE
- **Admin_Web**: Ứng dụng Next.js tại `3soc-admin-web/`, giao diện quản trị
- **Mobile_App**: Ứng dụng React Native Expo tại `3soc-app/`, giao diện người dùng di động
- **YOLO_Model**: Một trong ba model YOLOv11: `co3soc`, `duongluoibo`, `vnmap`
- **Inference_Engine**: Module `tasks.py` thực hiện inference YOLO trên frame/ảnh
- **SSE_Stream**: Server-Sent Events stream từ endpoint `/files/{id}/detect-stream`
- **Detection_Pipeline**: Luồng xử lý từ đọc frame → inference → emit SSE
- **CanvasOverlay**: Component canvas vẽ bounding box lên video trên Admin Web
- **BoundingBox**: Hình chữ nhật xác định vị trí vật thể vi phạm trong frame
- **ViolationFrame**: Một frame video có chứa ít nhất một vi phạm được phát hiện
- **scanProgress**: Tiến độ quét video từ 0 đến 100 (%)
- **scanDone**: Trạng thái boolean cho biết quét video đã hoàn tất
- **BOX_STALE_MS**: Khoảng thời gian tối đa (ms) một BoundingBox còn hiệu lực
- **DETECT_SAMPLE_MS**: Khoảng cách giữa các frame được lấy mẫu để inference (ms)
- **detectionFps**: Cài đặt người dùng cho tốc độ lấy mẫu frame (ms), lưu trong localStorage/AsyncStorage

---

## Requirements

### Requirement 1: Tối ưu tham số Inference_Engine

**User Story:** Là một sinh viên demo đồ án, tôi muốn kết quả phát hiện trên Web/App giống hệt khi chạy script Python trực tiếp, để bài demo đạt chất lượng chuyên nghiệp.

#### Acceptance Criteria

1. THE Inference_Engine SHALL định nghĩa các hằng số `INFER_IMGSZ=640`, `INFER_CONF=0.20`, `INFER_IOU=0.45` tại đầu file `tasks.py`.
2. WHEN Inference_Engine nhận một frame BGR từ OpenCV, THE Inference_Engine SHALL chuyển đổi frame sang định dạng RGB trước khi truyền vào YOLO_Model.
3. WHEN Inference_Engine gọi YOLO_Model để inference, THE Inference_Engine SHALL truyền các tham số `imgsz=INFER_IMGSZ`, `conf=INFER_CONF`, `iou=INFER_IOU`, `half=False` vào tất cả lời gọi `model()`.
4. THE Inference_Engine SHALL áp dụng các tham số tối ưu trên cho cả hàm `run_detection_on_frame()` lẫn `run_detection_on_image_temp()`.

---

### Requirement 2: Tối ưu Detection_Pipeline — lưu ảnh và stream cached

**User Story:** Là một sinh viên demo đồ án, tôi muốn ảnh thumbnail vi phạm có chất lượng cao và kết quả cached được stream đầy đủ, để người xem thấy rõ chi tiết vi phạm.

#### Acceptance Criteria

1. WHEN Detection_Pipeline lưu ảnh thumbnail vi phạm bằng `cv2.imwrite()`, THE Detection_Pipeline SHALL sử dụng tham số chất lượng JPEG `[cv2.IMWRITE_JPEG_QUALITY, 95]`.
2. WHEN Detection_Pipeline stream kết quả cached (`stream_cached()`), THE Detection_Pipeline SHALL emit event `detection` cho mỗi frame (kể cả frame không có vi phạm) trước khi emit event `violation`.
3. THE Detection_Pipeline SHALL đọc giá trị `detectionFps` từ request parameter `sample_ms` với fallback mặc định là 50ms.

---

### Requirement 3: Cài đặt detectionFps — Admin Web

**User Story:** Là một admin, tôi muốn điều chỉnh tốc độ lấy mẫu frame trong khoảng hợp lý, để cân bằng giữa độ chi tiết và tốc độ xử lý.

#### Acceptance Criteria

1. THE Admin_Web SHALL đọc giá trị `detectionFps` từ `localStorage` với key `detectionFps` khi khởi tạo SSE stream.
2. IF giá trị `detectionFps` không tồn tại trong `localStorage`, THEN THE Admin_Web SHALL sử dụng giá trị mặc định 50ms.
3. THE Admin_Web SHALL giới hạn giá trị `detectionFps` trong khoảng `[50, 200]` ms — không cho phép nhập giá trị nhỏ hơn 50ms hoặc lớn hơn 200ms.
4. WHEN người dùng thay đổi `detectionFps` trên trang Settings, THE Admin_Web SHALL lưu giá trị mới vào `localStorage` ngay lập tức.
5. THE Admin_Web SHALL hiển thị input `detectionFps` với `min=50`, `max=200`, `step=10` trên trang Settings.

---

### Requirement 4: Flow upload → scan ngầm → play — Admin Web

**User Story:** Là một người dùng Admin Web, tôi muốn video được quét tự động sau khi upload và chỉ cho phép play khi quét xong, để tránh tình trạng bbox không hiển thị khi video đang chạy.

#### Acceptance Criteria

1. WHEN Admin_Web hoàn tất upload video, THE Admin_Web SHALL tự động mở SSE stream để bắt đầu quét ngầm mà không cần người dùng bấm thêm nút.
2. THE Admin_Web SHALL đóng SSE stream hiện tại khi người dùng upload file mới (trước khi reset trạng thái), để tránh race condition giữa stream cũ và stream mới.
2. WHILE SSE_Stream đang xử lý, THE Admin_Web SHALL hiển thị loading bar phản ánh giá trị `scanProgress` từ 0 đến 100%.
3. WHILE `scanDone` là `false`, THE Admin_Web SHALL vô hiệu hóa (disabled) nút "Xem phát hiện".
4. WHEN `scanDone` chuyển thành `true`, THE Admin_Web SHALL kích hoạt nút "Xem phát hiện" và hiển thị thông báo sẵn sàng.
5. WHEN người dùng bấm "Xem phát hiện", THE Admin_Web SHALL tự động play video và đặt `isDetecting = true`.
6. WHEN người dùng upload file mới, THE Admin_Web SHALL reset toàn bộ trạng thái: `scanProgress=0`, `scanDone=false`, `violationFrames=[]`, `detectionResults` rỗng.

---

### Requirement 5: Hook useViolationSSE — Admin Web

**User Story:** Là một developer, tôi muốn hook useViolationSSE quản lý đầy đủ trạng thái tiến độ quét, để các component có thể hiển thị progress bar chính xác.

#### Acceptance Criteria

1. THE useViolationSSE SHALL expose các state: `violationFrames`, `scanProgress` (0-100), `scanDone`, và hàm `resetViolations()`.
2. WHEN SSE_Stream emit event `metadata`, THE useViolationSSE SHALL lưu `total_frames` vào `totalFramesRef` và reset `scanProgress` về 0.
3. WHEN SSE_Stream emit event `detection`, THE useViolationSSE SHALL tính `scanProgress` từ `frame_number / total_frames` trong payload của event đó theo công thức `Math.min(99, Math.round((frame_number / total_frames) * 100))` — tiến độ được tính hoàn toàn phía FE, không có event type riêng từ Backend.
4. WHEN SSE_Stream emit event `complete`, THE useViolationSSE SHALL đặt `scanProgress = 100` và `scanDone = true`.
5. WHEN `resetViolations()` được gọi, THE useViolationSSE SHALL reset `violationFrames=[]`, `scanProgress=0`, `scanDone=false`, và `totalFramesRef.current=0`.
6. FOR ALL lần gọi `resetViolations()` liên tiếp, THE useViolationSSE SHALL cho kết quả giống nhau (idempotent).

---

### Requirement 6: Hook useRealtimeDetection — Admin Web

**User Story:** Là một developer, tôi muốn hook useRealtimeDetection lưu tất cả timestamps kể cả frame rỗng, để CanvasOverlay có đủ dữ liệu để quyết định khi nào xóa bbox.

#### Acceptance Criteria

1. WHEN `appendDetectionResult()` được gọi với `boxes=[]`, THE useRealtimeDetection SHALL vẫn lưu entry `timestamp → []` vào `detectionResults`.
2. THE useRealtimeDetection SHALL giới hạn `detectionResults.size` không vượt quá `MAX_RESULT_ENTRIES = 2000`.
3. WHEN `detectionResults.size` đạt `MAX_RESULT_ENTRIES`, THE useRealtimeDetection SHALL xóa entry có timestamp nhỏ nhất (oldest-first eviction).
4. FOR ALL số lần gọi `appendDetectionResult()` bất kỳ, THE useRealtimeDetection SHALL đảm bảo `detectionResults.size <= 2000`.

---

### Requirement 7: CanvasOverlay — kiến trúc RAF độc lập React

**User Story:** Là một người dùng xem video, tôi muốn bbox bám sát vật thể vi phạm mượt mà mà không nhấp nháy, để trải nghiệm demo chuyên nghiệp.

#### Acceptance Criteria

1. THE CanvasOverlay SHALL sử dụng `requestAnimationFrame` loop để đọc `video.currentTime` trực tiếp, không phụ thuộc vào React state hay re-render cycle.
2. THE CanvasOverlay SHALL sử dụng binary search để tìm timestamp gần nhất trong `detectionResults` tương ứng với `video.currentTime`.
3. WHEN `currentMs - prevTimestamp <= 80ms`, THE CanvasOverlay SHALL hiển thị BoundingBox của frame đó.
4. WHEN một frame có `boxes=[]`, THE CanvasOverlay SHALL đếm số frame rỗng liên tiếp và chỉ xóa bbox khi đếm đạt `EMPTY_FRAME_THRESHOLD = 2`.
5. THE CanvasOverlay SHALL sử dụng `ResizeObserver` để đồng bộ kích thước canvas với video element, thay vì `setTimeout`.
6. THE CanvasOverlay SHALL vẽ BoundingBox với màu: `co3soc=#FF0000`, `duongluoibo=#00FF00`, `vnmap=#0000FF`.
7. THE CanvasOverlay SHALL hiển thị label tiếng Việt: `co3soc="Cờ 3 sọc"`, `duongluoibo="Đường lưỡi bò"`, `vnmap="VN"`.
8. FOR ALL timestamps trong `detectionResults`, THE CanvasOverlay SHALL tìm đúng frame gần nhất bằng binary search (kết quả không phụ thuộc vào thứ tự duyệt tuyến tính).

---

### Requirement 8: UI kết quả vi phạm — Admin Web

**User Story:** Là một người dùng Admin Web, tôi muốn xem danh sách vi phạm với thumbnail và thông tin chi tiết, và click để seek đến đúng thời điểm vi phạm.

#### Acceptance Criteria

1. THE Admin_Web SHALL hiển thị mỗi ViolationFrame dưới dạng thẻ gồm: thumbnail ảnh, timestamp (giây), label tiếng Việt, và confidence (%).
2. WHEN người dùng click vào thẻ ViolationFrame, THE Admin_Web SHALL seek video đến `frame.timestamp / 1000` giây.
3. THE Admin_Web SHALL hiển thị label tiếng Việt theo mapping: `co3soc="Cờ 3 sọc"`, `duongluoibo="Đường lưỡi bò"`, `vnmap="VN"`.
4. THE Admin_Web SHALL hiển thị confidence dưới dạng phần trăm với 0 chữ số thập phân (ví dụ: "87%").

---

### Requirement 9: Flow scan ngầm khi upload — Mobile App

**User Story:** Là một người dùng Mobile App, tôi muốn video được quét tự động sau khi upload xong, để không cần bấm thêm nút và trải nghiệm liền mạch.

#### Acceptance Criteria

1. WHEN Mobile_App hoàn tất upload video thành công, THE Mobile_App SHALL tự động gọi `startVideoDetection()` mà không cần người dùng bấm thêm nút.
2. WHILE `scanDone` là `false`, THE Mobile_App SHALL hiển thị loading indicator với text "Đang xử lý video..." và progress bar `scanProgress`.
3. WHEN `scanDone` chuyển thành `true`, THE Mobile_App SHALL kích hoạt nút "Xem phát hiện" (active) nhưng KHÔNG tự động play video — người dùng phải chủ động bấm nút để tránh phát tiếng đột ngột khi đang dùng điện thoại.
4. THE Mobile_App SHALL sử dụng giá trị cố định `DETECT_SAMPLE_MS = 200ms` — không có UI để người dùng thay đổi trên Mobile App (localStorage của Web không chia sẻ được với AsyncStorage của App). Giá trị này được hardcode trong `useRealtimeVideoDetection.ts`.
5. WHEN người dùng chọn file mới, THE Mobile_App SHALL reset `scanDone=false`, `scanProgress=0`, `violationFrames=[]`.

---

### Requirement 10: Bbox sync — Mobile App

**User Story:** Là một người dùng Mobile App, tôi muốn bbox hiển thị đúng thời điểm và không bị stale quá lâu, để trải nghiệm xem video mượt mà.

#### Acceptance Criteria

1. THE Mobile_App SHALL tính `BOX_STALE_MS = DETECT_SAMPLE_MS * 2` để bbox tự động hết hiệu lực sau khoảng thời gian phù hợp với tốc độ lấy mẫu.
2. FOR ALL giá trị `DETECT_SAMPLE_MS` hợp lệ, THE Mobile_App SHALL đảm bảo `BOX_STALE_MS = DETECT_SAMPLE_MS * 2` (invariant).
3. WHEN `currentPositionMs - detectionTimestamp > BOX_STALE_MS`, THE Mobile_App SHALL không hiển thị BoundingBox của timestamp đó.

---

### Requirement 11: UI vi phạm — Mobile App

**User Story:** Là một người dùng Mobile App, tôi muốn xem danh sách vi phạm dạng cuộn ngang với thumbnail, và tap để xem chi tiết hoặc seek video.

#### Acceptance Criteria

1. THE Mobile_App SHALL hiển thị danh sách ViolationFrame dưới dạng horizontal scroll với thumbnail ảnh, timestamp, và số lượng detection.
2. WHEN người dùng tap vào thẻ ViolationFrame, THE Mobile_App SHALL hiển thị detail modal với BoundingBoxOverlay và nút "Xem trong video".
3. WHEN người dùng bấm "Xem trong video" trong detail modal, THE Mobile_App SHALL seek video đến `frame.timestamp` và đóng modal.
4. THE Mobile_App SHALL hiển thị label tiếng Việt: `co3soc="Cờ 3 sọc"`, `duongluoibo="Đường lưỡi bò"`, `vnmap="VN"`.

---

### Requirement 12: Đồng bộ màu sắc và label toàn hệ thống

**User Story:** Là một người xem demo, tôi muốn màu bbox và tên vi phạm nhất quán trên cả Web lẫn App, để demo trông chuyên nghiệp và dễ hiểu.

#### Acceptance Criteria

1. THE System SHALL sử dụng màu bbox nhất quán trên cả Admin_Web lẫn Mobile_App: `co3soc=#FF0000`, `duongluoibo=#00FF00`, `vnmap=#0000FF`.
2. THE System SHALL sử dụng label tiếng Việt nhất quán: `co3soc="Cờ 3 sọc"`, `duongluoibo="Đường lưỡi bò"`, `vnmap="VN"`.
3. FOR ALL model names trong tập `{co3soc, duongluoibo, vnmap}`, THE System SHALL map đúng sang màu và label tiếng Việt tương ứng trên mọi component hiển thị.

---

### Requirement 13: Cập nhật requirements.txt

**User Story:** Là một developer cài đặt môi trường, tôi muốn file requirements.txt có hướng dẫn rõ ràng về cách cài PyTorch theo CUDA, để không bị lỗi khi cài đặt.

#### Acceptance Criteria

1. THE Backend SHALL comment dòng `torch` và `torchvision` trong `requirements.txt` với chú thích giải thích lý do.
2. THE Backend SHALL thêm hướng dẫn cài PyTorch theo CUDA vào `requirements.txt` dưới dạng comment, bao gồm lệnh `pip install` cho các phiên bản CUDA phổ biến (CUDA 11.8, CUDA 12.1, CPU-only).
