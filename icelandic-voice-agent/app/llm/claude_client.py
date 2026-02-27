"""Anthropic Claude API client with streaming and sentence-level output.

Streams Claude's response and yields complete sentences as soon as they're
detected, enabling parallel TTS synthesis for lowest time-to-first-audio.
"""

import re
from collections.abc import AsyncIterator
from dataclasses import dataclass

import anthropic

from app.llm.tools import TOOLS, execute_tool
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Icelandic abbreviations that should NOT trigger sentence boundaries
_ICELANDIC_ABBREVIATIONS = {
    "t.d.", "o.s.frv.", "þ.e.", "m.a.", "o.fl.", "þ.m.t.",
    "kr.", "nr.", "dr.", "hr.", "fru.", "st.",
}

# Pattern to detect sentence boundaries
_SENTENCE_END_RE = re.compile(r"[.!?]\s+")


@dataclass
class ToolCall:
    """Represents a tool call from Claude."""
    id: str
    name: str
    input: dict


class ClaudeClient:
    """Claude API client with streaming sentence detection."""

    def __init__(
        self,
        api_key: str,
        model: str = "claude-sonnet-4-5-20250929",
        max_tokens: int = 300,
        temperature: float = 0.7,
    ):
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model
        self._max_tokens = max_tokens
        self._temperature = temperature

    async def get_response(
        self,
        messages: list[dict],
        system_prompt: str,
        tools: list[dict] | None = None,
    ) -> AsyncIterator[str]:
        """Stream Claude's response and yield complete sentences.

        Detects sentence boundaries in streamed text and yields each sentence
        as soon as it's complete, allowing TTS to start immediately.

        Handles tool use: if Claude requests a tool, executes it, feeds the
        result back, and continues streaming.

        Args:
            messages: Conversation history in Claude message format.
            system_prompt: System prompt defining the agent persona.
            tools: Tool definitions for function calling.

        Yields:
            Complete sentences from Claude's response.
        """
        effective_tools = tools or TOOLS

        while True:
            sentences, tool_calls, full_text = await self._stream_response(
                messages=messages,
                system_prompt=system_prompt,
                tools=effective_tools,
            )

            # Yield all detected sentences
            for sentence in sentences:
                yield sentence

            if not tool_calls:
                break

            # Handle tool calls
            # Add assistant message with tool use to history
            assistant_content = []
            if full_text:
                assistant_content.append({"type": "text", "text": full_text})
            for tc in tool_calls:
                assistant_content.append({
                    "type": "tool_use",
                    "id": tc.id,
                    "name": tc.name,
                    "input": tc.input,
                })
            messages.append({"role": "assistant", "content": assistant_content})

            # Execute tools and add results
            tool_results = []
            for tc in tool_calls:
                logger.info("tool_call", name=tc.name, input=tc.input)
                result = await execute_tool(tc.name, tc.input)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tc.id,
                    "content": result,
                })

            messages.append({"role": "user", "content": tool_results})
            # Loop to get Claude's response after tool results

    async def _stream_response(
        self,
        messages: list[dict],
        system_prompt: str,
        tools: list[dict],
    ) -> tuple[list[str], list[ToolCall], str]:
        """Stream a single Claude API call.

        Returns:
            Tuple of (sentences, tool_calls, full_text).
        """
        import asyncio

        loop = asyncio.get_event_loop()

        def _do_stream():
            sentences = []
            tool_calls = []
            buffer = ""
            full_text = ""
            current_tool_name = ""
            current_tool_id = ""
            current_tool_input = ""

            with self._client.messages.stream(
                model=self._model,
                max_tokens=self._max_tokens,
                temperature=self._temperature,
                system=system_prompt,
                messages=messages,
                tools=tools,
            ) as stream:
                for event in stream:
                    if event.type == "content_block_start":
                        if hasattr(event.content_block, "type"):
                            if event.content_block.type == "tool_use":
                                current_tool_id = event.content_block.id
                                current_tool_name = event.content_block.name
                                current_tool_input = ""

                    elif event.type == "content_block_delta":
                        if hasattr(event.delta, "text"):
                            text = event.delta.text
                            buffer += text
                            full_text += text

                            # Try to extract complete sentences
                            extracted, remaining = _extract_sentences(buffer)
                            for s in extracted:
                                sentences.append(s)
                            buffer = remaining

                        elif hasattr(event.delta, "partial_json"):
                            current_tool_input += event.delta.partial_json

                    elif event.type == "content_block_stop":
                        if current_tool_name:
                            import json
                            try:
                                parsed_input = json.loads(current_tool_input) if current_tool_input else {}
                            except json.JSONDecodeError:
                                parsed_input = {}
                            tool_calls.append(ToolCall(
                                id=current_tool_id,
                                name=current_tool_name,
                                input=parsed_input,
                            ))
                            current_tool_name = ""
                            current_tool_id = ""
                            current_tool_input = ""

                    elif event.type == "message_stop":
                        pass

            # Flush remaining buffer as final sentence
            if buffer.strip():
                sentences.append(buffer.strip())

            return sentences, tool_calls, full_text

        return await loop.run_in_executor(None, _do_stream)

    async def warmup(self) -> None:
        """Warm up the Claude API connection."""
        logger.info("claude_warmup_start", model=self._model)
        try:
            # Make a minimal API call to warm up TLS and connection
            response = self._client.messages.create(
                model=self._model,
                max_tokens=10,
                messages=[{"role": "user", "content": "Halló"}],
            )
            logger.info(
                "claude_warmup_complete",
                response_text=response.content[0].text[:50] if response.content else "",
            )
        except Exception as e:
            logger.error("claude_warmup_failed", error=str(e))

    def close(self) -> None:
        """Clean up resources."""
        self._client.close()
        logger.info("claude_closed")


def _extract_sentences(text: str) -> tuple[list[str], str]:
    """Extract complete sentences from a text buffer.

    Handles Icelandic abbreviations that should NOT trigger sentence splits.

    Args:
        text: Text buffer that may contain partial and complete sentences.

    Returns:
        Tuple of (list of complete sentences, remaining buffer).
    """
    sentences = []
    remaining = text

    while True:
        match = _SENTENCE_END_RE.search(remaining)
        if not match:
            break

        # Check if this period is part of an abbreviation
        end_pos = match.start() + 1  # Position after the punctuation
        candidate = remaining[:end_pos]

        if _is_abbreviation_ending(candidate):
            # Skip this match — it's an abbreviation, not a sentence end
            # Look for the next match after this position
            next_search_start = match.end()
            next_match = _SENTENCE_END_RE.search(remaining[next_search_start:])
            if not next_match:
                break
            # Adjust the match position
            remaining_after = remaining[next_search_start:]
            sub_sentences, sub_remaining = _extract_sentences(remaining_after)
            if sub_sentences:
                # Prepend the abbreviation part to the first sub-sentence
                sentences.append(candidate + " " + sub_sentences[0])
                sentences.extend(sub_sentences[1:])
                remaining = sub_remaining
            break
        else:
            sentence = candidate.strip()
            if sentence:
                sentences.append(sentence)
            remaining = remaining[match.end():]

    return sentences, remaining


def _is_abbreviation_ending(text: str) -> bool:
    """Check if text ends with an Icelandic abbreviation."""
    text_lower = text.lower().rstrip()
    for abbr in _ICELANDIC_ABBREVIATIONS:
        if text_lower.endswith(abbr):
            return True
    return False
