"""Tests for Azure Neural TTS."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.tts.azure_tts import AzureTTS, FILLER_PHRASES, _escape_ssml, _split_sentences


class TestSSMLEscape:
    def test_ampersand(self):
        assert _escape_ssml("A & B") == "A &amp; B"

    def test_angle_brackets(self):
        assert _escape_ssml("<test>") == "&lt;test&gt;"

    def test_quotes(self):
        assert _escape_ssml('He said "hi"') == "He said &quot;hi&quot;"

    def test_apostrophe(self):
        assert _escape_ssml("it's") == "it&apos;s"

    def test_no_special_chars(self):
        text = "Góðan daginn"
        assert _escape_ssml(text) == text

    def test_combined(self):
        assert _escape_ssml('A & B <"test">') == "A &amp; B &lt;&quot;test&quot;&gt;"


class TestSplitSentences:
    def test_simple_sentences(self):
        text = "Halló. Hvernig hefur þú það? Vel."
        result = _split_sentences(text)
        assert result == ["Halló.", "Hvernig hefur þú það?", "Vel."]

    def test_single_sentence(self):
        text = "Góðan daginn."
        result = _split_sentences(text)
        assert result == ["Góðan daginn."]

    def test_preserves_abbreviation_td(self):
        text = "Þetta er t.d. mjög gott. Takk."
        result = _split_sentences(text)
        assert result == ["Þetta er t.d. mjög gott.", "Takk."]

    def test_preserves_abbreviation_osfrv(self):
        text = "Bílar, vélhjól o.s.frv. eru á lager."
        result = _split_sentences(text)
        assert result == ["Bílar, vélhjól o.s.frv. eru á lager."]

    def test_exclamation_and_question(self):
        text = "Frábært! Viltu vita meira? Já."
        result = _split_sentences(text)
        assert result == ["Frábært!", "Viltu vita meira?", "Já."]

    def test_no_punctuation(self):
        text = "Halló hvernig hefur þú það"
        result = _split_sentences(text)
        assert result == ["Halló hvernig hefur þú það"]

    def test_empty_string(self):
        result = _split_sentences("")
        assert result == [""]

    def test_multiple_abbreviations(self):
        text = "Sjá t.d. nr. tvö. Takk."
        result = _split_sentences(text)
        assert result == ["Sjá t.d. nr. tvö.", "Takk."]


class TestAzureTTSInit:
    def test_creates_with_defaults(self):
        tts = AzureTTS(
            speech_key="test-key",
            speech_region="northeurope",
        )
        assert tts._voice_name == "is-IS-GudrunNeural"
        assert tts._speech_region == "northeurope"

    def test_creates_with_custom_voice(self):
        tts = AzureTTS(
            speech_key="test-key",
            speech_region="northeurope",
            voice_name="is-IS-GunnarNeural",
        )
        assert tts._voice_name == "is-IS-GunnarNeural"


class TestAzureTTSBuildSSML:
    def test_default_ssml(self):
        tts = AzureTTS(
            speech_key="test-key",
            speech_region="northeurope",
        )
        ssml = tts._build_ssml("Halló")
        assert "is-IS-GudrunNeural" in ssml
        assert "is-IS" in ssml
        assert "Halló" in ssml
        assert "rate='+5%'" in ssml
        assert "pitch='+2%'" in ssml

    def test_escapes_special_chars(self):
        tts = AzureTTS(
            speech_key="test-key",
            speech_region="northeurope",
        )
        ssml = tts._build_ssml("A & B")
        assert "A &amp; B" in ssml


class TestAzureTTSSynthesize:
    @pytest.mark.asyncio
    async def test_synthesize_calls_azure(self):
        """Test that synthesize calls Azure SDK and converts to mulaw."""
        tts = AzureTTS(speech_key="test-key", speech_region="northeurope")

        # Mock the internal _synthesize_ssml to return fake PCM16 audio
        fake_pcm = b"\x00\x00" * 1600  # 100ms silence at 16kHz
        tts._synthesize_ssml = AsyncMock(return_value=fake_pcm)

        result = await tts.synthesize("Halló")

        assert isinstance(result, bytes)
        assert len(result) > 0
        tts._synthesize_ssml.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_synthesize_stream_yields_chunks(self):
        """Test that synthesize_stream yields audio chunks per sentence."""
        tts = AzureTTS(speech_key="test-key", speech_region="northeurope")

        fake_pcm = b"\x00\x00" * 800
        tts._synthesize_ssml = AsyncMock(return_value=fake_pcm)

        text = "Halló. Hvernig hefur þú það?"
        chunks = []
        async for chunk in tts.synthesize_stream(text):
            chunks.append(chunk)

        assert len(chunks) == 2  # Two sentences


class TestAzureTTSFillerCache:
    @pytest.mark.asyncio
    async def test_filler_cache_populated_on_warmup(self):
        """Test that warmup populates filler cache."""
        tts = AzureTTS(speech_key="test-key", speech_region="northeurope")

        fake_pcm = b"\x00\x00" * 800
        tts._synthesize_ssml = AsyncMock(return_value=fake_pcm)

        await tts.warmup()

        # Should cache all filler phrases
        assert len(tts._filler_cache) == len(FILLER_PHRASES)
        for key in FILLER_PHRASES:
            assert tts.get_filler_audio(key) is not None

    def test_get_filler_audio_missing_key(self):
        tts = AzureTTS(speech_key="test-key", speech_region="northeurope")
        assert tts.get_filler_audio("nonexistent") is None

    @pytest.mark.asyncio
    async def test_close_clears_cache(self):
        tts = AzureTTS(speech_key="test-key", speech_region="northeurope")
        tts._filler_cache["test"] = b"\x00"
        await tts.close()
        assert len(tts._filler_cache) == 0
