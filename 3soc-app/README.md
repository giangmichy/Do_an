# 3SOC Detection — Mobile App

> **Frontend Mobile** — React Native (Expo) + TypeScript
> Phát hiện vi phạm chủ quyền (Cờ 3 sọc, Đường lưỡi bò, Bản đồ sai) trong ảnh và video thông qua backend.

---

## Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Yêu cầu cài đặt](#2-yêu-cầu-cài-đặt)
3. [Cách chạy](#3-cách-chạy)
4. [Cấu hình](#4-cấu-hình)
5. [Tổ chức thư mục](#5-tổ-chức-thư-mục)
6. [Các luồng chức năng chính](#6-các-luồng-chức-năng-chính)
7. [Cơ chế đồng bộ bounding box](#7-cơ-chế-đồng-bộ-bounding-box)
8. [Thông số kỹ thuật](#8-thông-số-kỹ-thuật)

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

[App] requestAnimationFrame: đọc position video → tìm boxes gần nhất trong Map
      → vẽ BoundingBoxOverlay lên video
```

---

## 7. Cơ chế đồng bộ bounding box

**Vấn đề**: `video.getStatusAsync()` trong React Native là **async Promise** (khác với `video.currentTime` đồng bộ trên web). Không thể gọi trong `requestAnimationFrame` vì độ trễ network → position bị lệch.

**Giải pháp** — 2 luồng song song:

1. **rAF loop (60fps)**: đọc `currentPositionMsRef.current` → gọi `updateCurrentBoxes(pos)` → tìm box gần nhất trong `videoDetectionsRef` → `setCurrentVideoBoxes` → render
2. **Sync từ native (100ms)**: `setInterval` gọi `getStatusAsync()` → cập nhật `currentPositionMsRef` để rAF loop luôn có position chính xác
3. **Parent poll (50ms)**: `DetectionScreen.tsx` poll position từ `onPlaybackStatusUpdate` + `getStatusAsync` → cập nhật cùng ref
4. **Stale window**: box chỉ hiển thị khi `|pos - detection_ts| ≤ BOX_STALE_MS`

**Khi SSE `complete`**: state `hasDetections = true` → rAF loop + sync vẫn tiếp tục → box vẫn hiển thị khi user tua video sau khi detect xong.

---

## 8. Thông số kỹ thuật

| Thông số | Giá trị | Ý nghĩa |
|----------|---------|---------|
| `DETECT_SAMPLE_MS` | 180ms | Backend lấy 1 frame mỗi 180ms video để detect |
| `SAVE_COOLDOWN_MS` | 200ms | Cooldown tối thiểu giữa 2 lần lưu violation frame cùng label |
| `SAVE_IMAGE_MS` | 2000ms | Cooldown toàn cục: chỉ lưu tối đa 1 ảnh thumbnail mỗi 2 giây |
| `BOX_STALE_MS` | 200ms | Box hiển thị khi timestamp detection cách position video ≤ 200ms |

**Màu bounding box:**
- `co3soc` → 🔴 Đỏ `#ef4444`
- `duongluoibo` → 🟢 Xanh lá `#22c55e`
- `vnmap` → 🔵 Xanh dương `#3b82f6`
