"""Environment configuration using pydantic-settings."""

from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings
from pydantic import Field

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"

# Load .env FIRST so it overrides any empty system env vars
load_dotenv(_ENV_FILE, override=True)


class Settings(BaseSettings):
    # Twilio
    twilio_account_sid: str = Field(..., description="Twilio Account SID")
    twilio_auth_token: str = Field(..., description="Twilio Auth Token")
    twilio_phone_number: str = Field(..., description="Twilio phone number (+354...)")

    # Anthropic (Claude)
    anthropic_api_key: str = Field(..., description="Anthropic API key")
    claude_model: str = Field(
        "claude-sonnet-4-5-20250929", description="Claude model ID"
    )

    # Google Cloud Speech-to-Text (Chirp)
    google_cloud_project_id: str = Field(..., description="GCP project ID")
    google_cloud_location: str = Field(
        "eu", description="GCP location (eu for lowest latency to Iceland)"
    )
    google_application_credentials: str = Field(
        ..., description="Path to GCP service account JSON"
    )
    google_stt_model: str = Field(
        "chirp_2", description="Chirp model variant: chirp, chirp_2, chirp_3"
    )

    # Azure Speech Services (TTS)
    azure_speech_key: str = Field(..., description="Azure Speech Services key")
    azure_speech_region: str = Field(
        "northeurope", description="Azure region (northeurope closest to Iceland)"
    )
    azure_tts_voice: str = Field(
        "is-IS-GudrunNeural",
        description="Azure TTS voice: is-IS-GudrunNeural or is-IS-GunnarNeural",
    )

    # OpenAI (TTS + optional Whisper fallback)
    openai_api_key: str | None = Field(
        None, description="OpenAI API key for TTS and/or Whisper fallback"
    )
    openai_tts_voice: str = Field(
        "nova", description="OpenAI TTS voice: alloy, ash, ballad, coral, echo, fable, onyx, nova, sage, shimmer, verse, marin, cedar"
    )
    openai_tts_model: str = Field(
        "gpt-4o-mini-tts", description="OpenAI TTS model: tts-1, tts-1-hd, gpt-4o-mini-tts"
    )

    # Google Gemini TTS
    gemini_api_key: str | None = Field(
        None, description="Google Gemini API key for TTS"
    )
    gemini_tts_voice: str = Field(
        "Kore", description="Gemini TTS voice: Zephyr, Puck, Charon, Kore, Fenrir, Aoede, etc."
    )
    gemini_tts_model: str = Field(
        "gemini-2.5-flash-preview-tts", description="Gemini TTS model"
    )

    # App settings
    base_url: str = Field(..., description="Public URL for Twilio webhooks")
    log_level: str = Field("INFO", description="Logging level")
    stt_provider: str = Field(
        "google", description="STT provider: google or whisper"
    )
    tts_provider: str = Field(
        "gemini", description="TTS provider: gemini, openai, or azure"
    )
    max_conversation_turns: int = Field(
        50, description="Max conversation turns before summarization"
    )
    response_timeout_seconds: float = Field(
        10.0, description="Max seconds to wait for a response"
    )
    audio_buffer_ms: int = Field(
        60, description="Audio buffer size in ms for Twilio"
    )
    vad_silence_threshold_ms: int = Field(
        800, description="Silence duration in ms before utterance is complete"
    )

    model_config = {
        "env_file": str(_ENV_FILE),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()
