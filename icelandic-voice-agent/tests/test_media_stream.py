"""Tests for Twilio Media Stream handler."""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.telephony.media_stream import (
    AgentState,
    MediaStreamHandler,
    _is_silence,
)
from app.stt.base import TranscriptionResult


class TestIsSilence:
    def test_all_silence_bytes(self):
        audio = b"\xff" * 100
        assert _is_silence(audio) is True

    def test_loud_audio(self):
        audio = b"\x00" * 100  # Max positive amplitude
        assert _is_silence(audio) is False

    def test_near_silence(self):
        audio = b"\xfe" * 100  # Very close to silence
        assert _is_silence(audio) is True

    def test_empty_audio(self):
        assert _is_silence(b"") is True

    def test_mixed_audio(self):
        # Mix of silence and loud
        audio = b"\xff" * 50 + b"\x00" * 50
        assert _is_silence(audio) is False

    def test_threshold_parameter(self):
        audio = b"\xf0" * 100  # Distance of 15 from 0xFF
        assert _is_silence(audio, threshold=20) is True
        assert _is_silence(audio, threshold=10) is False


class TestAgentState:
    def test_states_exist(self):
        assert AgentState.LISTENING == "listening"
        assert AgentState.PROCESSING == "processing"
        assert AgentState.SPEAKING == "speaking"


class TestMediaStreamHandler:
    def _make_handler(self) -> MediaStreamHandler:
        ws = AsyncMock()
        stt = AsyncMock()
        tts = AsyncMock()
        llm = AsyncMock()

        handler = MediaStreamHandler(
            websocket=ws,
            call_sid="CA_TEST_123",
            stt=stt,
            tts=tts,
            llm=llm,
            silence_threshold_ms=800,
        )
        return handler

    def test_init(self):
        handler = self._make_handler()
        assert handler._call_sid == "CA_TEST_123"
        assert handler._state == AgentState.LISTENING
        assert handler._stream_sid is None

    @pytest.mark.asyncio
    async def test_handle_start(self):
        handler = self._make_handler()
        handler._tts.synthesize = AsyncMock(return_value=b"\xff" * 160)

        data = {
            "event": "start",
            "start": {
                "streamSid": "MZ_STREAM_123",
                "customParameters": {
                    "caller": "+354123456",
                    "call_sid": "CA_TEST_123",
                },
            },
        }

        await handler._handle_start(data)

        assert handler._stream_sid == "MZ_STREAM_123"
        assert handler._caller == "+354123456"

    @pytest.mark.asyncio
    async def test_send_media(self):
        handler = self._make_handler()
        handler._stream_sid = "MZ_STREAM_123"

        await handler._send_media("dGVzdA==")

        handler._ws.send_text.assert_awaited_once()
        sent = json.loads(handler._ws.send_text.call_args[0][0])
        assert sent["event"] == "media"
        assert sent["streamSid"] == "MZ_STREAM_123"
        assert sent["media"]["payload"] == "dGVzdA=="

    @pytest.mark.asyncio
    async def test_send_clear(self):
        handler = self._make_handler()
        handler._stream_sid = "MZ_STREAM_123"

        await handler._send_clear()

        handler._ws.send_text.assert_awaited_once()
        sent = json.loads(handler._ws.send_text.call_args[0][0])
        assert sent["event"] == "clear"
        assert sent["streamSid"] == "MZ_STREAM_123"

    @pytest.mark.asyncio
    async def test_send_mark(self):
        handler = self._make_handler()
        handler._stream_sid = "MZ_STREAM_123"

        await handler._send_mark("test_mark")

        handler._ws.send_text.assert_awaited_once()
        sent = json.loads(handler._ws.send_text.call_args[0][0])
        assert sent["event"] == "mark"
        assert sent["mark"]["name"] == "test_mark"

    def test_handle_mark(self):
        handler = self._make_handler()
        data = {"mark": {"name": "utterance_1"}}
        handler._handle_mark(data)
        assert "utterance_1" in handler._played_marks

    @pytest.mark.asyncio
    async def test_send_media_without_stream_sid(self):
        """Should not send if stream_sid is not set."""
        handler = self._make_handler()
        handler._stream_sid = None

        await handler._send_media("dGVzdA==")
        handler._ws.send_text.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_handle_interruption(self):
        handler = self._make_handler()
        handler._stream_sid = "MZ_STREAM_123"
        handler._state = AgentState.SPEAKING

        await handler._handle_interruption()

        assert handler._state == AgentState.LISTENING
        assert len(handler._audio_buffer) == 0
        # Should have sent clear event
        handler._ws.send_text.assert_awaited()

    @pytest.mark.asyncio
    async def test_play_filler(self):
        handler = self._make_handler()
        handler._stream_sid = "MZ_STREAM_123"
        handler._tts.get_filler_audio = MagicMock(return_value=b"\xff" * 320)

        await handler._play_filler("thinking")

        handler._tts.get_filler_audio.assert_called_with("thinking")
        # Should have sent audio chunks
        assert handler._ws.send_text.await_count > 0

    @pytest.mark.asyncio
    async def test_play_filler_missing_audio(self):
        handler = self._make_handler()
        handler._tts.get_filler_audio = MagicMock(return_value=None)

        await handler._play_filler("nonexistent")
        handler._ws.send_text.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_cleanup(self):
        handler = self._make_handler()
        handler._stream_sid = "MZ_STREAM_123"
        # Should not raise
        await handler._cleanup()

    @pytest.mark.asyncio
    async def test_speak_converts_and_sends(self):
        handler = self._make_handler()
        handler._stream_sid = "MZ_STREAM_123"
        handler._state = AgentState.PROCESSING

        # Mock TTS to return 3 chunks worth of audio (480 bytes at 8kHz mulaw)
        handler._tts.synthesize = AsyncMock(return_value=b"\xff" * 480)

        await handler._speak("Halló heimur")

        assert handler._tts.synthesize.await_count == 1
        # Should have sent multiple media messages + 1 mark
        assert handler._ws.send_text.await_count > 1


class TestMediaStreamPipeline:
    @pytest.mark.asyncio
    async def test_pipeline_full_flow(self):
        """Test the full pipeline: STT → LLM → TTS."""
        ws = AsyncMock()
        stt = AsyncMock()
        tts = AsyncMock()

        # Use a proper class mock for LLM to support async generator
        class MockLLM:
            async def get_response(self, messages, system_prompt, tools):
                yield "Góðan daginn."
                yield "Hvernig get ég aðstoðað?"

        llm = MockLLM()

        handler = MediaStreamHandler(
            websocket=ws,
            call_sid="CA_PIPE_TEST",
            stt=stt,
            tts=tts,
            llm=llm,
        )
        handler._stream_sid = "MZ_PIPE_TEST"

        # Mock STT result
        stt.transcribe = AsyncMock(return_value=TranscriptionResult(
            text="Halló",
            confidence=0.95,
        ))

        # Mock TTS
        tts.synthesize = AsyncMock(return_value=b"\xff" * 320)

        # Initialize conversation first
        from app.conversation.manager import get_or_create_conversation
        get_or_create_conversation("CA_PIPE_TEST", "+354999")

        # Set state as _process_utterance would
        handler._state = AgentState.PROCESSING

        # Run pipeline
        audio_data = b"\xff" * 1600  # 200ms of silence (mulaw)
        await handler._pipeline(audio_data)

        # STT should have been called
        assert stt.transcribe.await_count == 1
        # TTS should have been called for each sentence
        assert tts.synthesize.await_count == 2

        # Cleanup
        from app.conversation.manager import remove_conversation
        remove_conversation("CA_PIPE_TEST")
