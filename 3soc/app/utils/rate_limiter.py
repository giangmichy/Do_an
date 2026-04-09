"""Simple in-memory rate limiter for API endpoints."""

import time
from collections import defaultdict
from threading import Lock
from fastapi import HTTPException, status, Request
from app.config import (
    LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS,
    REGISTER_MAX_ATTEMPTS, REGISTER_WINDOW_SECONDS,
)


class RateLimiter:
    """Sliding window rate limiter stored in memory.

    Tracks requests per IP and blocks when limits are exceeded.
    """

    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._store: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def _cleanup(self, key: str, now: float) -> None:
        cutoff = now - self.window_seconds
        self._store[key] = [ts for ts in self._store[key] if ts > cutoff]

    def is_allowed(self, key: str) -> bool:
        now = time.time()
        with self._lock:
            self._cleanup(key, now)
            if len(self._store[key]) >= self.max_requests:
                return False
            self._store[key].append(now)
            return True

    def check(self, key: str) -> None:
        if not self.is_allowed(key):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please try again later.",
            )


# Global rate limiter instances
login_limiter = RateLimiter(max_requests=LOGIN_MAX_ATTEMPTS, window_seconds=LOGIN_WINDOW_SECONDS)

register_limiter = RateLimiter(max_requests=REGISTER_MAX_ATTEMPTS, window_seconds=REGISTER_WINDOW_SECONDS)


def get_client_ip(request: Request) -> str:
    """Extract client IP, respecting X-Forwarded-For if behind proxy."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
