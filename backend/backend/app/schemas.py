from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class EmotionNode(BaseModel):
    time: int = Field(ge=0)
    emotion: str
    intensity: float = Field(ge=0, le=1)


class ProjectCreate(BaseModel):
    title: str
    theme: str
    scene: str
    duration: int = Field(default=60, ge=10, le=600)
    style: str
    vocal: bool = False


class Project(ProjectCreate):
    id: str
    emotion_nodes: List[EmotionNode] = []


class EmotionTrackUpdate(BaseModel):
    nodes: List[EmotionNode]


class MusicPlan(BaseModel):
    id: str
    project_id: str
    structure: str
    bpm: int
    key: str
    instruments: List[str]
    description: str
    prompt: str


class GenerationStatus(str, Enum):
    pending = "pending"
    running = "running"
    success = "success"
    failed = "failed"


class GenerationCreate(BaseModel):
    plan_id: Optional[str] = None
    prompt: Optional[str] = None
    duration: Optional[int] = None
    audio_format: str = "wav"


class Generation(BaseModel):
    id: str
    project_id: str
    status: GenerationStatus
    prompt: str
    audio_url: Optional[str] = None
    error: Optional[str] = None
    provider: str = "mock"


class RepaintCreate(BaseModel):
    start_time: int = Field(ge=0)
    end_time: int = Field(ge=1)
    instruction: str
