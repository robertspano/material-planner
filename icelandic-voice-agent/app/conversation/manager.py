"""Conversation state and history manager.

Manages per-call conversation history, turn counting, and cleanup.
"""

from datetime import UTC, datetime

from app.conversation.models import CallEvent, ConversationMetadata, Message, Role
from app.utils.logging import get_logger

logger = get_logger(__name__)


class ConversationManager:
    """Manages conversation state for a single call."""

    def __init__(
        self,
        call_sid: str,
        caller: str,
        max_turns: int = 50,
    ):
        self.metadata = ConversationMetadata(
            call_sid=call_sid,
            caller=caller,
        )
        self._max_turns = max_turns
        self._messages: list[Message] = []
        self._events: list[CallEvent] = []

    @property
    def call_sid(self) -> str:
        return self.metadata.call_sid

    @property
    def turn_count(self) -> int:
        return self.metadata.turn_count

    def add_user_message(self, text: str) -> None:
        """Add a user (caller) message to the conversation."""
        self._messages.append(Message(role=Role.USER, content=text))
        self.metadata.turn_count += 1
        logger.info(
            "conversation_user_message",
            call_sid=self.call_sid,
            turn=self.metadata.turn_count,
            text_length=len(text),
        )
        self._trim_if_needed()

    def add_assistant_message(self, text: str) -> None:
        """Add an assistant (agent) message to the conversation."""
        self._messages.append(Message(role=Role.ASSISTANT, content=text))
        logger.info(
            "conversation_assistant_message",
            call_sid=self.call_sid,
            text_length=len(text),
        )

    def add_event(self, event_type: str, data: dict | None = None) -> None:
        """Log a call event."""
        self._events.append(CallEvent(event_type=event_type, data=data or {}))

    def get_messages(self) -> list[dict]:
        """Get conversation history in Claude message format.

        Returns a list of {"role": "user"|"assistant", "content": "..."} dicts.
        """
        return [
            {"role": msg.role.value, "content": msg.content}
            for msg in self._messages
        ]

    def get_summary(self) -> str:
        """Generate a summary of the conversation so far."""
        if not self._messages:
            return "Ekkert samtal hefur átt sér stað."

        turns = len([m for m in self._messages if m.role == Role.USER])
        duration = datetime.now(UTC) - self.metadata.started_at
        minutes = int(duration.total_seconds() / 60)

        return (
            f"Samtal við {self.metadata.caller}, "
            f"{turns} umferðir á {minutes} mínútum. "
            f"Síðasta skilaboð: {self._messages[-1].content[:100]}"
        )

    def _trim_if_needed(self) -> None:
        """Trim conversation history if it exceeds max turns.

        Uses a sliding window, keeping the first 2 messages (initial context)
        and the most recent messages.
        """
        user_msg_count = sum(1 for m in self._messages if m.role == Role.USER)
        if user_msg_count <= self._max_turns:
            return

        # Keep first 2 messages + last (max_turns - 2) * 2 messages
        keep_recent = (self._max_turns - 2) * 2
        if keep_recent < 4:
            keep_recent = 4

        prefix = self._messages[:2]
        suffix = self._messages[-keep_recent:]

        # Insert a summary message between prefix and suffix
        summary = Message(
            role=Role.ASSISTANT,
            content=f"[Samantekt á fyrri hluta samtals: {self.get_summary()}]",
        )
        self._messages = prefix + [summary] + suffix

        logger.info(
            "conversation_trimmed",
            call_sid=self.call_sid,
            new_length=len(self._messages),
        )

    def cleanup(self) -> None:
        """Clean up conversation resources."""
        duration = datetime.now(UTC) - self.metadata.started_at
        logger.info(
            "conversation_cleanup",
            call_sid=self.call_sid,
            total_turns=self.metadata.turn_count,
            duration_seconds=duration.total_seconds(),
            message_count=len(self._messages),
        )
        self._messages.clear()
        self._events.clear()


# Global registry of active conversations
_active_conversations: dict[str, ConversationManager] = {}


def get_or_create_conversation(
    call_sid: str, caller: str = "", max_turns: int = 50
) -> ConversationManager:
    """Get an existing conversation or create a new one."""
    if call_sid not in _active_conversations:
        _active_conversations[call_sid] = ConversationManager(
            call_sid=call_sid, caller=caller, max_turns=max_turns
        )
    return _active_conversations[call_sid]


def remove_conversation(call_sid: str) -> None:
    """Remove and clean up a conversation."""
    if call_sid in _active_conversations:
        _active_conversations[call_sid].cleanup()
        del _active_conversations[call_sid]


def get_active_count() -> int:
    """Get the number of active conversations."""
    return len(_active_conversations)
