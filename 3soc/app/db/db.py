from sqlalchemy import create_engine
from sqlalchemy import inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.config import DATABASE_URL

engine = create_engine(DATABASE_URL, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def init_db():
    # Import models here to register them with Base before create_all
    try:
        import app.db.models  # noqa: F401
    except Exception:
        pass
    Base.metadata.create_all(bind=engine)
    _migrate_video_files_type_column()
    _migrate_drop_video_files_status_column()


def _migrate_video_files_type_column():
    inspector = inspect(engine)
    try:
        if "video_files" not in inspector.get_table_names():
            return

        columns = {c.get("name") for c in inspector.get_columns("video_files")}
        if "type" in columns:
            return

        with engine.begin() as conn:
            conn.execute(
                text("ALTER TABLE video_files ADD COLUMN type VARCHAR(16) NOT NULL DEFAULT 'video'")
            )
    except Exception as e:
        print(f"[WARN] Failed to migrate video_files.type column: {e}")


def _migrate_drop_video_files_status_column():
    inspector = inspect(engine)
    try:
        if "video_files" not in inspector.get_table_names():
            return

        columns = {c.get("name") for c in inspector.get_columns("video_files")}
        if "status" not in columns:
            return

        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE video_files DROP COLUMN status"))
    except Exception as e:
        print(f"[WARN] Failed to drop video_files.status column: {e}")
