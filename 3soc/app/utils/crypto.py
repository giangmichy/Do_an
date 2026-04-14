"""AES-256-GCM encryption utilities for data at rest."""

import os
import tempfile
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _get_aesgcm(key: bytes) -> AESGCM:
    return AESGCM(key)


def encrypt_bytes(data: bytes, key: bytes) -> bytes:
    """Encrypt raw bytes, returning nonce + ciphertext."""
    nonce = os.urandom(12)
    ct = _get_aesgcm(key).encrypt(nonce, data, None)
    return nonce + ct


def decrypt_bytes(token: bytes, key: bytes) -> bytes:
    """Decrypt nonce + ciphertext back to plaintext."""
    nonce, ct = token[:12], token[12:]
    return _get_aesgcm(key).decrypt(nonce, ct, None)


def encrypt_file(plaintext_path: str, encrypted_path: str, key: bytes) -> None:
    """Encrypt a file on disk in-place (read plaintext, write encrypted)."""
    with open(plaintext_path, "rb") as f:
        data = f.read()
    encrypted = encrypt_bytes(data, key)
    with open(encrypted_path, "wb") as f:
        f.write(encrypted)


def decrypt_file_to_temp(encrypted_path: str, key: bytes) -> str:
    """Decrypt an encrypted file to a temp file. Returns temp path; caller must delete."""
    with open(encrypted_path, "rb") as f:
        data = f.read()
    plaintext = decrypt_bytes(data, key)
    fd, tmp_path = tempfile.mkstemp()
    with os.fdopen(fd, "wb") as f:
        f.write(plaintext)
    return tmp_path
