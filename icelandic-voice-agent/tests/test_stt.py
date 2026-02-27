"""Tests for Google Cloud Speech-to-Text (Chirp)."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

import pytest

from app.stt.google_stt import GoogleSTT
from app.stt.base import TranscriptionResult, PartialTranscription


class TestGoogleSTTInit:
    def test_default_config(self):
        stt = GoogleSTT(project_id="test-project")
        assert stt._project_id == "test-project"
        assert stt._location == "eu"
        assert stt._model == "chirp_2"
        assert stt._recognizer_path == "projects/test-project/locations/eu/recognizers/_"

    def test_custom_config(self):
        stt = GoogleSTT(
            project_id="my-proj",
            location="us",
            model="chirp_3",
        )
        assert stt._location == "us"
        assert stt._model == "chirp_3"
        assert stt._recognizer_path == "projects/my-proj/locations/us/recognizers/_"


class TestGoogleSTTRecognitionConfig:
    def test_config_values(self):
        stt = GoogleSTT(project_id="test-project", model="chirp_2")
        config = stt._get_recognition_config()

        assert config.language_codes == ["is-IS"]
        assert config.model == "chirp_2"
        assert config.explicit_decoding_config.sample_rate_hertz == 16000
        assert config.explicit_decoding_config.audio_channel_count == 1


class TestGoogleSTTTranscribe:
    @pytest.mark.asyncio
    async def test_transcribe_returns_result(self):
        """Test batch transcription with mocked Google API."""
        stt = GoogleSTT(project_id="test-project")

        # Mock the client and response
        mock_client = MagicMock()
        mock_alternative = MagicMock()
        mock_alternative.transcript = "Halló heimur"
        mock_alternative.confidence = 0.95

        mock_result = MagicMock()
        mock_result.alternatives = [mock_alternative]

        mock_response = MagicMock()
        mock_response.results = [mock_result]

        mock_client.recognize.return_value = mock_response
        stt._client = mock_client

        audio = b"\x00\x00" * 1600  # 100ms silence
        result = await stt.transcribe(audio)

        assert isinstance(result, TranscriptionResult)
        assert result.text == "Halló heimur"
        assert result.confidence == 0.95
        assert result.is_final is True

    @pytest.mark.asyncio
    async def test_transcribe_empty_result(self):
        """Test handling of empty recognition results."""
        stt = GoogleSTT(project_id="test-project")

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.results = []
        mock_client.recognize.return_value = mock_response
        stt._client = mock_client

        audio = b"\x00\x00" * 160
        result = await stt.transcribe(audio)

        assert result.text == ""
        assert result.confidence == 0.0

    @pytest.mark.asyncio
    async def test_transcribe_api_error(self):
        """Test handling of Google API errors."""
        from google.api_core import exceptions as gcp_exceptions

        stt = GoogleSTT(project_id="test-project")

        mock_client = MagicMock()
        mock_client.recognize.side_effect = gcp_exceptions.GoogleAPICallError(
            "Service unavailable"
        )
        stt._client = mock_client

        audio = b"\x00\x00" * 160
        with pytest.raises(gcp_exceptions.GoogleAPICallError):
            await stt.transcribe(audio)


class TestGoogleSTTStreamingConfig:
    def test_streaming_recognition_config(self):
        """Verify streaming config enables interim results."""
        from google.cloud.speech_v2.types import cloud_speech

        stt = GoogleSTT(project_id="test-project")
        config = stt._get_recognition_config()

        streaming_config = cloud_speech.StreamingRecognitionConfig(
            config=config,
            streaming_features=cloud_speech.StreamingRecognitionFeatures(
                interim_results=True,
            ),
        )

        assert streaming_config.streaming_features.interim_results is True
        assert streaming_config.config.language_codes == ["is-IS"]


class TestGoogleSTTLifecycle:
    @pytest.mark.asyncio
    async def test_close_cleans_up(self):
        """Test that close() cleans up the client."""
        stt = GoogleSTT(project_id="test-project")
        mock_client = MagicMock()
        mock_transport = MagicMock()
        mock_client.transport = mock_transport
        stt._client = mock_client

        await stt.close()

        mock_transport.close.assert_called_once()
        assert stt._client is None

    @pytest.mark.asyncio
    async def test_close_no_client(self):
        """Test that close() is safe with no client."""
        stt = GoogleSTT(project_id="test-project")
        await stt.close()  # Should not raise
