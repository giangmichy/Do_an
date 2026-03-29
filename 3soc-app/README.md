# 3SOC Detection — Mobile App

> **Frontend Mobile** — React Native (Expo) + TypeScript
> Phát hiện vi phạm chủ quyền (Cờ 3 sọc, Đường lưỡi bò, Bản đồ sai) trong ảnh và video thông qua backend AI.

---

## Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Yêu cầu cài đặt](#2-yêu-cầu-cài-đặt)
3. [Cách chạy](#3-cách-chạy)
4. [Cấu hình](#4-cấu-hình)
5. [Tổ chức thư mục](#5-tổ-chức-thư-mục)
6. [Các luồng chức năng chính](#6-các-luồng-chức-năng-chính)
7. [Thông số kỹ thuật](#7-thông-số-kỹ-thuật)

---

## 1. Tổng quan

App mobile kết nối với backend **3soc** (FastAPI, port 8000) để:

- Upload ảnh/video lên backend
- Nhận kết quả phát hiện vi phạm qua **SSE** (Server-Sent Events)
- Vẽ **bounding box** realtime lên video đang phát
- Hiển thị danh sách thumbnail các frame vi phạm

```
Mobile App (3soc-app)
        │
        │  HTTP + SSE
        ▼
Backend (3soc) ← FastAPI, port 8000
```

---

## 2. Yêu cầu cài đặt

| Phần mềm | Phiên bản | Ghi chú |
|----------|-----------|---------|
| Node.js | 18+ | Bắt buộc |
| Expo CLI | Latest | `npm install -g expo-cli` |
| Android Studio / Xcode | Tuỳ chọn | Để chạy emulator |
| Expo Go | Latest | Để chạy trên thiết bị thật |

---

## 3. Cách chạy

```bash
cd 3soc-app
npm install
npx expo start
```

Sau đó:
- Nhấn `a` → chạy trên Android Emulator
- Nhấn `i` → chạy trên iOS Simulator
- Scan QR bằng app **Expo Go** trên thiết bị thật

---

## 4. Cấu hình

Sửa file `src/config.ts` để trỏ đến backend:

```ts
// Android Emulator
export const API_BASE_URL = 'http://10.0.2.2:8000/api';

// iOS Simulator
export const API_BASE_URL = 'http://localhost:8000/api';

// Thiết bị thật (thay bằng IP máy tính chạy backend)
export const API_BASE_URL = 'http://192.168.1.x:8000/api';
```

---

## 5. Tổ chức thư mục

```
3soc-app/
│
├── src/
│   ├── api.ts                        ← Gọi HTTP đến backend (upload, detect ảnh)
│   ├── config.ts                     ← URL backend
│   │
│   ├── screens/
│   │   ├── DetectionScreen.tsx       ← Màn hình chính: chọn file, xem kết quả, vẽ bbox
│   │   └── detection/
│   │       ├── useRealtimeVideoDetection.ts  ← Hook: nhận SSE, quản lý detection state
│   │       └── types.ts              ← Kiểu dữ liệu (ViolationFrame, MediaType...)
│   │
│   └── components/
│       └── BoundingBoxOverlay.tsx    ← Component vẽ bounding box lên ảnh/video
│
├── app.json
├── package.json
└── tsconfig.json
```

---

## 6. Các luồng chức năng chính

### Luồng 1: Phát hiện ảnh tĩnh

```
[User] Chọn ảnh → Bấm "Bắt đầu phát hiện"
    │
    ▼
POST /api/files/detect-image
    │
    ▼
[Backend] Chạy 3 model YOLO → trả về danh sách bounding box
    │
    ▼
[App] Vẽ bounding box lên ảnh bằng BoundingBoxOverlay
      Hiển thị danh sách kết quả (label + confidence)

※ Ảnh không lưu vào DB — chỉ detect tức thì rồi trả về.
```

---

### Luồng 2: Phát hiện video (SSE)

```
[User] Chọn video
    │
    ▼
POST /api/files/upload  ← upload video lên backend, nhận uploadedFileId
    │
    ▼
[User] Bấm "Bắt đầu phát hiện"
    │
    ▼
GET /api/files/{uploadedFileId}/detect-stream  ← mở SSE stream
    │
    ▼
[Backend] Đọc video, lấy 1 frame mỗi DETECT_SAMPLE_MS
          Chạy 3 model YOLO trên từng frame
          Stream kết quả về App liên tục:

    SSE event "detection":
    { type: "detection", data: { timestamp, detections: [{x,y,width,height,label,confidence}] } }

    SSE event "violation" (frame có vi phạm đủ cooldown, có ảnh lưu):
    { type: "violation", data: { frame_number, timestamp, image_path, detections } }

    SSE event "complete": khi backend detect xong toàn bộ video
    │
    ▼
[App] Mỗi "detection" → lưu vào Map<timestamp, boxes>
      Mỗi "violation"  → thêm thumbnail vào danh sách vi phạm

[App] setInterval(16ms): extrapolate position video hiện tại
      → tìm boxes gần nhất trong Map → vẽ BoundingBoxOverlay lên video
```

---

### Cơ chế đồng bộ bounding box với video

Vấn đề: Backend detect toàn bộ video **trước** (không realtime), trả về tất cả detection timestamp ngay lập tức. Video người dùng mới bắt đầu play từ giây 0.

Giải pháp:
1. `onPlaybackStatusUpdate` (expo-av, 80ms/lần) → lưu `positionMillis` + `Date.now()` vào ref
2. `setInterval(16ms)` → tính `estimatedPos = lastKnownPos + (Date.now() - lastUpdateTime)` → **không cần async bridge call**
3. `useMemo` trigger mỗi 80ms → tìm detection timestamp gần nhất **đã đi qua** (`ts ≤ currentPos`, trong vòng `BOX_STALE_MS`)
4. Render `BoundingBoxOverlay` với boxes tìm được

---

## 7. Thông số kỹ thuật

| Thông số | Giá trị | Ý nghĩa |
|----------|---------|---------|
| `DETECT_SAMPLE_MS` | 200ms | Backend lấy 1 frame mỗi 200ms video để detect |
| `SAVE_COOLDOWN_MS` | 200ms | Cooldown theo từng label trước khi lưu ảnh violation tiếp theo |
| `SAVE_IMAGE_MS` | 2000ms | Cooldown toàn cục: chỉ lưu tối đa 1 ảnh thumbnail mỗi 2 giây |
| `BOX_STALE_MS` | 500ms | Box hiện tối đa 500ms sau timestamp detection đó |
| `DETECT_DEBUG_LOG` | false | Tắt log debug trong production |

**Màu bounding box:**
- `co3soc` → 🔴 Đỏ `#ef4444`
- `duongluoibo` → 🟢 Xanh lá `#22c55e`
- `vnmap` → 🔵 Xanh dương `#3b82f6`
