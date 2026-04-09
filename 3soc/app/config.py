import os
import base64
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _get_or_generate_encryption_key() -> bytes:
    """Load ENCRYPTION_KEY from env, or generate and print a new one."""
    raw = os.getenv("ENCRYPTION_KEY")
    if raw:
        return base64.b64decode(raw)
    # Generate a random 32-byte key and print it so the admin can save it
    key = os.urandom(32)
    print(f"[WARN] ENCRYPTION_KEY not set. Generated random key: {base64.b64encode(key).decode()}")
    print("[WARN] Save this key to .env as ENCRYPTION_KEY before restarting!")
    return key


ENCRYPTION_KEY = _get_or_generate_encryption_key()

# =========================
# Database
# =========================
DATABASE_URL = os.getenv("DATABASE_URL", "mysql+pymysql://root:1234567890@localhost/detect_3soc")

# =========================
# JWT / Auth
# =========================
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-this-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

# =========================
# Password
# =========================
PASSWORD_MIN_LENGTH = 6

# =========================
# Rate Limiting
# =========================
LOGIN_MAX_ATTEMPTS = 5           # per IP
LOGIN_WINDOW_SECONDS = 60        # 1 minute

REGISTER_MAX_ATTEMPTS = 3        # per IP
REGISTER_WINDOW_SECONDS = 600    # 10 minutes

# =========================
# File Upload Size Limits
# =========================
MAX_VIDEO_SIZE = 100 * 1024 * 1024    # 100 MB
MAX_IMAGE_SIZE = 10 * 1024 * 1024     # 10 MB