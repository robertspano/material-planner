"""Google Cloud Speech-to-Text V2 with Chirp model for Icelandic.

Chirp is a 2B-parameter universal speech model trained on 100+ languages
including Icelandic (is-IS). It provides the best Icelandic speech
recognition available via a cloud API.

Uses the V2 API exclusively.
"""

import asyncio
from collections.abc import AsyncIterator

from google.cloud.speech_v2 import SpeechClient
from google.cloud.speech_v2.types import cloud_speech
from google.api_core import exceptions as gcp_exceptions

from app.stt.base import BaseSTT, PartialTranscription, TranscriptionResult
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Chirp streaming max duration is ~5 minutes; renew streams for long calls
MAX_STREAM_DURATION_SECONDS = 280


class GoogleSTT(BaseSTT):
    """Google Cloud Speech-to-Text V2 with Chirp model."""

    def __init__(
        self,
        project_id: str,
        location: str = "eu",
        model: str = "chirp_2",
    ):
        self._project_id = project_id
        self._location = location
        self._model = model
        self._client: SpeechClient | None = None
        self._recognizer_path = (
            f"projects/{project_id}/locations/{location}/recognizers/_"
        )

    def _get_client(self) -> SpeechClient:
        if self._client is None:
            # Chirp models require regional endpoints
            if self._location not in ("global", ""):
                api_endpoint = f"{self._location}-speech.googleapis.com"
                self._client = SpeechClient(
                    client_options={"api_endpoint": api_endpoint}
                )
            else:
                self._client = SpeechClient()
        return self._client

    def _get_recognition_config(self) -> cloud_speech.RecognitionConfig:
        """Build the recognition config for Icelandic with Chirp."""
        return cloud_speech.RecognitionConfig(
            explicit_decoding_config=cloud_speech.ExplicitDecodingConfig(
                encoding=cloud_speech.ExplicitDecodingConfig.AudioEncoding.LINEAR16,
                sample_rate_hertz=16000,
                audio_channel_count=1,
            ),
            language_codes=["is-IS"],
            model=self._model,
        )

    async def transcribe(self, audio_data: bytes) -> TranscriptionResult:
        """Transcribe a complete audio segment (batch mode).

        Args:
            audio_data: PCM16 16kHz mono audio bytes.
        """
        loop = asyncio.get_event_loop()

        def _do_recognize() -> TranscriptionResult:
            client = self._get_client()
            config = self._get_recognition_config()

            request = cloud_speech.RecognizeRequest(
                recognizer=self._recognizer_path,
                config=config,
                content=audio_data,
            )

            try:
                response = client.recognize(request=request)
            except gcp_exceptions.GoogleAPICallError as e:
                logger.error("stt_recognize_error", error=str(e))
                raise

            if not response.results:
                return TranscriptionResult(text="", confidence=0.0)

            best = response.results[0].alternatives[0]
            return TranscriptionResult(
                text=best.transcript,
                confidence=best.confidence,
            )

        return await loop.run_in_executor(None, _do_recognize)

    async def transcribe_stream(
        self, audio_stream: AsyncIterator[bytes]
    ) -> AsyncIterator[PartialTranscription]:
        """Stream audio and yield partial transcriptions.

        Uses StreamingRecognize with interim_results for lowest latency.

        Args:
            audio_stream: Async iterator yielding PCM16 16kHz audio chunks.

        Yields:
            PartialTranscription with interim and final results.
        """
        loop = asyncio.get_event_loop()
        audio_queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        result_queue: asyncio.Queue[PartialTranscription | None] = asyncio.Queue()

        # Collect audio chunks into the queue
        async def _feed_audio():
            async for chunk in audio_stream:
                await audio_queue.put(chunk)
            await audio_queue.put(None)  # Signal end of audio

        def _request_generator():
            """Generate streaming requests (runs in thread)."""
            config = self._get_recognition_config()
            streaming_config = cloud_speech.StreamingRecognitionConfig(
                config=config,
                streaming_features=cloud_speech.StreamingRecognitionFeatures(
                    interim_results=True,
                ),
            )

            # First request: config only
            yield cloud_speech.StreamingRecognizeRequest(
                recognizer=self._recognizer_path,
                streaming_config=streaming_config,
            )

            # Subsequent requests: audio content
            while True:
                try:
                    chunk = asyncio.run_coroutine_threadsafe(
                        audio_queue.get(), loop
                    ).result(timeout=30)
                except Exception:
                    break
                if chunk is None:
                    break
                yield cloud_speech.StreamingRecognizeRequest(audio=chunk)

        def _do_streaming():
            """Run streaming recognition in a thread."""
            client = self._get_client()
            try:
                responses = client.streaming_recognize(
                    requests=_request_generator()
                )
                for response in responses:
                    for result in response.results:
                        if not result.alternatives:
                            continue
                        alt = result.alternatives[0]
                        partial = PartialTranscription(
                            text=alt.transcript,
                            confidence=alt.confidence,
                            is_final=result.is_final,
                            stability=result.stability,
                        )
                        asyncio.run_coroutine_threadsafe(
                            result_queue.put(partial), loop
                        ).result(timeout=5)
            except gcp_exceptions.GoogleAPICallError as e:
                logger.error("stt_streaming_error", error=str(e))
            finally:
                asyncio.run_coroutine_threadsafe(
                    result_queue.put(None), loop
                ).result(timeout=5)

        # Run audio feeder and streaming recognition concurrently
        feed_task = asyncio.ensure_future(_feed_audio())
        stream_future = loop.run_in_executor(None, _do_streaming)

        try:
            while True:
                result = await result_queue.get()
                if result is None:
                    break
                yield result
        finally:
            feed_task.cancel()
            await stream_future

    async def warmup(self) -> None:
        """Warm up the Google Cloud STT connection."""
        logger.info("stt_warmup_start", model=self._model, location=self._location)
        try:
            # Initialize the client (establishes gRPC channel)
            self._get_client()
            # Make a dummy recognition request with minimal audio (silence)
            silence = b"\x00\x00" * 1600  # 100ms of silence at 16kHz
            result = await self.transcribe(silence)
            logger.info("stt_warmup_complete", result_text=result.text)
        except Exception as e:
            logger.error("stt_warmup_failed", error=str(e))

    async def close(self) -> None:
        """Clean up the STT client."""
        if self._client is not None:
            self._client.transport.close()
            self._client = None
        logger.info("stt_closed")
