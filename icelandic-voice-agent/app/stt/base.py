"""Abstract base class for Speech-to-Text providers."""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field


@dataclass
class TranscriptionResult:
    """Final transcription result."""
    text: str
    confidence: float
    language: str = "is-IS"
    is_final: bool = True


@dataclass
class PartialTranscription:
    """Interim/partial transcription result from streaming."""
    text: str
    confidence: float
    is_final: bool
    stability: float = 0.0


class BaseSTT(ABC):
    """Abstract STT interface. Implementations can be swapped independently."""

    @abstractmethod
    async def transcribe(self, audio_data: bytes) -> TranscriptionResult:
        """Transcribe a complete audio segment.

        Args:
            audio_data: PCM16 16kHz mono audio bytes.

        Returns:
            TranscriptionResult with text and confidence.
        """

    @abstractmethod
    async def transcribe_stream(
        self, audio_stream: AsyncIterator[bytes]
    ) -> AsyncIterator[PartialTranscription]:
        """Stream audio and yield partial transcriptions.

        Args:
            audio_stream: Async iterator yielding PCM16 16kHz audio chunks.

        Yields:
            PartialTranscription objects (interim and final).
        """

    @abstractmethod
    async def warmup(self) -> None:
        """Warm up the STT connection (called at startup)."""

    @abstractmethod
    async def close(self) -> None:
        """Clean up resources."""
