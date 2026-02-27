"""Tests for conversation manager."""

import pytest

from app.conversation.manager import (
    ConversationManager,
    get_or_create_conversation,
    remove_conversation,
    get_active_count,
    _active_conversations,
)
from app.conversation.models import Role


class TestConversationManager:
    def test_init(self):
        cm = ConversationManager(call_sid="CA123", caller="+354123456")
        assert cm.call_sid == "CA123"
        assert cm.metadata.caller == "+354123456"
        assert cm.turn_count == 0

    def test_add_user_message(self):
        cm = ConversationManager(call_sid="CA123", caller="+354123456")
        cm.add_user_message("Halló")
        assert cm.turn_count == 1
        msgs = cm.get_messages()
        assert len(msgs) == 1
        assert msgs[0]["role"] == "user"
        assert msgs[0]["content"] == "Halló"

    def test_add_assistant_message(self):
        cm = ConversationManager(call_sid="CA123", caller="+354123456")
        cm.add_assistant_message("Góðan daginn!")
        msgs = cm.get_messages()
        assert len(msgs) == 1
        assert msgs[0]["role"] == "assistant"
        assert msgs[0]["content"] == "Góðan daginn!"

    def test_turn_count_increments_on_user_messages(self):
        cm = ConversationManager(call_sid="CA123", caller="+354123456")
        cm.add_user_message("Halló")
        cm.add_assistant_message("Bless")
        cm.add_user_message("Takk")
        assert cm.turn_count == 2  # Only user messages increment

    def test_get_messages_format(self):
        cm = ConversationManager(call_sid="CA123", caller="+354123456")
        cm.add_user_message("Halló")
        cm.add_assistant_message("Góðan daginn")
        cm.add_user_message("Eruð þið opin?")

        msgs = cm.get_messages()
        assert len(msgs) == 3
        assert msgs[0] == {"role": "user", "content": "Halló"}
        assert msgs[1] == {"role": "assistant", "content": "Góðan daginn"}
        assert msgs[2] == {"role": "user", "content": "Eruð þið opin?"}

    def test_get_summary_empty(self):
        cm = ConversationManager(call_sid="CA123", caller="+354123456")
        summary = cm.get_summary()
        assert "Ekkert samtal" in summary

    def test_get_summary_with_messages(self):
        cm = ConversationManager(call_sid="CA123", caller="+354123456")
        cm.add_user_message("Halló")
        cm.add_assistant_message("Góðan daginn")
        summary = cm.get_summary()
        assert "+354123456" in summary

    def test_cleanup(self):
        cm = ConversationManager(call_sid="CA123", caller="+354123456")
        cm.add_user_message("Test")
        cm.add_assistant_message("Reply")
        cm.cleanup()
        assert cm.get_messages() == []


class TestConversationTrimming:
    def test_no_trimming_under_limit(self):
        cm = ConversationManager(call_sid="CA123", caller="+354", max_turns=5)
        for i in range(4):
            cm.add_user_message(f"Msg {i}")
            cm.add_assistant_message(f"Reply {i}")
        # 4 turns < 5 max, no trimming
        assert len(cm.get_messages()) == 8

    def test_trimming_over_limit(self):
        cm = ConversationManager(call_sid="CA123", caller="+354", max_turns=5)
        for i in range(10):
            cm.add_user_message(f"Msg {i}")
            cm.add_assistant_message(f"Reply {i}")
        # Should have been trimmed
        msgs = cm.get_messages()
        assert len(msgs) < 20  # Much less than original 20

    def test_trimming_preserves_recent(self):
        cm = ConversationManager(call_sid="CA123", caller="+354", max_turns=3)
        for i in range(10):
            cm.add_user_message(f"Msg {i}")
            cm.add_assistant_message(f"Reply {i}")
        msgs = cm.get_messages()
        # Last message should still be present
        contents = [m["content"] for m in msgs]
        assert "Reply 9" in contents


class TestConversationRegistry:
    def setup_method(self):
        """Clear global registry before each test."""
        _active_conversations.clear()

    def test_create_conversation(self):
        cm = get_or_create_conversation("CA001", "+354111")
        assert cm.call_sid == "CA001"
        assert get_active_count() == 1

    def test_get_existing_conversation(self):
        cm1 = get_or_create_conversation("CA001", "+354111")
        cm1.add_user_message("Hello")
        cm2 = get_or_create_conversation("CA001")
        assert cm2 is cm1
        assert cm2.turn_count == 1

    def test_remove_conversation(self):
        get_or_create_conversation("CA001", "+354111")
        assert get_active_count() == 1
        remove_conversation("CA001")
        assert get_active_count() == 0

    def test_remove_nonexistent(self):
        remove_conversation("CA_NONEXISTENT")  # Should not raise

    def test_multiple_conversations(self):
        get_or_create_conversation("CA001", "+354111")
        get_or_create_conversation("CA002", "+354222")
        get_or_create_conversation("CA003", "+354333")
        assert get_active_count() == 3


class TestAddEvent:
    def test_add_event(self):
        cm = ConversationManager(call_sid="CA123", caller="+354")
        cm.add_event("stt_result", {"text": "Halló"})
        assert len(cm._events) == 1
        assert cm._events[0].event_type == "stt_result"

    def test_add_event_no_data(self):
        cm = ConversationManager(call_sid="CA123", caller="+354")
        cm.add_event("call_started")
        assert cm._events[0].data == {}
