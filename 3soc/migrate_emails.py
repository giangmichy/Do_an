"""
Script to encrypt plain-text emails in the database.

Run this once if some users were created before email encryption was enabled.
Usage: cd 3soc && python migrate_emails.py
"""

import base64
import sys

sys.path.insert(0, ".")

from app.config import ENCRYPTION_KEY
from app.db.db import SessionLocal, engine
from app.db.models import User
from app.utils.crypto import encrypt_bytes


def is_plain_email(email: str) -> bool:
    """Check if email is plain text (not encrypted)."""
    if not email:
        return False
    # Plain emails always contain @
    if "@" not in email:
        return False
    # Encrypted emails are base64, typically start with uppercase letters (random nonce)
    # and don't contain @
    return True


def is_already_encrypted(email: str) -> bool:
    """Check if email is already in encrypted (base64) form."""
    if not email or "@" in email:
        return False
    try:
        decoded = base64.b64decode(email)
        # Encrypted emails are at least 12 bytes (nonce) + some ciphertext
        return len(decoded) >= 16
    except Exception:
        return False


def migrate_emails():
    db = SessionLocal()
    try:
        users = db.query(User).all()
        total = len(users)
        migrated = 0
        skipped = 0

        print(f"Found {total} users in database.")
        print(f"Using ENCRYPTION_KEY: {base64.b64encode(ENCRYPTION_KEY).decode()}")
        print("-" * 60)

        for user in users:
            if is_already_encrypted(user.email):
                print(f"  SKIP id={user.id} ({user.username}): email already encrypted")
                skipped += 1
                continue

            if not user.email:
                print(f"  SKIP id={user.id} ({user.username}): empty email")
                skipped += 1
                continue

            print(f"  MIGRATE id={user.id} ({user.username}): {user.email} -> encrypted")
            user.email = base64.b64encode(encrypt_bytes(user.email.encode(), ENCRYPTION_KEY)).decode()
            migrated += 1

        if migrated > 0:
            db.commit()
            print("-" * 60)
            print(f"Done! Migrated {migrated}, skipped {skipped} users.")
        else:
            print("-" * 60)
            print("No migrations needed. All emails are already encrypted.")

    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}", file=sys.stderr)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    migrate_emails()
