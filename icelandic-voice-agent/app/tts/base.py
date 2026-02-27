"""Abstract base class for Text-to-Speech providers."""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass


@dataclass
class TTSResult:
    """Result from a TTS synthesis request."""
    audio_data: bytes  # mulaw 8kHz for Twilio
    duration_ms: int
    voice: str


class BaseTTS(ABC):
    """Abstract TTS interface. Implementations can be swapped independently."""

    @property
    def output_sample_rate(self) -> int:
        """Sample rate of the PCM16 audio returned by synthesize().

        Override in subclasses if different from 16kHz.
        Azure TTS = 16000, OpenAI TTS = 24000.
        """
        return 16000

    @abstractmethod
    async def synthesize(self, text: str) -> bytes:
        """Synthesize text to audio.

        Args:
            text: Text to synthesize (Icelandic).

        Returns:
            Audio bytes in mulaw 8kHz format for Twilio.
        """

    @abstractmethod
    async def synthesize_stream(self, text: str) -> AsyncIterator[bytes]:
        """Synthesize text and yield audio chunks as they're generated.

        Args:
            text: Text to synthesize (Icelandic).

        Yields:
            Audio byte chunks in mulaw 8kHz format.
        """

    @abstractmethod
    def get_filler_audio(self, key: str) -> bytes | None:
        """Get pre-cached filler phrase audio.

        Args:
            key: Filler phrase key (e.g., "Augnablik...").

        Returns:
            Pre-synthesized mulaw 8kHz audio bytes, or None if not cached.
        """

    @abstractmethod
    async def warmup(self) -> None:
        """Warm up the TTS connection (called at startup)."""

    @abstractmethod
    async def close(self) -> None:
        """Clean up resources."""
