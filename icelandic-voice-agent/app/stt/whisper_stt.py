"""Whisper STT fallback for Icelandic speech recognition.

Two options:
- Option A: OpenAI Whisper API (higher latency, no local GPU needed)
- Option B: Self-hosted fine-tuned Whisper from Reykjavík University
  (model: language-and-voice-lab/whisper-large-icelandic-62640-steps-967h)

This implementation uses Option A (OpenAI API) for simplicity.
"""

import asyncio
import io
import wave
from collections.abc import AsyncIterator

from app.stt.base import BaseSTT, PartialTranscription, TranscriptionResult
from app.utils.logging import get_logger

logger = get_logger(__name__)


class WhisperSTT(BaseSTT):
    """OpenAI Whisper API fallback for Icelandic STT."""

    def __init__(self, api_key: str):
        self._api_key = api_key
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                from openai import OpenAI
                self._client = OpenAI(api_key=self._api_key)
            except ImportError:
                raise RuntimeError(
                    "openai package required for Whisper STT. "
                    "Install with: pip install openai"
                )
        return self._client

    def _pcm16_to_wav(self, audio_data: bytes, sample_rate: int = 16000) -> bytes:
        """Wrap raw PCM16 in a WAV container for the OpenAI API."""
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(audio_data)
        return buf.getvalue()

    async def transcribe(self, audio_data: bytes) -> TranscriptionResult:
        """Transcribe audio using OpenAI Whisper API.

        Args:
            audio_data: PCM16 16kHz mono audio bytes.
        """
        loop = asyncio.get_event_loop()

        def _do_transcribe() -> TranscriptionResult:
            client = self._get_client()
            wav_data = self._pcm16_to_wav(audio_data)
            wav_file = io.BytesIO(wav_data)
            wav_file.name = "audio.wav"

            response = client.audio.transcriptions.create(
                model="whisper-1",
                file=wav_file,
                language="is",
                response_format="verbose_json",
            )

            return TranscriptionResult(
                text=response.text,
                confidence=1.0 - (getattr(response, "no_speech_prob", 0.0) or 0.0),
                language="is-IS",
            )

        return await loop.run_in_executor(None, _do_transcribe)

    async def transcribe_stream(
        self, audio_stream: AsyncIterator[bytes]
    ) -> AsyncIterator[PartialTranscription]:
        """Whisper API does not support true streaming.

        Buffers all audio then transcribes as a single batch.
        Yields one final result.
        """
        buffer = bytearray()
        async for chunk in audio_stream:
            buffer.extend(chunk)

        if buffer:
            result = await self.transcribe(bytes(buffer))
            yield PartialTranscription(
                text=result.text,
                confidence=result.confidence,
                is_final=True,
                stability=1.0,
            )

    async def warmup(self) -> None:
        """Warm up the Whisper API connection."""
        logger.info("whisper_stt_warmup_start")
        try:
            self._get_client()
            logger.info("whisper_stt_warmup_complete")
        except Exception as e:
            logger.error("whisper_stt_warmup_failed", error=str(e))

    async def close(self) -> None:
        """Clean up resources."""
        self._client = None
        logger.info("whisper_stt_closed")
