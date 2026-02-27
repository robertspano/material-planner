"""Tests for audio transcoder module."""

import base64
import struct

import numpy as np
import pytest

from app.audio.transcoder import (
    base64_decode_audio,
    base64_encode_audio,
    chunk_audio,
    generate_silence_mulaw,
    mulaw_to_pcm16,
    pcm16_to_mulaw,
)


class TestMulawToPcm16:
    def test_basic_conversion(self):
        """mulaw bytes should convert to PCM16 bytes."""
        # Generate a simple mulaw signal (silence = 0xFF in mulaw)
        mulaw_data = b"\xff" * 800  # 100ms at 8kHz
        result = mulaw_to_pcm16(mulaw_data, target_rate=16000)
        assert isinstance(result, bytes)
        # 16kHz has 2x the samples, each sample is 2 bytes (int16)
        assert len(result) == 800 * 2 * 2  # doubled samples, 2 bytes each

    def test_same_rate_no_resample(self):
        """When target_rate is 8kHz, no resampling should occur."""
        mulaw_data = b"\xff" * 80
        result = mulaw_to_pcm16(mulaw_data, target_rate=8000)
        assert isinstance(result, bytes)
        # Each mulaw byte becomes 2 bytes PCM16
        assert len(result) == 80 * 2

    def test_output_is_valid_int16(self):
        """Output should be valid int16 samples."""
        mulaw_data = b"\xff" * 160
        result = mulaw_to_pcm16(mulaw_data, target_rate=16000)
        samples = np.frombuffer(result, dtype=np.int16)
        assert samples.dtype == np.int16
        assert len(samples) == 320  # 160 mulaw samples -> 320 at 2x rate

    def test_non_silence_signal(self):
        """Non-silence mulaw data should produce non-zero PCM16 output."""
        # Create mulaw data that is NOT silence (0x00 is max positive amplitude)
        mulaw_data = bytes([0x00, 0x80] * 400)  # alternating max pos/neg
        result = mulaw_to_pcm16(mulaw_data, target_rate=16000)
        samples = np.frombuffer(result, dtype=np.int16)
        assert np.max(np.abs(samples)) > 0


class TestPcm16ToMulaw:
    def test_basic_conversion(self):
        """PCM16 bytes should convert to mulaw bytes."""
        # Generate silent PCM16 at 16kHz
        pcm_data = b"\x00\x00" * 1600  # 100ms at 16kHz
        result = pcm16_to_mulaw(pcm_data, input_rate=16000)
        assert isinstance(result, bytes)
        # Should downsample to 8kHz, each sample becomes 1 mulaw byte
        assert len(result) == 800

    def test_same_rate_no_resample(self):
        """When input_rate is 8kHz, no resampling should occur."""
        pcm_data = b"\x00\x00" * 80
        result = pcm16_to_mulaw(pcm_data, input_rate=8000)
        assert isinstance(result, bytes)
        assert len(result) == 80  # Each 2-byte PCM16 sample -> 1 mulaw byte

    def test_output_is_bytes(self):
        """Output should be plain bytes."""
        pcm_data = b"\x00\x00" * 160
        result = pcm16_to_mulaw(pcm_data, input_rate=16000)
        assert isinstance(result, bytes)


class TestRoundtrip:
    def test_mulaw_pcm16_mulaw_approximate_lossless(self):
        """Round-trip mulaw -> PCM16 -> mulaw should be approximately lossless."""
        original = bytes(range(256)) * 4  # 1024 bytes, various amplitudes

        pcm16 = mulaw_to_pcm16(original, target_rate=8000)
        roundtrip = pcm16_to_mulaw(pcm16, input_rate=8000)

        assert len(roundtrip) == len(original)
        # mulaw has quantization near zero where 0x7F and 0xFF both decode
        # to near-zero PCM values. Compare decoded PCM values instead.
        orig_pcm = np.frombuffer(
            mulaw_to_pcm16(original, target_rate=8000), dtype=np.int16
        )
        rt_pcm = np.frombuffer(
            mulaw_to_pcm16(roundtrip, target_rate=8000), dtype=np.int16
        )
        # All decoded values should be identical (no information lost)
        np.testing.assert_array_equal(orig_pcm, rt_pcm)

    def test_roundtrip_with_resampling(self):
        """Round-trip with resampling should be approximately lossless."""
        # Use a simple signal
        original = b"\xff" * 800  # 100ms silence at 8kHz

        pcm16_16k = mulaw_to_pcm16(original, target_rate=16000)
        roundtrip = pcm16_to_mulaw(pcm16_16k, input_rate=16000)

        assert len(roundtrip) == len(original)
        # Silence should survive roundtrip
        original_decoded = np.frombuffer(
            mulaw_to_pcm16(original, target_rate=8000), dtype=np.int16
        )
        roundtrip_decoded = np.frombuffer(
            mulaw_to_pcm16(roundtrip, target_rate=8000), dtype=np.int16
        )
        # RMS error should be very small for silence
        rms_error = np.sqrt(
            np.mean((original_decoded.astype(float) - roundtrip_decoded.astype(float)) ** 2)
        )
        assert rms_error < 100  # Very small error tolerance


class TestBase64:
    def test_decode(self):
        """Base64 decode should produce original bytes."""
        original = b"\x00\x01\x02\x03\xff"
        encoded = base64.b64encode(original).decode("ascii")
        result = base64_decode_audio(encoded)
        assert result == original

    def test_encode(self):
        """Base64 encode should produce valid base64 string."""
        original = b"\x00\x01\x02\x03\xff"
        result = base64_encode_audio(original)
        assert isinstance(result, str)
        assert base64.b64decode(result) == original

    def test_roundtrip(self):
        """Encode then decode should return original."""
        original = b"hello audio data" * 100
        encoded = base64_encode_audio(original)
        decoded = base64_decode_audio(encoded)
        assert decoded == original


class TestChunkAudio:
    def test_exact_chunks(self):
        """Audio that divides evenly should produce exact chunks."""
        # 20ms at 8kHz mulaw = 160 bytes per chunk
        audio = b"\xff" * 480  # 3 chunks of 160
        chunks = chunk_audio(audio, chunk_ms=20, sample_rate=8000, sample_width=1)
        assert len(chunks) == 3
        assert all(len(c) == 160 for c in chunks)

    def test_last_chunk_padded(self):
        """Last chunk should be padded to full size."""
        audio = b"\xff" * 200  # 1 full chunk (160) + partial (40)
        chunks = chunk_audio(audio, chunk_ms=20, sample_rate=8000, sample_width=1)
        assert len(chunks) == 2
        assert len(chunks[0]) == 160
        assert len(chunks[1]) == 160  # Padded

    def test_empty_audio(self):
        """Empty audio should produce no chunks."""
        chunks = chunk_audio(b"", chunk_ms=20, sample_rate=8000, sample_width=1)
        assert len(chunks) == 0


class TestGenerateSilence:
    def test_duration(self):
        """Generated silence should have correct duration."""
        silence = generate_silence_mulaw(100, sample_rate=8000)
        assert len(silence) == 800  # 100ms * 8 samples/ms

    def test_all_silence_bytes(self):
        """All bytes should be mulaw silence (0xFF)."""
        silence = generate_silence_mulaw(50, sample_rate=8000)
        assert all(b == 0xFF for b in silence)

    def test_zero_duration(self):
        """Zero duration should produce empty bytes."""
        silence = generate_silence_mulaw(0)
        assert len(silence) == 0
