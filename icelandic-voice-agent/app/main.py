"""FastAPI application entry point for the Icelandic Voice Agent."""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from app.conversation.manager import get_active_count
from app.llm.claude_client import ClaudeClient
from app.stt.google_stt import GoogleSTT
from app.stt.whisper_stt import WhisperSTT
from app.telephony.media_stream import MediaStreamHandler
from app.telephony.twilio_handler import build_media_stream_twiml, validate_twilio_request
from app.tts.azure_tts import AzureTTS
from app.tts.gemini_tts import GeminiTTS
from app.tts.openai_tts import OpenAITTS
from app.utils.logging import get_logger, setup_logging

# Lazy import settings to allow running without .env during tests
_settings = None


def _get_settings():
    global _settings
    if _settings is None:
        from app.config import settings
        _settings = settings
    return _settings


logger = get_logger(__name__)

# Global service instances (initialized during startup)
_stt = None
_tts = None
_llm = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler — initialize and cleanup services."""
    global _stt, _tts, _llm

    settings = _get_settings()
    setup_logging(settings.log_level)
    logger.info("app_starting", stt_provider=settings.stt_provider)

    # Initialize STT
    if settings.stt_provider == "google":
        _stt = GoogleSTT(
            project_id=settings.google_cloud_project_id,
            location=settings.google_cloud_location,
            model=settings.google_stt_model,
        )
    elif settings.stt_provider == "whisper" and settings.openai_api_key:
        _stt = WhisperSTT(api_key=settings.openai_api_key)
    else:
        _stt = GoogleSTT(
            project_id=settings.google_cloud_project_id,
            location=settings.google_cloud_location,
            model=settings.google_stt_model,
        )

    # Initialize TTS
    if settings.tts_provider == "gemini" and settings.gemini_api_key:
        logger.info("tts_provider_gemini", voice=settings.gemini_tts_voice)
        _tts = GeminiTTS(
            api_key=settings.gemini_api_key,
            voice_name=settings.gemini_tts_voice,
            model=settings.gemini_tts_model,
        )
    elif settings.tts_provider == "openai" and settings.openai_api_key:
        logger.info("tts_provider_openai", voice=settings.openai_tts_voice)
        _tts = OpenAITTS(
            api_key=settings.openai_api_key,
            voice=settings.openai_tts_voice,
            model=settings.openai_tts_model,
        )
    else:
        logger.info("tts_provider_azure", voice=settings.azure_tts_voice)
        _tts = AzureTTS(
            speech_key=settings.azure_speech_key,
            speech_region=settings.azure_speech_region,
            voice_name=settings.azure_tts_voice,
        )

    # Initialize Claude LLM
    _llm = ClaudeClient(
        api_key=settings.anthropic_api_key,
        model=settings.claude_model,
    )

    # Warm up connections (dummy requests to establish TLS, warm caches)
    logger.info("app_warmup_start")
    await _tts.warmup()  # Also pre-synthesizes filler phrases
    await _stt.warmup()
    await _llm.warmup()
    logger.info("app_warmup_complete")

    yield

    # Shutdown
    logger.info("app_shutting_down")
    await _stt.close()
    await _tts.close()
    _llm.close()
    logger.info("app_shutdown_complete")


app = FastAPI(
    title="Icelandic Voice Agent",
    description="AI-powered Icelandic phone agent using Claude, Google Chirp STT, and Azure Neural TTS",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "icelandic-voice-agent",
        "active_calls": get_active_count(),
    }


@app.post("/incoming-call")
async def incoming_call(request: Request):
    """Handle incoming Twilio phone call.

    Validates the Twilio request signature and returns TwiML to connect
    the call to a bidirectional Media Stream WebSocket.
    """
    settings = _get_settings()

    # Parse form body
    form = await request.form()
    body = dict(form)

    # Validate Twilio signature
    if not validate_twilio_request(request, body, settings.twilio_auth_token):
        logger.warning("incoming_call_invalid_signature")
        return Response(content="Forbidden", status_code=403)

    call_sid = body.get("CallSid", "unknown")
    caller = body.get("From", "unknown")

    logger.info(
        "incoming_call",
        call_sid=call_sid,
        caller=caller,
        to=body.get("To", ""),
    )

    # Generate TwiML to connect to our WebSocket
    twiml = build_media_stream_twiml(
        base_url=settings.base_url,
        call_sid=call_sid,
        caller=caller,
    )

    return Response(content=twiml, media_type="application/xml")


@app.websocket("/media-stream/{call_sid}")
async def media_stream(websocket: WebSocket, call_sid: str):
    """WebSocket endpoint for Twilio Media Streams.

    Handles bidirectional audio streaming for a single phone call.
    """
    await websocket.accept()

    settings = _get_settings()

    logger.info("media_stream_accepted", call_sid=call_sid)

    handler = MediaStreamHandler(
        websocket=websocket,
        call_sid=call_sid,
        stt=_stt,
        tts=_tts,
        llm=_llm,
        silence_threshold_ms=settings.vad_silence_threshold_ms,
        max_turns=settings.max_conversation_turns,
    )

    await handler.handle()


if __name__ == "__main__":
    import uvicorn

    settings = _get_settings()
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level=settings.log_level.lower(),
    )
