"""Azure Neural TTS for Icelandic speech synthesis.

Azure has two native Icelandic neural voices:
- is-IS-GudrunNeural (Female) — recommended
- is-IS-GunnarNeural (Male)

Google Cloud TTS does NOT have Icelandic voices, so Azure is the only
viable major cloud provider for Icelandic TTS.
"""

import asyncio
from collections.abc import AsyncIterator

import azure.cognitiveservices.speech as speechsdk

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


class AzureTTS(BaseTTS):
    """Azure Neural TTS provider for Icelandic."""

    def __init__(
        self,
        speech_key: str,
        speech_region: str,
        voice_name: str = "is-IS-GudrunNeural",
    ):
        self._speech_key = speech_key
        self._speech_region = speech_region
        self._voice_name = voice_name
        self._filler_cache: dict[str, bytes] = {}

        self._speech_config = speechsdk.SpeechConfig(
            subscription=speech_key, region=speech_region
        )
        self._speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Raw16Khz16BitMonoPcm
        )
        self._speech_config.speech_synthesis_voice_name = voice_name

    def _build_ssml(self, text: str) -> str:
        """Build SSML for Icelandic TTS — no prosody tweaks for best pronunciation."""
        return (
            "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' "
            "xml:lang='is-IS'>"
            f"<voice name='{self._voice_name}'>"
            f"{_escape_ssml(text)}"
            "</voice></speak>"
        )

    async def synthesize(self, text: str) -> bytes:
        """Synthesize Icelandic text to raw PCM16 16kHz audio."""
        ssml = self._build_ssml(text)
        return await self._synthesize_ssml(ssml)

    async def _synthesize_ssml(self, ssml: str) -> bytes:
        """Synthesize SSML and return raw PCM16 16kHz audio."""
        loop = asyncio.get_event_loop()

        def _do_synthesis() -> bytes:
            synthesizer = speechsdk.SpeechSynthesizer(
                speech_config=self._speech_config, audio_config=None
            )
            result = synthesizer.speak_ssml_async(ssml).get()

            if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
                return result.audio_data
            elif result.reason == speechsdk.ResultReason.Canceled:
                cancellation = result.cancellation_details
                logger.error(
                    "tts_synthesis_canceled",
                    reason=str(cancellation.reason),
                    error=cancellation.error_details,
                )
                raise RuntimeError(
                    f"TTS synthesis canceled: {cancellation.error_details}"
                )
            else:
                raise RuntimeError(f"TTS synthesis failed: {result.reason}")

        return await loop.run_in_executor(None, _do_synthesis)

    async def synthesize_stream(self, text: str) -> AsyncIterator[bytes]:
        """Synthesize text and yield mulaw audio chunks as they're generated.

        Splits text at sentence boundaries and synthesizes each sentence
        independently for lower first-byte latency.
        """
        sentences = _split_sentences(text)
        for sentence in sentences:
            if sentence.strip():
                audio = await self.synthesize(sentence)
                yield audio

    def get_filler_audio(self, key: str) -> bytes | None:
        """Get pre-cached filler phrase audio."""
        return self._filler_cache.get(key)

    async def warmup(self) -> None:
        """Pre-synthesize filler phrases and warm up the connection."""
        logger.info("tts_warmup_start", voice=self._voice_name)

        # Warm up with a short test phrase
        try:
            await self.synthesize("Halló.")
            logger.info("tts_warmup_connection_ok")
        except Exception as e:
            logger.error("tts_warmup_failed", error=str(e))
            return

        # Pre-synthesize filler phrases
        for key, phrase in FILLER_PHRASES.items():
            try:
                audio = await self.synthesize(phrase)
                self._filler_cache[key] = audio
                logger.info("tts_filler_cached", key=key, phrase=phrase, size=len(audio))
            except Exception as e:
                logger.error("tts_filler_cache_failed", key=key, error=str(e))

        logger.info(
            "tts_warmup_complete",
            fillers_cached=len(self._filler_cache),
        )

    async def close(self) -> None:
        """Clean up resources."""
        self._filler_cache.clear()
        logger.info("tts_closed")


def _escape_ssml(text: str) -> str:
    """Escape special XML characters in SSML text content."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _split_sentences(text: str) -> list[str]:
    """Split text into sentences for chunked synthesis.

    Handles Icelandic abbreviations that should NOT trigger splits:
    t.d. (til dæmis), o.s.frv. (og svo framvegis), þ.e. (það er), etc.
    """
    import re

    # Protect common Icelandic abbreviations from splitting
    abbreviations = {
        "t.d.": "T_D_ABBR",
        "o.s.frv.": "OSF_ABBR",
        "þ.e.": "ÞE_ABBR",
        "m.a.": "MA_ABBR",
        "o.fl.": "OFL_ABBR",
        "þ.m.t.": "ÞMT_ABBR",
        "kr.": "KR_ABBR",
        "nr.": "NR_ABBR",
        "dr.": "DR_ABBR",
    }

    protected = text
    for abbr, placeholder in abbreviations.items():
        protected = protected.replace(abbr, placeholder)

    # Split on sentence-ending punctuation
    parts = re.split(r"(?<=[.!?])\s+", protected)

    # Restore abbreviations
    sentences = []
    for part in parts:
        restored = part
        for abbr, placeholder in abbreviations.items():
            restored = restored.replace(placeholder, abbr)
        sentences.append(restored)

    return sentences
