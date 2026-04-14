"""
Schema migration script for `video_files`.

Changes:
- Add `type` column (video/image) if missing
- Backfill null/empty `type` to "video"
- Add index `ix_video_files_type` if missing
- Drop legacy `status` column if present

Usage:
  cd 3soc
  python migrate_video_files_schema.py
"""

import sys

sys.path.insert(0, ".")

from sqlalchemy import inspect, text

from app.db.db import engine


def migrate_video_files_schema() -> None:
    inspector = inspect(engine)

    if "video_files" not in inspector.get_table_names():
        print("[MIGRATE] Table `video_files` not found. Skip.")
        return

    columns = {c.get("name") for c in inspector.get_columns("video_files")}
    indexes = {i.get("name") for i in inspector.get_indexes("video_files")}

    with engine.begin() as conn:
        if "type" not in columns:
            conn.execute(
                text(
                    "ALTER TABLE video_files "
                    "ADD COLUMN type VARCHAR(16) NOT NULL DEFAULT 'video'"
                )
            )
            print("[MIGRATE] Added column `video_files.type`.")
        else:
            print("[MIGRATE] Column `video_files.type` already exists.")

        conn.execute(
            text(
                "UPDATE video_files "
                "SET type = 'video' "
                "WHERE type IS NULL OR TRIM(type) = ''"
            )
        )
        print("[MIGRATE] Backfilled empty `type` values to 'video'.")

        if "ix_video_files_type" not in indexes:
            conn.execute(text("CREATE INDEX ix_video_files_type ON video_files (type)"))
            print("[MIGRATE] Added index `ix_video_files_type`.")
        else:
            print("[MIGRATE] Index `ix_video_files_type` already exists.")

        if "status" in columns:
            conn.execute(text("ALTER TABLE video_files DROP COLUMN status"))
            print("[MIGRATE] Dropped legacy column `video_files.status`.")
        else:
            print("[MIGRATE] Column `video_files.status` already removed.")

    print("[MIGRATE] Done.")


if __name__ == "__main__":
    migrate_video_files_schema()
