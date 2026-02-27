"""Twilio Media Streams WebSocket handler — CORE orchestration component.

Handles bidirectional audio streaming between Twilio and the voice agent pipeline:
  Caller audio → STT → Claude LLM → TTS → Caller playback

Designed for natural, real-time conversation:
- Concurrent pipeline: audio keeps flowing while STT/LLM/TTS run in background
- Instant barge-in: caller can interrupt at any time (~200ms detection)
- Filler phrases: plays "Augnablik..." while waiting for LLM
- Low silence threshold: responds quickly after caller stops talking
"""

import asyncio
import json
import time
from enum import Enum

from fastapi import WebSocket, WebSocketDisconnect

from app.audio.transcoder import (
    base64_decode_audio,
    base64_encode_audio,
    chunk_audio,
    mulaw_to_pcm16,
    pcm16_to_mulaw,
)
from app.conversation.manager import (
    get_or_create_conversation,
    remove_conversation,
)
from app.llm.claude_client import ClaudeClient
from app.llm.system_prompt import GREETING, SYSTEM_PROMPT
from app.llm.tools import TOOLS
from app.stt.base import BaseSTT
from app.tts.base import BaseTTS
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Audio chunking: 20ms chunks at 8kHz mulaw = 160 bytes per chunk
TWILIO_CHUNK_MS = 20
TWILIO_SAMPLE_RATE = 8000

# Barge-in: require 10 consecutive non-silent frames (~200ms) to interrupt
# This is responsive enough to feel natural but avoids false triggers
BARGE_IN_THRESHOLD = 10

# VAD silence threshold — higher = less sensitive to background noise
SILENCE_ENERGY_THRESHOLD = 10

# Minimum audio to process (avoid processing tiny noise bursts)
MIN_AUDIO_BYTES = 480  # 60ms at 8kHz mulaw


class AgentState(str, Enum):
    LISTENING = "listening"
    PROCESSING = "processing"
    SPEAKING = "speaking"


class MediaStreamHandler:
    """Handles a single Twilio Media Stream WebSocket connection."""

    def __init__(
        self,
        websocket: WebSocket,
        call_sid: str,
        stt: BaseSTT,
        tts: BaseTTS,
        llm: ClaudeClient,
        silence_threshold_ms: int = 500,
        max_turns: int = 50,
    ):
        self._ws = websocket
        self._call_sid = call_sid
        self._stt = stt
        self._tts = tts
        self._llm = llm
        self._silence_threshold_ms = silence_threshold_ms
        self._max_turns = max_turns

        # Stream identifiers
        self._stream_sid: str | None = None
        self._caller: str = ""

        # Audio buffer for incoming caller audio
        self._audio_buffer = bytearray()
        self._last_audio_time: float = 0.0
        self._silence_start: float | None = None
        self._has_speech: bool = False  # Track if we got real speech

        # State
        self._state = AgentState.LISTENING
        self._speaking_task: asyncio.Task | None = None
        self._mark_counter = 0
        self._played_marks: set[str] = set()
        self._is_connected = False
        self._barge_in_frames = 0
        self._interrupted = False

    async def handle(self) -> None:
        """Main handler loop — processes WebSocket messages from Twilio."""
        try:
            async for message in self._ws.iter_text():
                data = json.loads(message)
                event = data.get("event")

                if event == "connected":
                    self._is_connected = True
                    logger.info("media_stream_connected", call_sid=self._call_sid)

                elif event == "start":
                    await self._handle_start(data)

                elif event == "media":
                    await self._handle_media(data)

                elif event == "mark":
                    self._handle_mark(data)

                elif event == "stop":
                    logger.info("media_stream_stop", call_sid=self._call_sid)
                    break

        except WebSocketDisconnect:
            logger.info("media_stream_disconnected", call_sid=self._call_sid)
        except Exception as e:
            logger.error(
                "media_stream_error",
                call_sid=self._call_sid,
                error=str(e),
                error_type=type(e).__name__,
            )
        finally:
            await self._cleanup()

    async def _handle_start(self, data: dict) -> None:
        """Handle stream start event — extract parameters and send greeting."""
        start_data = data.get("start", {})
        self._stream_sid = start_data.get("streamSid")
        custom_params = start_data.get("customParameters", {})
        self._caller = custom_params.get("caller", "")

        logger.info(
            "media_stream_start",
            call_sid=self._call_sid,
            stream_sid=self._stream_sid,
            caller=self._caller,
        )

        # Initialize conversation
        get_or_create_conversation(
            self._call_sid, self._caller, self._max_turns
        )

        # Send greeting
        await self._speak(GREETING)
        self._state = AgentState.LISTENING

    async def _handle_media(self, data: dict) -> None:
        """Handle incoming audio from the caller.

        This runs on EVERY audio packet (~20ms). Must be fast.
        Barge-in works because we process audio even while speaking.
        """
        media = data.get("media", {})
        payload = media.get("payload", "")
        if not payload:
            return

        audio_bytes = base64_decode_audio(payload)
        current_time = time.monotonic()

        is_silent = _is_silence(audio_bytes)

        # === SPEAKING STATE: check for barge-in ===
        if self._state == AgentState.SPEAKING:
            if not is_silent:
                self._barge_in_frames += 1
                if self._barge_in_frames >= BARGE_IN_THRESHOLD:
                    await self._handle_interruption()
                    self._barge_in_frames = 0
                    # Start capturing the interruption speech
                    self._audio_buffer.extend(audio_bytes)
                    self._last_audio_time = current_time
                    self._silence_start = None
                    self._has_speech = True
            else:
                self._barge_in_frames = 0
            return

        # === PROCESSING STATE: still listen for barge-in ===
        if self._state == AgentState.PROCESSING:
            # Allow barge-in even during processing (STT/LLM running)
            if not is_silent:
                self._barge_in_frames += 1
                if self._barge_in_frames >= BARGE_IN_THRESHOLD:
                    await self._handle_interruption()
                    self._barge_in_frames = 0
                    self._audio_buffer.extend(audio_bytes)
                    self._last_audio_time = current_time
                    self._silence_start = None
                    self._has_speech = True
            else:
                self._barge_in_frames = 0
            return

        # === LISTENING STATE: buffer audio and detect end of utterance ===
        self._audio_buffer.extend(audio_bytes)
        self._last_audio_time = current_time

        if not is_silent:
            self._has_speech = True
            self._silence_start = None
        else:
            if self._silence_start is None:
                self._silence_start = current_time
            elif (
                self._has_speech
                and (current_time - self._silence_start) * 1000 >= self._silence_threshold_ms
            ):
                # Silence threshold exceeded after real speech — process it
                if len(self._audio_buffer) > MIN_AUDIO_BYTES:
                    await self._process_utterance()

    def _handle_mark(self, data: dict) -> None:
        """Handle playback mark events from Twilio."""
        mark_name = data.get("mark", {}).get("name", "")
        self._played_marks.add(mark_name)
        # When playback finishes and we're speaking, go back to listening
        if self._state == AgentState.SPEAKING:
            self._state = AgentState.LISTENING

    async def _handle_interruption(self) -> None:
        """Handle caller interruption (barge-in) — instant response."""
        logger.info("barge_in", call_sid=self._call_sid, state=self._state.value)
        self._interrupted = True

        # Cancel any running speaking task
        if self._speaking_task and not self._speaking_task.done():
            self._speaking_task.cancel()
            try:
                await self._speaking_task
            except asyncio.CancelledError:
                pass

        # Send clear message to Twilio to IMMEDIATELY stop playback
        await self._send_clear()

        self._state = AgentState.LISTENING
        self._audio_buffer.clear()
        self._has_speech = False

    async def _process_utterance(self) -> None:
        """Process a complete utterance: STT → LLM → TTS.

        Runs the pipeline as a background task so the WebSocket loop
        keeps processing audio (enabling barge-in during processing).
        """
        if self._state == AgentState.PROCESSING:
            return

        self._state = AgentState.PROCESSING
        audio_data = bytes(self._audio_buffer)
        self._audio_buffer.clear()
        self._silence_start = None
        self._has_speech = False

        # Run pipeline as a task so we can keep processing audio
        self._speaking_task = asyncio.create_task(
            self._pipeline(audio_data)
        )

    async def _pipeline(self, audio_data: bytes) -> None:
        """Run the full voice agent pipeline for one utterance."""
        pipeline_start = time.monotonic()

        try:
            # 1. Convert mulaw 8kHz → PCM16 16kHz for STT
            pcm_audio = mulaw_to_pcm16(audio_data, target_rate=16000)

            # 2. Speech-to-Text
            try:
                stt_result = await self._stt.transcribe(pcm_audio)
            except Exception as e:
                logger.error("stt_error", error=str(e), call_sid=self._call_sid)
                await self._speak("Afsakið, gætirðu endurtekið?")
                return

            transcript = stt_result.text.strip()
            if not transcript:
                self._state = AgentState.LISTENING
                return

            stt_time = time.monotonic() - pipeline_start
            logger.info(
                "transcript",
                text=transcript,
                confidence=stt_result.confidence,
                stt_ms=round(stt_time * 1000),
                call_sid=self._call_sid,
            )

            # 3. Play filler while LLM thinks (gives instant feedback)
            if not self._interrupted:
                await self._play_filler("thinking")

            # 4. Update conversation history
            conversation = get_or_create_conversation(self._call_sid)
            conversation.add_user_message(transcript)

            # 5. Get Claude response
            messages = conversation.get_messages()
            full_response = ""
            self._interrupted = False

            try:
                llm_start = time.monotonic()
                async for sentence in self._llm.get_response(
                    messages=messages,
                    system_prompt=SYSTEM_PROMPT,
                    tools=TOOLS,
                ):
                    if self._interrupted:
                        break
                    full_response += sentence + " "

                llm_time = time.monotonic() - llm_start
                logger.info(
                    "llm_response",
                    text=full_response[:100],
                    llm_ms=round(llm_time * 1000),
                    call_sid=self._call_sid,
                )

            except Exception as e:
                logger.error("llm_error", error=str(e), call_sid=self._call_sid)
                await self._speak("Afsakið, augnablik.")
                return

            # 6. Clear filler and speak the full response
            if full_response.strip() and not self._interrupted:
                await self._send_clear()  # Stop filler
                await self._speak(full_response.strip())

            # 7. Record assistant response
            if full_response.strip():
                conversation.add_assistant_message(full_response.strip())

            total_time = time.monotonic() - pipeline_start
            logger.info(
                "pipeline_complete",
                total_ms=round(total_time * 1000),
                call_sid=self._call_sid,
            )

        except asyncio.CancelledError:
            logger.info("pipeline_cancelled", call_sid=self._call_sid)
        except Exception as e:
            logger.error(
                "pipeline_error",
                error=str(e),
                error_type=type(e).__name__,
                call_sid=self._call_sid,
            )
        finally:
            if self._state != AgentState.LISTENING:
                self._state = AgentState.LISTENING

    async def _speak(self, text: str) -> None:
        """Convert text to speech and send audio to Twilio."""
        if not text.strip():
            return

        self._state = AgentState.SPEAKING
        self._interrupted = False

        try:
            tts_start = time.monotonic()

            # Synthesize speech (PCM16 at provider's sample rate)
            pcm_audio = await self._tts.synthesize(text)

            if self._interrupted:
                return

            # Convert PCM16 → mulaw 8kHz for Twilio
            mulaw_audio = pcm16_to_mulaw(pcm_audio, input_rate=self._tts.output_sample_rate)

            tts_time = time.monotonic() - tts_start
            duration_s = round(len(mulaw_audio) / TWILIO_SAMPLE_RATE, 1)

            logger.info(
                "speak",
                text=text[:80],
                tts_ms=round(tts_time * 1000),
                duration_s=duration_s,
                call_sid=self._call_sid,
            )

            # Chunk and send to Twilio
            chunks = chunk_audio(
                mulaw_audio,
                chunk_ms=TWILIO_CHUNK_MS,
                sample_rate=TWILIO_SAMPLE_RATE,
                sample_width=1,
            )

            for chunk in chunks:
                if self._interrupted:
                    break

                payload = base64_encode_audio(chunk)
                await self._send_media(payload)

            # Send a mark to track playback completion
            if not self._interrupted:
                self._mark_counter += 1
                mark_name = f"utt_{self._mark_counter}"
                await self._send_mark(mark_name)

        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(
                "speak_error",
                error=str(e),
                text=text[:100],
                call_sid=self._call_sid,
            )

    async def _send_media(self, payload: str) -> None:
        """Send audio media to Twilio via WebSocket."""
        if not self._stream_sid:
            return
        msg = {
            "event": "media",
            "streamSid": self._stream_sid,
            "media": {"payload": payload},
        }
        await self._ws.send_text(json.dumps(msg))

    async def _send_mark(self, name: str) -> None:
        """Send a mark event to Twilio to track playback position."""
        if not self._stream_sid:
            return
        msg = {
            "event": "mark",
            "streamSid": self._stream_sid,
            "mark": {"name": name},
        }
        await self._ws.send_text(json.dumps(msg))

    async def _send_clear(self) -> None:
        """Send a clear event to Twilio to stop current audio playback."""
        if not self._stream_sid:
            return
        msg = {
            "event": "clear",
            "streamSid": self._stream_sid,
        }
        await self._ws.send_text(json.dumps(msg))

    async def _play_filler(self, key: str = "thinking") -> None:
        """Play a pre-cached filler phrase for instant audio feedback."""
        filler_audio = self._tts.get_filler_audio(key)
        if not filler_audio:
            return

        try:
            mulaw_audio = pcm16_to_mulaw(filler_audio, input_rate=self._tts.output_sample_rate)
            chunks = chunk_audio(
                mulaw_audio,
                chunk_ms=TWILIO_CHUNK_MS,
                sample_rate=TWILIO_SAMPLE_RATE,
                sample_width=1,
            )
            for chunk in chunks:
                if self._interrupted:
                    break
                payload = base64_encode_audio(chunk)
                await self._send_media(payload)
        except Exception as e:
            logger.error("filler_error", error=str(e), call_sid=self._call_sid)

    async def _cleanup(self) -> None:
        """Clean up resources when the call ends."""
        if self._speaking_task and not self._speaking_task.done():
            self._speaking_task.cancel()
            try:
                await self._speaking_task
            except asyncio.CancelledError:
                pass

        remove_conversation(self._call_sid)

        logger.info(
            "cleanup",
            call_sid=self._call_sid,
            stream_sid=self._stream_sid,
        )


def _is_silence(audio: bytes, threshold: int = SILENCE_ENERGY_THRESHOLD) -> bool:
    """Check if mulaw audio is silence or near-silence.

    In mulaw encoding, 0xFF represents zero amplitude (silence).
    Values close to 0xFF are very quiet.
    """
    if not audio:
        return True

    total_energy = 0
    for b in audio:
        if b >= 0x80:
            distance = 0xFF - b
        else:
            distance = 0x7F - b
        total_energy += distance

    avg_energy = total_energy / len(audio)
    return avg_energy < threshold
