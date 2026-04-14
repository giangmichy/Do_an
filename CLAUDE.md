# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**3SOC** is an AI-powered sovereignty violation detection system. It detects Vietnamese national flag violations (Cờ 3 sọc, Đường lưỡi bò, incorrect Vietnam maps) in images and videos using YOLO models.

The repository is a monorepo with 3 components:

| Component | Path | Stack | Purpose |
|-----------|------|-------|---------|
| Backend | `3soc/` | FastAPI + Python + YOLOv8 + MySQL | API server, AI inference, file storage |
| Mobile App | `3soc-app/` | React Native (Expo) + TypeScript | Mobile client for detection |
| Admin Web | `3soc-admin-web/` | Next.js + Tailwind + shadcn/ui | Web admin dashboard |

---

## Development Commands

### Backend (`3soc/`)

```bash
# Setup (first time)
python -m venv venv
venv\Scripts\activate       # Windows
pip install -r requirements.txt

# Start server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Or use the auto-setup script
run.bat
```

- API docs: http://localhost:8000/docs
- Requires MySQL running. Create DB: `CREATE DATABASE detect_3soc CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
- `.env` file needed: `DATABASE_URL=mysql+pymysql://root:PASSWORD@localhost/detect_3soc` + `SECRET_KEY=...` + `ENCRYPTION_KEY=<base64 32-byte key>`
- Place YOLO `.pt` model files in `models/` directory: `3soc.pt`, `duongluoibo.pt`, `vnmap.pt`
- Tables auto-create on startup, default users seeded: `admin/admin123`, `user/user123`
- If `ENCRYPTION_KEY` is missing, app generates one and prints a warning — save it to `.env` to avoid data loss on restart

### Mobile App (`3soc-app/`)

```bash
cd 3soc-app
npm install
npx expo start        # Start dev server
npx expo start --android   # Launch on Android emulator
```

- Edit `src/config.ts` to point to the backend URL
- Default credentials: `admin/admin123` or `user/user123`

### Admin Web (`3soc-admin-web/`)

```bash
cd 3soc-admin-web
npm install
npm run dev           # Start Next.js dev server
```

- Uses App Router structure, shadcn/ui components
- Backend URL configured in `app/api.ts`

---

## Architecture

### Backend (`3soc/`)

```
3soc/
├── app/
│   ├── main.py          # FastAPI entry: CORS, routers, model warm-up, seed users
│   ├── config.py        # Upload directory paths
│   ├── db/
│   │   ├── db.py        # MySQL connection, table auto-creation
│   │   └── models.py    # SQLAlchemy models: User, VideoFile, Violation
│   ├── routers/
│   │   ├── users.py     # Auth + user CRUD (register, login, admin management)
│   │   └── files.py     # Upload, detect (image + video SSE), delete
│   ├── schemas/         # Pydantic request/response schemas
│   └── utils/
│       ├── auth.py      # JWT + Argon2 password hashing
│       ├── tasks.py     # YOLO inference on frames/images
│       ├── crypto.py    # AES-256-GCM encryption (email, video, violation images)
│       └── rate_limiter.py  # In-memory sliding window rate limiter
├── models/              # YOLO .pt files (not in git)
├── uploads/             # Uploaded videos + violation thumbnails
└── infer_yolo.py        # Standalone YOLO inference script
```

**Key flows:**
- **Video detection (SSE)**: `POST /api/files/upload` → `GET /api/files/{id}/detect-stream`. Backend streams SSE events: `init` → `metadata` → `detection` (every frame) → `violation` (saved frames only) → `complete`. Caches results in DB — re-detecting the same video returns cached violations without running AI.
- **Image detection**: `POST /api/files/detect-image` — instant detection, nothing saved to DB.
- **Cooldown system**: Two-layer dedup — per-label cooldown (200ms) + global image save cooldown (2000ms) to avoid storing duplicate violation frames.

### Database Schema

```
users (1) ──── (N) video_files (1) ──── (N) violations (cascade delete)
```

- `users`: id, username, email, password_hash (Argon2), role (user/admin), is_active
- `video_files`: id (string, frontend-generated), filename, filepath, user_id, status, detection_id
- `violations`: video_id, frame_number, timestamp, image_path, detections (JSON with bbox + label + confidence)

### Mobile App (`3soc-app/`)

```
3soc-app/src/
├── api.ts                     # HTTP calls to backend
├── config.ts                  # Backend URL
├── contexts/AuthContext.tsx   # Auth state + JWT token management
├── components/
│   └── BoundingBoxOverlay.tsx # Draws bounding boxes on video/image
└── screens/
    ├── DetectionScreen.tsx    # Main screen: file picker, results, video player
    ├── FilesScreen.tsx
    ├── LoginScreen.tsx
    ├── SettingsScreen.tsx
    ├── UsersScreen.tsx
    └── detection/
        ├── types.ts           # ViolationFrame, Detection, MediaType types
        └── useRealtimeVideoDetection.ts  # SSE hook + detection state management
```

**Video bbox sync**: Uses 2 parallel loops — rAF (60fps) reads a ref for current position and updates boxes, plus a 100ms `setInterval` that calls `getStatusAsync()` to keep the ref accurate. Boxes only display within `BOX_STALE_MS` (200ms) window.

### Admin Web (`3soc-admin-web/`)

Next.js App Router with shadcn/ui components. Pages: login, dashboard, files, users, settings.

---

## AI Models

Three YOLO models detect specific violations:

| Label | Model File | Detection | BBox Color |
|-------|-----------|-----------|------------|
| `co3soc` | `models/3soc.pt` | Cờ 3 sọc | Red `#ef4444` |
| `duongluoibo` | `models/duongluoibo.pt` | Đường lưỡi bò | Green `#22c55e` |
| `vnmap` | `models/vnmap.pt` | Incorrect Vietnam map | Blue `#3b82f6` |

Models auto-load on backend startup with GPU (CUDA) fallback to CPU. Warm-up runs on a dummy frame to reduce first-inference latency.

---

## Security Mechanisms

| Mechanism | Details |
|-----------|---------|
| **Rate Limiting** | Login: 5 attempts/min/IP. Register: 3 attempts/10min/IP. Sliding window, thread-safe. |
| **Authentication** | All endpoints require JWT except login/register. `detect-stream` accepts `?token=` query param for SSE. Ownership check: users only see/delete own files. |
| **AES-256-GCM** | Email in DB encrypted. Video files encrypted (`.mp4.enc`) — decrypted to temp for cv2. Violation images encrypted (`.jpg.enc`) — decrypted on-the-fly by `/uploads/{path}` endpoint. |
| **File Size Limits** | Video: 100 MB. Image: 10 MB. Content-Type validated (`video/*`, `image/*`). |
| **Password** | Min 6 chars (Pydantic validator). Hashed with Argon2. |
| **SQL Injection** | Mitigated via SQLAlchemy ORM parameterized queries. |

## Important Notes

- The `3soc/venv/` and `3soc-admin-web/node_modules/` and `3soc-app/node_modules/` are large — avoid globbing without excluding them
- Model `.pt` files are NOT in git — they must be placed manually in `3soc/models/`
- Current git branch: `v2` (main branch is `main`)
- All API endpoints require JWT auth except login, register, and detect-stream
