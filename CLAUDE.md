# CLAUDE.md — Project Instructions for 3SOC

## Tổng quan dự án

**3SOC** là hệ thống phát hiện vi phạm chủ quyền Việt Nam bằng AI, nhận diện 3 loại vi phạm trong ảnh/video:
- **Cờ 3 sọc** (co3soc) — cờ chế độ cũ
- **Đường lưỡi bò** (duongluoibo) — đường 9 đoạn phi pháp
- **Bản đồ sai** (vnmap) — bản đồ Việt Nam hỗ trợ nhận diện DuongLuoiBo

Dự án gồm 3 sub-project trong cùng 1 monorepo:

```
├── 3soc/              # Backend — FastAPI + Python + YOLOv8 + MySQL
├── 3soc-admin-web/    # Admin Web — Next.js 16 + React 19 + Tailwind + Radix UI
└── 3soc-app/          # Mobile App — React Native (Expo 52) + TypeScript
```

---

## Kiến trúc hệ thống

```
Mobile App / Admin Web
        │
    HTTP + SSE (Server-Sent Events)
        │
Backend FastAPI (port 8000)
        │
    ├── MySQL Database (users, video_files, violations)
    ├── YOLO Models (3soc.pt, duongluoibo.pt, vnmap.pt)
    └── File Storage (/uploads — video + ảnh vi phạm .jpg)
```

---

## 1. Backend (3soc/)

### Tech Stack
- **Python 3.10+**, FastAPI 0.128, Uvicorn
- **AI**: Ultralytics YOLOv8/v11, PyTorch, OpenCV
- **DB**: MySQL 8.0+ via SQLAlchemy ORM + PyMySQL driver
- **Auth**: JWT (HS256, 7 ngày) + Argon2 password hashing
- **Realtime**: SSE streaming detection results

### Cấu trúc thư mục
```
3soc/
├── app/
│   ├── main.py              # FastAPI app, load 3 YOLO models, warm-up, CORS, seed admin
│   ├── config.py            # UPLOAD_DIR = <project>/uploads/
│   ├── db/
│   │   ├── db.py            # SQLAlchemy engine, SessionLocal, init_db()
│   │   └── models.py        # ORM: User, VideoFile, Violation
│   ├── routers/
│   │   ├── users.py         # Auth + User CRUD endpoints
│   │   └── files.py         # Upload, list, delete, SSE detect-stream, detect-image
│   ├── schemas/
│   │   ├── user.py          # Pydantic: UserCreate, UserUpdate, LoginRequest, TokenResponse...
│   │   ├── file.py          # Pydantic: VideoFileResponse, VideoFileListResponse
│   │   └── response.py      # Pydantic: DetectionResult, PaginationMeta
│   └── utils/
│       ├── auth.py          # JWT create/decode, password hash/verify, get_current_user, require_admin
│       └── tasks.py         # YOLO inference: run_detection_on_frame(), run_detection_on_image_temp()
├── models/                  # 3 file .pt (3soc.pt, duongluoibo.pt, vnmap.pt)
├── uploads/                 # Video + violations images
│   └── violations/{video_id}/  # Ảnh frame vi phạm
├── .env                     # DATABASE_URL, SECRET_KEY
├── requirements.txt
└── run.txt                  # Lệnh chạy: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Database Schema

**users**: id (INT PK), username (UNIQUE), email (UNIQUE), password_hash, role ("user"|"admin"), is_active, created_at, updated_at

**video_files**: id (VARCHAR PK, từ frontend Date.now()), filename, filepath (web path /uploads/...), user_id (FK), file_size, duration, status ("uploaded"|"processing"|"completed"|"error"), detection_id, created_at

**violations**: id (INT PK auto), video_id (FK), frame_number, timestamp (ms), image_path (web path), detections (JSON: [{x, y, width, height, label, confidence}]), created_at

### API Endpoints (prefix: /api)

**Auth & Users** (`/api/users`):
| Method | Path | Auth | Mô tả |
|--------|------|------|--------|
| POST | /register | No | Đăng ký user mới |
| POST | /login | No | Đăng nhập → JWT token |
| GET | /me | Bearer | Thông tin user hiện tại |
| POST | /change-password | Bearer | Đổi mật khẩu |
| POST | /logout | Bearer | Logout (client-side) |
| GET | / | Admin | Danh sách users (paginated) |
| GET | /{id} | Admin | Chi tiết user |
| PUT | /{id} | Admin | Cập nhật user |
| DELETE | /{id} | Admin | Xóa user |

**Files** (`/api/files`):
| Method | Path | Auth | Mô tả |
|--------|------|------|--------|
| POST | /upload | Bearer | Upload video (multipart, kèm video_id) |
| GET | / | Bearer | Danh sách files (user thấy của mình, admin thấy tất cả) |
| DELETE | /{id} | No* | Xóa video + violations (cascade) |
| GET | /{id}/detect-stream | No* | SSE stream phát hiện realtime |
| POST | /detect-image | Bearer | Phát hiện ảnh nhanh (không lưu DB) |

**Static**: `GET /uploads/*` — serve video và ảnh vi phạm

### SSE Detection Stream

Endpoint `GET /api/files/{file_id}/detect-stream` có các query params:
- `sample_ms` (default 100): khoảng cách giữa các frame lấy mẫu
- `cooldown_ms` (default 500): cooldown per-label trước khi lưu ảnh violation tiếp
- `save_image_ms` (default 2000): cooldown toàn cục giữa các lần lưu ảnh

SSE events:
- `init` — bắt đầu detection
- `metadata` — thông tin video (fps, total_frames)
- `detection` — kết quả mỗi frame (kể cả không có vi phạm) → FE vẽ bbox realtime
- `violation` — frame có vi phạm + đã lưu ảnh → FE hiển thị thumbnail
- `complete` — hoàn tất

**Caching**: Nếu video đã detect trước đó (có violations trong DB), trả về cached results ngay lập tức.

### Cooldown System
- Per-label cooldown: mỗi loại vi phạm có cooldown riêng
- Global cooldown: giới hạn tần suất lưu ảnh toàn cục
- Tránh lưu trùng lặp, giảm tải disk/DB

### Tài khoản mặc định (seed khi khởi động)
- Admin: `admin` / `admin123`
- User: `user` / `user123`

### Cách chạy Backend
```bash
cd 3soc
# Tạo DB MySQL: CREATE DATABASE detect_3soc CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
# Cấu hình .env: DATABASE_URL=mysql+pymysql://root:PASSWORD@localhost/detect_3soc
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

---

## 2. Admin Web (3soc-admin-web/)

### Tech Stack
- **Next.js 16.0.10** (App Router), React 19.2.0, TypeScript
- **UI**: Radix UI (57 components), Tailwind CSS 4.1.9, Lucide icons
- **Forms**: React Hook Form + Zod validation
- **Charts**: Recharts 2.15.4

### Cấu trúc thư mục
```
3soc-admin-web/
├── app/
│   ├── page.tsx             # Dashboard chính: upload, detect, xem kết quả realtime
│   ├── api.ts               # API client singleton (fetch wrapper, token management)
│   ├── layout.tsx           # Root layout (TopBar, Toaster)
│   ├── login/page.tsx       # Trang đăng nhập
│   ├── files/page.tsx       # Quản lý files (CRUD, detect từ danh sách)
│   ├── users/page.tsx       # Quản lý users (admin only)
│   └── settings/page.tsx    # Cài đặt tài khoản, đổi mật khẩu
├── components/
│   ├── TopBar.tsx           # Navigation header (role-based menu)
│   ├── CanvasOverlay.tsx    # Vẽ bounding box realtime lên video
│   ├── DetectionModal.tsx   # Modal hiển thị kết quả detection
│   └── ui/                  # 57 Radix UI component wrappers (shadcn/ui style)
├── hooks/
│   ├── useRealtimeDetection.ts  # Quản lý detection results Map
│   └── useViolationSSE.ts      # Parse SSE stream, quản lý violation frames
├── lib/
│   └── imageUtils.ts        # Vẽ bounding box lên ảnh (canvas)
├── .env.local               # NEXT_PUBLIC_API_URL=http://localhost:8000/api
└── package.json
```

### Các trang
- **Dashboard** (`/`): Upload ảnh/video → detect → xem bbox realtime + thumbnail vi phạm
- **Files** (`/files`): Danh sách video, xóa, detect từ danh sách
- **Users** (`/users`): CRUD users (admin only)
- **Settings** (`/settings`): Xem profile, đổi mật khẩu, logout
- **Login** (`/login`): Đăng nhập

### Realtime Detection Flow (Video)
1. User chọn video → upload lên backend
2. Click "Bắt đầu phát hiện" → mở SSE stream
3. Backend xử lý frame-by-frame, stream kết quả
4. Frontend nhận `detection` events → vẽ bbox lên CanvasOverlay
5. Frontend nhận `violation` events → hiển thị thumbnail grid
6. Click thumbnail → seek video đến frame đó
7. Nếu video đã detect trước → trả cached results ngay

### Bounding Box Color Mapping
- Đỏ (#FF0000 / #ef4444) — Cờ 3 sọc (co3soc)
- Xanh lá (#00FF00 / #22c55e) — Đường lưỡi bò (duongluoibo)
- Xanh dương (#0000FF / #3b82f6) — Bản đồ VN (vnmap)

### Auth Flow (Web)
- Token lưu trong `localStorage` (key: `access_token`)
- API client tự gắn `Authorization: Bearer <token>` vào mọi request
- Redirect về `/login` khi token hết hạn

### Cách chạy Admin Web
```bash
cd 3soc-admin-web
npm install
npm run dev
# Mở http://localhost:3000
```

---

## 3. Mobile App (3soc-app/)

### Tech Stack
- **React Native 0.76.9** + Expo 52.0.0, TypeScript
- **Navigation**: React Navigation 7 (bottom tabs + native stack)
- **Video**: expo-av, react-native-video
- **File Picker**: expo-image-picker, expo-document-picker
- **Secure Storage**: expo-secure-store (lưu JWT token)

### Cấu trúc thư mục
```
3soc-app/
├── App.tsx                          # Root: AuthProvider + Navigation (Tab + Stack)
├── src/
│   ├── api.ts                       # API client (tương tự web, dùng SecureStore)
│   ├── config.ts                    # API_BASE_URL, BACKEND_BASE_URL
│   ├── contexts/
│   │   └── AuthContext.tsx          # Global auth state (login/logout/refreshUser)
│   ├── screens/
│   │   ├── DetectionScreen.tsx      # Màn hình chính: chọn file, detect, vẽ bbox
│   │   ├── FilesScreen.tsx          # Quản lý files
│   │   ├── UsersScreen.tsx          # Quản lý users (admin only)
│   │   ├── SettingsScreen.tsx       # Cài đặt
│   │   ├── LoginScreen.tsx          # Đăng nhập
│   │   └── detection/
│   │       ├── useRealtimeVideoDetection.ts  # SSE hook (XHR-based, không dùng EventSource)
│   │       └── types.ts             # ViolationFrame, MediaType
│   └── components/
│       └── BoundingBoxOverlay.tsx   # Vẽ bbox lên ảnh/video
└── package.json
```

### Navigation
```
App
├── LoginScreen (nếu chưa đăng nhập)
└── MainTabs (nếu đã đăng nhập)
    ├── Phát hiện (DetectionScreen)
    ├── Files (FilesScreen)
    ├── Người dùng (UsersScreen — admin only)
    └── Cài đặt (SettingsScreen)
```

### SSE trên React Native
- Không dùng `EventSource` (không hỗ trợ tốt trên RN)
- Dùng `XMLHttpRequest` với `onprogress` để parse SSE stream thủ công
- Buffer + split `\n\n` để tách events

### Video Position Sync
- Extrapolate position mỗi 16ms từ last known status (tránh async bridge call)
- Re-render mỗi 80ms để giảm tải
- Tìm detection boxes gần nhất trong khoảng 500ms tolerance

### Auth Flow (Mobile)
- Token lưu trong `expo-secure-store` (encrypted)
- Auto-login khi mở app nếu có token
- AuthContext cung cấp `login()`, `logout()`, `refreshUser()`

### Cấu hình Backend URL
Sửa `src/config.ts`:
```ts
// Android Emulator → localhost
export const API_BASE_URL = 'http://10.0.2.2:8000/api';
// iOS Simulator
export const API_BASE_URL = 'http://localhost:8000/api';
// Thiết bị thật (thay IP máy chạy backend)
export const API_BASE_URL = 'http://192.168.x.x:8000/api';
```

### Cách chạy Mobile App
```bash
cd 3soc-app
npm install
npx expo start
# a → Android Emulator | i → iOS Simulator | Scan QR → Expo Go
```

---

## Quy tắc chung khi code

### Ngôn ngữ
- Code bằng tiếng Anh (biến, hàm, comment kỹ thuật)
- UI text bằng tiếng Việt (labels, messages, placeholders)
- Comment giải thích logic phức tạp bằng tiếng Việt hoặc Anh đều được

### Backend
- Dùng Pydantic schema cho mọi request/response
- Dùng SQLAlchemy ORM, không viết raw SQL
- Auth: JWT Bearer token trong header `Authorization`
- Admin endpoints phải có `Depends(require_admin)`
- File upload qua multipart/form-data
- Detection results normalize về format: `{x, y, width, height, label, confidence}`
- SSE format: `data: {json}\n\n`

### Frontend (Web + Mobile)
- API client singleton pattern, tự quản lý token
- Pagination: `{items: [], meta: {page, page_size, total, total_pages, has_next, has_prev}}`
- Bounding box format từ backend: `{x, y, width, height, label, confidence}`
- Color mapping nhất quán: co3soc=đỏ, duongluoibo=xanh lá, vnmap=xanh dương
- SSE events: parse `type` field để xử lý (init, metadata, detection, violation, complete)

### Khi thêm tính năng mới
- Backend: thêm route trong `routers/`, schema trong `schemas/`, model trong `models.py`
- Web: thêm page trong `app/`, component trong `components/`
- Mobile: thêm screen trong `screens/`, hook trong `screens/detection/` hoặc tạo folder mới

### Không làm
- Không hardcode URL backend — luôn dùng env variable hoặc config
- Không lưu password dạng plaintext — luôn dùng Argon2
- Không gửi token qua query params — luôn dùng Authorization header
- Không commit file .env, .pt models, node_modules, .venv, .next vào git
