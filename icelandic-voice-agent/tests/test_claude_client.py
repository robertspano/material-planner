"""Tests for Claude API client."""

import pytest

from app.llm.claude_client import (
    ClaudeClient,
    _extract_sentences,
    _is_abbreviation_ending,
)


class TestExtractSentences:
    def test_single_complete_sentence(self):
        sentences, remaining = _extract_sentences("Halló heimur. ")
        assert sentences == ["Halló heimur."]
        assert remaining == ""

    def test_two_sentences(self):
        sentences, remaining = _extract_sentences("Fyrsta setning. Önnur setning. ")
        assert sentences == ["Fyrsta setning.", "Önnur setning."]
        assert remaining == ""

    def test_incomplete_sentence(self):
        sentences, remaining = _extract_sentences("Þetta er ólokið")
        assert sentences == []
        assert remaining == "Þetta er ólokið"

    def test_complete_plus_incomplete(self):
        sentences, remaining = _extract_sentences("Setning eitt. Setning tvö")
        assert sentences == ["Setning eitt."]
        assert remaining == "Setning tvö"

    def test_question_mark(self):
        sentences, remaining = _extract_sentences("Hvernig hefur þú það? Vel. ")
        assert sentences == ["Hvernig hefur þú það?", "Vel."]

    def test_exclamation_mark(self):
        sentences, remaining = _extract_sentences("Frábært! Takk. ")
        assert sentences == ["Frábært!", "Takk."]

    def test_empty_string(self):
        sentences, remaining = _extract_sentences("")
        assert sentences == []
        assert remaining == ""

    def test_whitespace_only(self):
        sentences, remaining = _extract_sentences("   ")
        assert sentences == []
        assert remaining == "   "


class TestAbbreviationDetection:
    def test_td_is_abbreviation(self):
        assert _is_abbreviation_ending("t.d.") is True

    def test_osfrv_is_abbreviation(self):
        assert _is_abbreviation_ending("o.s.frv.") is True

    def test_kr_is_abbreviation(self):
        assert _is_abbreviation_ending("kr.") is True

    def test_sentence_end_not_abbreviation(self):
        assert _is_abbreviation_ending("heimur.") is False

    def test_in_context(self):
        assert _is_abbreviation_ending("Sjá t.d.") is True

    def test_random_word(self):
        assert _is_abbreviation_ending("bíll") is False


class TestClaudeClientInit:
    def test_creates_with_defaults(self):
        client = ClaudeClient(api_key="test-key")
        assert client._model == "claude-sonnet-4-5-20250929"
        assert client._max_tokens == 1024
        assert client._temperature == 0.7

    def test_creates_with_custom_params(self):
        client = ClaudeClient(
            api_key="test-key",
            model="claude-sonnet-4-5-20250929",
            max_tokens=512,
            temperature=0.5,
        )
        assert client._model == "claude-sonnet-4-5-20250929"
        assert client._max_tokens == 512
        assert client._temperature == 0.5


class TestSentenceExtractionEdgeCases:
    def test_abbreviation_mid_sentence(self):
        """Abbreviation in the middle should not split."""
        text = "Þetta er t.d. mjög gott. "
        sentences, remaining = _extract_sentences(text)
        # Should treat "t.d." as abbreviation and find the real sentence end
        assert len(sentences) >= 1
        assert "t.d." in sentences[0]

    def test_multiple_periods_at_end(self):
        sentences, remaining = _extract_sentences("Hmm... Jæja. ")
        # "..." followed by space should trigger
        assert len(sentences) >= 1

    def test_number_with_period(self):
        """Numbers with periods should be handled."""
        text = "Verðið er 5. milljónir. "
        sentences, remaining = _extract_sentences(text)
        assert len(sentences) >= 1
