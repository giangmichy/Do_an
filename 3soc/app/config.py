import os
import base64
from pathlib import Path
from dotenv import load_dotenv

# Load .env file from the project root (3soc/)
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _get_encryption_key() -> bytes:
    """Load ENCRYPTION_KEY from env. Must be set — no auto-generation."""
    raw = os.getenv("ENCRYPTION_KEY")
    if not raw:
        raise ValueError(
            "ENCRYPTION_KEY is not set in .env. "
            "Please add a base64-encoded 32-byte key to .env file."
        )
    return base64.b64decode(raw)


ENCRYPTION_KEY = _get_encryption_key()

# =========================
# Database
# =========================
DATABASE_URL = os.getenv("DATABASE_URL", "mysql+pymysql://root:1234567890@localhost/detect_3soc")

# =========================
# JWT / Auth
# =========================
SECRET_KEY = os.getenv("SECRET_KEY")
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