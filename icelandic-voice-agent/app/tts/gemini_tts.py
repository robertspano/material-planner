"""Google Gemini TTS for Icelandic speech synthesis.

Uses gemini-2.5-flash-preview-tts which supports 60+ languages including
Icelandic (is). The model auto-detects language from the input text.

Gemini TTS produces much more natural-sounding speech than traditional
TTS engines because it's built on a large language model that understands
context, tone, and natural pacing.

Available voices (30): Zephyr, Puck, Charon, Kore, Fenrir, Leda, Orus,
Aoede, Callirrhoe, Autonoe, Enceladus, Iapetus, Umbriel, Algieba,
Despina, Erinome, Algenib, Rasalgethi, Laomedeia, Achernar, Alnilam,
Schedar, Gacrux, Pulcherrima, Achird, Zubenelgenubi, Vindemiatrix,
Sadachbia, Sadaltager, Sulafat

Output: PCM16 24kHz mono
"""

import asyncio
import time
from collections.abc import AsyncIterator

from google import genai
from google.genai import types

from app.tts.base import BaseTTS
from app.utils.logging import get_logger

logger = get_logger(__name__)

FILLER_PHRASES: dict[str, str] = {
    "thinking": "Augnablik...",
    "checking": "Ég er að athuga það...",
}

# Max retries for rate-limited requests
MAX_RETRIES = 3
RETRY_DELAY_S = 2.0


class GeminiTTS(BaseTTS):
    """Google Gemini TTS provider for Icelandic."""

    def __init__(
        self,
        api_key: str,
        voice_name: str = "Kore",
        model: str = "gemini-2.5-flash-preview-tts",
    ):
        self._client = genai.Client(api_key=api_key)
        self._voice_name = voice_name
        self._model = model
        self._filler_cache: dict[str, bytes] = {}

        # Build the speech config once
        self._speech_config = types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=voice_name,
                )
            )
        )

    @property
    def output_sample_rate(self) -> int:
        """Gemini TTS outputs PCM16 at 24kHz."""
        return 24000

    async def synthesize(self, text: str) -> bytes:
        """Synthesize Icelandic text to raw PCM16 24kHz audio.

        Includes retry logic for rate limiting.

        Returns:
            Raw PCM16 24kHz mono audio bytes.
        """
        loop = asyncio.get_event_loop()

        def _do_synthesis() -> bytes:
            # Gemini TTS needs clear instruction to read the text aloud
            prompt = f"Segðu eftirfarandi texta á íslensku: {text}"
            response = self._client.models.generate_content(
                model=self._model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=self._speech_config,
                ),
            )

            # Safely extract audio data
            if (
                not response.candidates
                or not response.candidates[0].content
                or not response.candidates[0].content.parts
            ):
                raise RuntimeError("Gemini TTS returned empty response")

            part = response.candidates[0].content.parts[0]
            if not hasattr(part, "inline_data") or not part.inline_data:
                raise RuntimeError("Gemini TTS response has no audio data")

            return part.inline_data.data

        last_error = None
        for attempt in range(MAX_RETRIES):
            try:
                audio_data = await loop.run_in_executor(None, _do_synthesis)

                logger.info(
                    "gemini_tts_synthesized",
                    text=text[:80],
                    audio_bytes=len(audio_data),
                    voice=self._voice_name,
                    attempt=attempt + 1,
                )

                return audio_data

            except Exception as e:
                last_error = e
                error_str = str(e)

                # Retry on rate limit (429) errors
                if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
                    wait_time = RETRY_DELAY_S * (attempt + 1)
                    logger.warning(
                        "gemini_tts_rate_limited",
                        attempt=attempt + 1,
                        wait_s=wait_time,
                        text=text[:50],
                    )
                    await asyncio.sleep(wait_time)
                    continue

                # Retry on empty response
                if "empty response" in error_str:
                    logger.warning(
                        "gemini_tts_empty_response",
                        attempt=attempt + 1,
                        text=text[:50],
                    )
                    await asyncio.sleep(RETRY_DELAY_S)
                    continue

                # Non-retryable error
                logger.error(
                    "gemini_tts_error",
                    error=error_str,
                    error_type=type(e).__name__,
                    text=text[:100],
                )
                raise

        logger.error(
            "gemini_tts_all_retries_failed",
            error=str(last_error),
            text=text[:100],
        )
        raise last_error

    async def synthesize_stream(self, text: str) -> AsyncIterator[bytes]:
        """Synthesize text — Gemini TTS doesn't support streaming,
        so we just yield the full audio as one chunk."""
        audio = await self.synthesize(text)
        yield audio

    def get_filler_audio(self, key: str) -> bytes | None:
        """Get pre-cached filler phrase audio."""
        return self._filler_cache.get(key)

    async def warmup(self) -> None:
        """Warm up the connection and cache essential filler phrases.

        Only caches 2 fillers to stay within rate limits (10 req/min on free tier).
        """
        logger.info(
            "gemini_tts_warmup_start",
            voice=self._voice_name,
            model=self._model,
        )

        # Warm up with a test phrase
        try:
            await self.synthesize("Góðan daginn, velkomin.")
            logger.info("gemini_tts_warmup_connection_ok")
        except Exception as e:
            logger.error("gemini_tts_warmup_failed", error=str(e))
            return

        # Only cache the most essential fillers (rate limit: 10/min)
        await asyncio.sleep(1)  # Small delay to avoid rate limiting
        for key, phrase in FILLER_PHRASES.items():
            try:
                await asyncio.sleep(1)  # Pace requests
                audio = await self.synthesize(phrase)
                self._filler_cache[key] = audio
                logger.info(
                    "gemini_tts_filler_cached",
                    key=key,
                    phrase=phrase,
                    size=len(audio),
                )
            except Exception as e:
                logger.error(
                    "gemini_tts_filler_cache_failed", key=key, error=str(e)
                )

        logger.info(
            "gemini_tts_warmup_complete",
            fillers_cached=len(self._filler_cache),
        )

    async def close(self) -> None:
        """Clean up resources."""
        self._filler_cache.clear()
        logger.info("gemini_tts_closed")
