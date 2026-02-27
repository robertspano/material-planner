"""Integration tests for the full voice agent pipeline.

Tests the complete flow with all external services mocked:
  Twilio audio → STT → Claude → TTS → Twilio audio
"""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.audio.transcoder import (
    base64_encode_audio,
    generate_silence_mulaw,
    pcm16_to_mulaw,
)
from app.conversation.manager import (
    _active_conversations,
    get_active_count,
    get_or_create_conversation,
    remove_conversation,
)
from app.llm.tools import execute_tool
from app.stt.base import TranscriptionResult
from app.telephony.media_stream import AgentState, MediaStreamHandler


class TestFullPipeline:
    """Integration test: simulate a complete phone call."""

    def setup_method(self):
        _active_conversations.clear()

    @pytest.mark.asyncio
    async def test_single_turn_conversation(self):
        """Simulate: caller says 'Halló' → agent responds with greeting."""
        ws = AsyncMock()
        stt = AsyncMock()
        tts = AsyncMock()

        class MockLLM:
            async def get_response(self, messages, system_prompt, tools):
                yield "Góðan daginn!"
                yield "Hvernig get ég aðstoðað þig?"

        handler = MediaStreamHandler(
            websocket=ws,
            call_sid="CA_INT_001",
            stt=stt,
            tts=tts,
            llm=MockLLM(),
        )
        handler._stream_sid = "MZ_INT_001"

        # Mock STT
        stt.transcribe = AsyncMock(
            return_value=TranscriptionResult(text="Halló", confidence=0.95)
        )

        # Mock TTS — return valid mulaw audio
        tts.synthesize = AsyncMock(return_value=b"\xff" * 640)

        # Set up conversation
        get_or_create_conversation("CA_INT_001", "+354123456")

        # Process
        handler._state = AgentState.PROCESSING
        await handler._pipeline(b"\xff" * 1600)

        # Verify STT was called
        assert stt.transcribe.await_count == 1

        # Verify TTS was called twice (two sentences)
        assert tts.synthesize.await_count == 2

        # Verify audio was sent to Twilio
        assert ws.send_text.await_count > 0

        # Check conversation history
        conv = get_or_create_conversation("CA_INT_001")
        msgs = conv.get_messages()
        assert len(msgs) == 2
        assert msgs[0]["role"] == "user"
        assert msgs[0]["content"] == "Halló"
        assert msgs[1]["role"] == "assistant"
        assert "Góðan daginn" in msgs[1]["content"]

        remove_conversation("CA_INT_001")

    @pytest.mark.asyncio
    async def test_multi_turn_conversation(self):
        """Simulate a multi-turn conversation."""
        ws = AsyncMock()
        stt = AsyncMock()
        tts = AsyncMock()

        turn_responses = [
            ["Góðan daginn! Velkomin í Íslandsbíla."],
            ["Augnablik, ég er að athuga.", "Já, við erum með tvær Tesla á lager."],
        ]
        turn_index = 0

        class MockLLM:
            async def get_response(self, messages, system_prompt, tools):
                nonlocal turn_index
                idx = min(turn_index, len(turn_responses) - 1)
                for sentence in turn_responses[idx]:
                    yield sentence
                turn_index += 1

        handler = MediaStreamHandler(
            websocket=ws,
            call_sid="CA_INT_002",
            stt=stt,
            tts=tts,
            llm=MockLLM(),
        )
        handler._stream_sid = "MZ_INT_002"

        tts.synthesize = AsyncMock(return_value=b"\xff" * 320)
        get_or_create_conversation("CA_INT_002", "+354888888")

        # Turn 1: "Halló"
        stt.transcribe = AsyncMock(
            return_value=TranscriptionResult(text="Halló", confidence=0.9)
        )
        handler._state = AgentState.PROCESSING
        await handler._pipeline(b"\xff" * 1600)

        # Turn 2: "Eruð þið með Tesla?"
        stt.transcribe = AsyncMock(
            return_value=TranscriptionResult(
                text="Eruð þið með Tesla?", confidence=0.92
            )
        )
        handler._state = AgentState.PROCESSING
        await handler._pipeline(b"\xff" * 3200)

        # Check conversation has 4 messages (2 user + 2 assistant)
        conv = get_or_create_conversation("CA_INT_002")
        msgs = conv.get_messages()
        assert len(msgs) == 4
        assert msgs[0]["content"] == "Halló"
        assert msgs[2]["content"] == "Eruð þið með Tesla?"

        remove_conversation("CA_INT_002")

    @pytest.mark.asyncio
    async def test_stt_error_recovery(self):
        """Agent should apologize gracefully when STT fails."""
        ws = AsyncMock()
        stt = AsyncMock()
        tts = AsyncMock()
        llm = MagicMock()

        handler = MediaStreamHandler(
            websocket=ws,
            call_sid="CA_INT_003",
            stt=stt,
            tts=tts,
            llm=llm,
        )
        handler._stream_sid = "MZ_INT_003"

        # STT raises an error
        stt.transcribe = AsyncMock(side_effect=RuntimeError("STT service unavailable"))
        tts.synthesize = AsyncMock(return_value=b"\xff" * 320)

        get_or_create_conversation("CA_INT_003", "+354777")

        handler._state = AgentState.PROCESSING
        await handler._pipeline(b"\xff" * 1600)

        # TTS should have been called with the error message
        assert tts.synthesize.await_count == 1
        call_text = tts.synthesize.call_args[0][0]
        assert "Afsakið" in call_text

        remove_conversation("CA_INT_003")

    @pytest.mark.asyncio
    async def test_empty_transcript_ignored(self):
        """Empty STT results should be silently ignored."""
        ws = AsyncMock()
        stt = AsyncMock()
        tts = AsyncMock()
        llm = MagicMock()

        handler = MediaStreamHandler(
            websocket=ws,
            call_sid="CA_INT_004",
            stt=stt,
            tts=tts,
            llm=llm,
        )
        handler._stream_sid = "MZ_INT_004"

        stt.transcribe = AsyncMock(
            return_value=TranscriptionResult(text="", confidence=0.0)
        )

        get_or_create_conversation("CA_INT_004", "+354666")

        handler._state = AgentState.PROCESSING
        await handler._pipeline(b"\xff" * 1600)

        # TTS should NOT have been called
        tts.synthesize.assert_not_awaited()
        # State should return to LISTENING
        assert handler._state == AgentState.LISTENING

        remove_conversation("CA_INT_004")


class TestToolExecution:
    """Test tool execution functions."""

    @pytest.mark.asyncio
    async def test_search_inventory_all(self):
        result = await execute_tool("search_inventory", {})
        data = json.loads(result)
        assert data["count"] == 5
        assert len(data["vehicles"]) == 5

    @pytest.mark.asyncio
    async def test_search_inventory_by_make(self):
        result = await execute_tool("search_inventory", {"make": "Tesla"})
        data = json.loads(result)
        assert data["count"] == 2
        assert all(v["make"] == "Tesla" for v in data["vehicles"])

    @pytest.mark.asyncio
    async def test_search_inventory_by_fuel(self):
        result = await execute_tool("search_inventory", {"fuel_type": "rafmagn"})
        data = json.loads(result)
        assert data["count"] == 3
        assert all(v["fuel_type"] == "rafmagn" for v in data["vehicles"])

    @pytest.mark.asyncio
    async def test_search_inventory_no_results(self):
        result = await execute_tool("search_inventory", {"make": "Lamborghini"})
        data = json.loads(result)
        assert data["count"] == 0

    @pytest.mark.asyncio
    async def test_book_test_drive_success(self):
        result = await execute_tool("book_test_drive", {
            "customer_name": "Jón Jónsson",
            "phone_number": "+354123456",
            "vehicle_id": "ISB-001",
            "preferred_date": "2026-03-01",
        })
        data = json.loads(result)
        assert data["success"] is True
        assert "booking_id" in data
        assert data["customer_name"] == "Jón Jónsson"

    @pytest.mark.asyncio
    async def test_book_test_drive_invalid_vehicle(self):
        result = await execute_tool("book_test_drive", {
            "customer_name": "Test",
            "phone_number": "+354111",
            "vehicle_id": "INVALID-999",
            "preferred_date": "2026-03-01",
        })
        data = json.loads(result)
        assert data["success"] is False

    @pytest.mark.asyncio
    async def test_get_business_hours_weekday(self):
        result = await execute_tool("get_business_hours", {"day": "mánudagur"})
        data = json.loads(result)
        assert data["open"] == "09:00"
        assert data["close"] == "18:00"

    @pytest.mark.asyncio
    async def test_get_business_hours_sunday(self):
        result = await execute_tool("get_business_hours", {"day": "sunnudagur"})
        data = json.loads(result)
        assert data["status"] == "lokað"

    @pytest.mark.asyncio
    async def test_get_business_hours_all(self):
        result = await execute_tool("get_business_hours", {})
        data = json.loads(result)
        assert "mánudagur" in data
        assert data["sunnudagur"] == "lokað"

    @pytest.mark.asyncio
    async def test_transfer_to_agent(self):
        result = await execute_tool("transfer_to_agent", {
            "reason": "Viðskiptavinur vill tala við mann",
            "department": "sala",
        })
        data = json.loads(result)
        assert data["success"] is True
        assert data["department"] == "sala"

    @pytest.mark.asyncio
    async def test_unknown_tool(self):
        result = await execute_tool("nonexistent_tool", {})
        data = json.loads(result)
        assert "error" in data


class TestTwilioHandler:
    def test_build_twiml(self):
        from app.telephony.twilio_handler import build_media_stream_twiml

        twiml = build_media_stream_twiml(
            base_url="https://example.ngrok.io",
            call_sid="CA_TW_001",
            caller="+354123456",
        )

        assert "Stream" in twiml
        assert "wss://example.ngrok.io/media-stream/CA_TW_001" in twiml
        assert "Response" in twiml

    def test_build_twiml_http_upgrade(self):
        from app.telephony.twilio_handler import build_media_stream_twiml

        twiml = build_media_stream_twiml(
            base_url="http://localhost:8000",
            call_sid="CA_LOCAL",
            caller="+354",
        )

        assert "ws://localhost:8000/media-stream/CA_LOCAL" in twiml


class TestConversationRegistryIntegration:
    def setup_method(self):
        _active_conversations.clear()

    def test_full_lifecycle(self):
        """Test creating, using, and cleaning up a conversation."""
        # Create
        conv = get_or_create_conversation("CA_LC_001", "+354999")
        assert get_active_count() == 1

        # Use
        conv.add_user_message("Halló")
        conv.add_assistant_message("Góðan daginn")
        assert conv.turn_count == 1

        # Multiple calls return same conversation
        conv2 = get_or_create_conversation("CA_LC_001")
        assert conv2 is conv
        assert conv2.turn_count == 1

        # Clean up
        remove_conversation("CA_LC_001")
        assert get_active_count() == 0

    def test_concurrent_calls(self):
        """Multiple simultaneous calls should be independent."""
        c1 = get_or_create_conversation("CA_CC_001", "+354111")
        c2 = get_or_create_conversation("CA_CC_002", "+354222")
        c3 = get_or_create_conversation("CA_CC_003", "+354333")

        c1.add_user_message("Hæ")
        c2.add_user_message("Halló")
        c3.add_user_message("Góðan daginn")

        assert c1.turn_count == 1
        assert c2.turn_count == 1
        assert c3.turn_count == 1
        assert get_active_count() == 3

        # Clean up one, others remain
        remove_conversation("CA_CC_002")
        assert get_active_count() == 2

        _active_conversations.clear()
