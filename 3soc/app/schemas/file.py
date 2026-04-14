from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List
from app.schemas.response import PaginationMeta


class UserInfoBasic(BaseModel):
    id: int
    username: str
    email: str

    class Config:
        from_attributes = True


class VideoFileBase(BaseModel):
    type: str = "video"
    filename: str
    filepath: str
    file_size: Optional[int] = None
    duration: Optional[float] = None


class VideoFileCreate(VideoFileBase):
    user_id: Optional[int] = None


class VideoFileUpdate(BaseModel):
    duration: Optional[float] = None


class VideoFileResponse(VideoFileBase):
    id: str
    user_id: Optional[int] = None
    created_at: datetime
    owner: Optional[UserInfoBasic] = None

    class Config:
        from_attributes = True


class VideoFileListResponse(BaseModel):
    items: List[VideoFileResponse]
    meta: PaginationMeta
