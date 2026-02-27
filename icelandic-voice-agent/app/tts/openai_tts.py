"""OpenAI TTS for Icelandic speech synthesis.

Uses the gpt-4o-mini-tts model which supports Icelandic and produces
much more natural-sounding speech than Azure Neural TTS.

Supported voices: alloy, ash, ballad, coral, echo, fable, onyx, nova,
sage, shimmer, verse, marin, cedar.

The 'instructions' parameter lets us guide tone/style — perfect for
making Sunna sound natural and friendly in Icelandic.
"""

import asyncio
from collections.abc import AsyncIterator

from openai import AsyncOpenAI

from app.tts.base import BaseTTS
from app.utils.logging import get_logger

logger = get_logger(__name__)

FILLER_PHRASES: dict[str, str] = {
    "thinking": "Augnablik...",
    "checking": "Ég er að athuga það...",
    "wait": "Jæja, gefðu mér smá stund...",
    "looking_up": "Ég er að fletta því upp...",
    "checking_for_you": "Augnablik, ég er að athuga það fyrir þig.",
}

# Instructions for the TTS model — tells it HOW to speak
ICELANDIC_VOICE_INSTRUCTIONS = (
    "Talaðu íslensku. Þú ert Sunna, vingjarnleg kona sem svarar símanum hjá bílasölu. "
    "Talaðu eins og þú sért að spjalla við vin í síma. Vertu náttúruleg, hlý og hress. "
    "Ekki vera formleg eða vélræn. Talaðu á eðlilegum hraða."
)


class OpenAITTS(BaseTTS):
    """OpenAI TTS provider for Icelandic using gpt-4o-mini-tts."""

    def __init__(
        self,
        api_key: str,
        voice: str = "nova",
        model: str = "gpt-4o-mini-tts",
        instructions: str | None = None,
    ):
        self._client = AsyncOpenAI(api_key=api_key)
        self._voice = voice
        self._model = model
        self._instructions = instructions or ICELANDIC_VOICE_INSTRUCTIONS
        self._filler_cache: dict[str, bytes] = {}

    @property
    def output_sample_rate(self) -> int:
        """OpenAI TTS PCM output is 24kHz 16-bit mono."""
        return 24000

    async def synthesize(self, text: str) -> bytes:
        """Synthesize Icelandic text to raw PCM16 24kHz audio.

        OpenAI TTS pcm format outputs 24kHz 16-bit mono PCM.
        The media_stream handler will convert this to mulaw 8kHz for Twilio.
        """
        try:
            response = await self._client.audio.speech.create(
                model=self._model,
                voice=self._voice,
                input=text,
                instructions=self._instructions,
                response_format="pcm",  # Raw PCM16 24kHz mono
            )

            audio_data = response.content

            logger.info(
                "openai_tts_synthesized",
                text=text[:80],
                audio_bytes=len(audio_data),
                voice=self._voice,
                model=self._model,
            )

            return audio_data

        except Exception as e:
            logger.error(
                "openai_tts_error",
                error=str(e),
                error_type=type(e).__name__,
                text=text[:100],
            )
            raise

    async def synthesize_stream(self, text: str) -> AsyncIterator[bytes]:
        """Synthesize text and yield PCM audio chunks as they stream in.

        Uses OpenAI streaming response for lower first-byte latency.
        """
        try:
            async with self._client.audio.speech.with_streaming_response.create(
                model=self._model,
                voice=self._voice,
                input=text,
                instructions=self._instructions,
                response_format="pcm",
            ) as response:
                async for chunk in response.iter_bytes(chunk_size=4096):
                    yield chunk

        except Exception as e:
            logger.error(
                "openai_tts_stream_error",
                error=str(e),
                text=text[:100],
            )
            raise

    def get_filler_audio(self, key: str) -> bytes | None:
        """Get pre-cached filler phrase audio."""
        return self._filler_cache.get(key)

    async def warmup(self) -> None:
        """Pre-synthesize filler phrases and warm up the connection."""
        logger.info("openai_tts_warmup_start", voice=self._voice, model=self._model)

        # Warm up with a short test phrase
        try:
            await self.synthesize("Halló.")
            logger.info("openai_tts_warmup_connection_ok")
        except Exception as e:
            logger.error("openai_tts_warmup_failed", error=str(e))
            return

        # Pre-synthesize filler phrases
        for key, phrase in FILLER_PHRASES.items():
            try:
                audio = await self.synthesize(phrase)
                self._filler_cache[key] = audio
                logger.info(
                    "openai_tts_filler_cached",
                    key=key,
                    phrase=phrase,
                    size=len(audio),
                )
            except Exception as e:
                logger.error(
                    "openai_tts_filler_cache_failed", key=key, error=str(e)
                )

        logger.info(
            "openai_tts_warmup_complete",
            fillers_cached=len(self._filler_cache),
        )

    async def close(self) -> None:
        """Clean up resources."""
        self._filler_cache.clear()
        await self._client.close()
        logger.info("openai_tts_closed")
