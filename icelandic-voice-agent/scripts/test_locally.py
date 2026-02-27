#!/usr/bin/env python3
"""Local test script — run the voice agent pipeline with mocked services.

Usage:
    python scripts/test_locally.py

This simulates a phone conversation without needing any API keys.
"""

import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from unittest.mock import AsyncMock
from app.audio.transcoder import base64_encode_audio, generate_silence_mulaw
from app.conversation.manager import get_or_create_conversation, remove_conversation
from app.stt.base import TranscriptionResult
from app.telephony.media_stream import AgentState, MediaStreamHandler


async def simulate_conversation():
    """Simulate a multi-turn phone call with mocked services."""
    print("=" * 60)
    print("  Icelandic Voice Agent — Local Simulation")
    print("=" * 60)
    print()

    # Mock all external services
    ws = AsyncMock()
    stt = AsyncMock()
    tts = AsyncMock()

    # Track what gets sent to TTS (the agent's spoken words)
    spoken_sentences = []

    async def mock_synthesize(text):
        spoken_sentences.append(text)
        return b"\xff" * 320  # Fake audio

    tts.synthesize = mock_synthesize

    # Define the conversation turns
    caller_turns = [
        ("Halló, ég er að leita að nýjum bíl.", 0.94),
        ("Eruð þið með einhverja Tesla á lager?", 0.91),
        ("Hvað kostar hún?", 0.88),
        ("Hvenær eruð þið opin á morgun?", 0.92),
        ("Takk fyrir, bless.", 0.95),
    ]

    # Agent responses for each turn
    agent_responses = [
        ["Góðan daginn og velkomin í Íslandsbíla!", "Ég heiti Sunna og get aðstoðað þig við bílakaup.", "Hvers konar bíl ertu að leita að?"],
        ["Augnablik, ég er að athuga það fyrir þig.", "Já, við erum með tvær Tesla Model þrjú á lager.", "Eina hvíta og eina bláa, báðar frá tvö þúsund tuttugu og fjögur."],
        ["Hvíta Tesla Model þrjú kostar sjö milljónir og níu hundruð þúsund krónur.", "Bláa kostar átta milljónir og tvö hundruð þúsund."],
        ["Augnablik, ég er að athuga opnunartíma.", "Við erum opin á morgun frá níu til sex.", "Viltu bóka tíma til að skoða bílana?"],
        ["Takk fyrir að hafa samband.", "Gangi þér vel og vertu blessaður!"],
    ]

    turn_idx = 0

    class MockLLM:
        async def get_response(self, messages, system_prompt, tools):
            nonlocal turn_idx
            idx = min(turn_idx, len(agent_responses) - 1)
            for sentence in agent_responses[idx]:
                yield sentence
            turn_idx += 1

    handler = MediaStreamHandler(
        websocket=ws,
        call_sid="CA_LOCAL_TEST",
        stt=stt,
        tts=tts,
        llm=MockLLM(),
    )
    handler._stream_sid = "MZ_LOCAL_TEST"
    get_or_create_conversation("CA_LOCAL_TEST", "+354123456")

    # Run the conversation
    for i, (text, confidence) in enumerate(caller_turns):
        spoken_sentences.clear()

        print(f"📞 Viðskiptavinur: \"{text}\"")
        print(f"   [STT confidence: {confidence:.0%}]")

        stt.transcribe = AsyncMock(
            return_value=TranscriptionResult(text=text, confidence=confidence)
        )

        handler._state = AgentState.PROCESSING
        await handler._pipeline(b"\xff" * 3200)

        print(f"🤖 Sunna:")
        for sentence in spoken_sentences:
            print(f"   \"{sentence}\"")
        print()

    # Cleanup
    remove_conversation("CA_LOCAL_TEST")

    print("=" * 60)
    print("  Samtali lokið!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(simulate_conversation())
