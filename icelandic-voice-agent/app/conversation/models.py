"""Pydantic models for conversation data."""

from datetime import UTC, datetime
from enum import Enum
from functools import partial

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Role(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"


class Message(BaseModel):
    """A single message in a conversation."""
    role: Role
    content: str
    timestamp: datetime = Field(default_factory=_utcnow)


class ConversationMetadata(BaseModel):
    """Metadata about a conversation/call."""
    call_sid: str
    caller: str
    started_at: datetime = Field(default_factory=_utcnow)
    turn_count: int = 0
    topics: list[str] = Field(default_factory=list)


class CallEvent(BaseModel):
    """An event during a call (for logging/analytics)."""
    event_type: str  # "stt_result", "tts_start", "tool_call", "error", etc.
    timestamp: datetime = Field(default_factory=_utcnow)
    data: dict = Field(default_factory=dict)
