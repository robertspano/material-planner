"""Audio format conversion between Twilio, Google STT, and Azure TTS.

Twilio Media Streams: mulaw 8kHz mono (base64 encoded)
Google Cloud STT:     PCM16 (LINEAR16) 16kHz mono
Azure TTS output:     PCM16 16kHz/24kHz mono
"""

import base64
import struct

import audioop
import numpy as np
from scipy.signal import resample_poly


def mulaw_to_pcm16(mulaw_data: bytes, target_rate: int = 16000) -> bytes:
    """Convert mulaw 8kHz to PCM16 at target sample rate.

    Args:
        mulaw_data: Raw mulaw-encoded audio bytes at 8kHz.
        target_rate: Target sample rate (default 16kHz for Google STT).

    Returns:
        PCM16 bytes at the target sample rate.
    """
    pcm_8khz = audioop.ulaw2lin(mulaw_data, 2)

    if target_rate == 8000:
        return pcm_8khz

    samples = np.frombuffer(pcm_8khz, dtype=np.int16).astype(np.float64)

    up = target_rate // 1000
    down = 8000 // 1000
    resampled = resample_poly(samples, up, down).astype(np.int16)

    return resampled.tobytes()


def pcm16_to_mulaw(pcm_data: bytes, input_rate: int = 16000) -> bytes:
    """Convert PCM16 to mulaw 8kHz for Twilio.

    Args:
        pcm_data: Raw PCM16 audio bytes at input_rate.
        input_rate: Input sample rate (default 16kHz).

    Returns:
        Mulaw-encoded bytes at 8kHz.
    """
    if input_rate != 8000:
        samples = np.frombuffer(pcm_data, dtype=np.int16).astype(np.float64)
        down = input_rate // 1000
        up = 8000 // 1000
        resampled = resample_poly(samples, up, down).astype(np.int16)
        pcm_8khz = resampled.tobytes()
    else:
        pcm_8khz = pcm_data

    return audioop.lin2ulaw(pcm_8khz, 2)


def base64_decode_audio(payload: str) -> bytes:
    """Decode base64-encoded audio from Twilio media message."""
    return base64.b64decode(payload)


def base64_encode_audio(audio: bytes) -> str:
    """Encode audio bytes to base64 for Twilio media message."""
    return base64.b64encode(audio).decode("ascii")


def chunk_audio(audio: bytes, chunk_ms: int = 20, sample_rate: int = 8000, sample_width: int = 1) -> list[bytes]:
    """Split audio into fixed-duration chunks for streaming to Twilio.

    Args:
        audio: Raw audio bytes (mulaw at 8kHz = 1 byte per sample).
        chunk_ms: Duration of each chunk in milliseconds.
        sample_rate: Sample rate of the audio.
        sample_width: Bytes per sample (1 for mulaw, 2 for PCM16).

    Returns:
        List of audio byte chunks.
    """
    bytes_per_chunk = int(sample_rate * sample_width * chunk_ms / 1000)
    chunks = []
    for i in range(0, len(audio), bytes_per_chunk):
        chunk = audio[i : i + bytes_per_chunk]
        if len(chunk) == bytes_per_chunk:
            chunks.append(chunk)
        else:
            # Pad the last chunk with silence
            if sample_width == 1:
                silence = b"\xff" * (bytes_per_chunk - len(chunk))  # mulaw silence
            else:
                silence = b"\x00" * (bytes_per_chunk - len(chunk))  # PCM silence
            chunks.append(chunk + silence)
    return chunks


def generate_silence_mulaw(duration_ms: int, sample_rate: int = 8000) -> bytes:
    """Generate mulaw silence for a given duration.

    Args:
        duration_ms: Duration in milliseconds.
        sample_rate: Sample rate (default 8kHz for Twilio).

    Returns:
        Mulaw-encoded silence bytes.
    """
    num_samples = int(sample_rate * duration_ms / 1000)
    return b"\xff" * num_samples  # 0xFF is mulaw silence (zero amplitude)
