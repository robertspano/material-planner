#!/usr/bin/env python3
"""Text-based chat test — talk to the Icelandic voice agent via terminal.

Usage:
    ANTHROPIC_API_KEY=sk-ant-xxx python3 scripts/chat_test.py

This lets you test the agent's personality, Icelandic responses, and
tool calling without needing Twilio, Google Cloud, or Azure.
Just type in Icelandic (or English) and the agent responds.
"""

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.llm.system_prompt import SYSTEM_PROMPT, GREETING
from app.llm.tools import TOOLS, execute_tool


def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        # Try reading from .env file
        env_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"
        )
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("ANTHROPIC_API_KEY=") and not line.startswith("#"):
                        api_key = line.split("=", 1)[1].strip()
                        break

    if not api_key or api_key.startswith("sk-ant-xxx"):
        print("=" * 60)
        print("  Vantar Anthropic API key!")
        print()
        print("  Keyrsla:")
        print("    ANTHROPIC_API_KEY=sk-ant-xxx python3 scripts/chat_test.py")
        print()
        print("  Eða settu lykilinn í .env skrána.")
        print("  Fáðu lykil á: https://console.anthropic.com/settings/keys")
        print("=" * 60)
        sys.exit(1)

    try:
        import anthropic
    except ImportError:
        print("Vantar anthropic pakka. Keyrðu: pip3 install anthropic")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    messages = []

    print("=" * 60)
    print("  Icelandic Voice Agent — Text Chat")
    print("  Talaðu við Sunnu á íslensku!")
    print("  Sláðu inn 'q' til að hætta.")
    print("=" * 60)
    print()
    print(f"🤖 Sunna: {GREETING}")
    print()

    while True:
        try:
            user_input = input("📞 Þú: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n\nBless!")
            break

        if not user_input:
            continue
        if user_input.lower() in ("q", "quit", "exit", "bless"):
            print("\n🤖 Sunna: Takk fyrir að hafa samband. Bless bless!")
            break

        messages.append({"role": "user", "content": user_input})

        # Call Claude with tools
        try:
            response = client.messages.create(
                model="claude-sonnet-4-5-20250929",
                max_tokens=1024,
                temperature=0.7,
                system=SYSTEM_PROMPT,
                messages=messages,
                tools=TOOLS,
            )

            # Handle tool use loop
            while response.stop_reason == "tool_use":
                assistant_content = response.content
                messages.append({"role": "assistant", "content": assistant_content})

                tool_results = []
                for block in assistant_content:
                    if block.type == "tool_use":
                        print(f"   🔧 [{block.name}] {json.dumps(block.input, ensure_ascii=False)}")
                        result = asyncio.run(execute_tool(block.name, block.input))
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": result,
                        })

                messages.append({"role": "user", "content": tool_results})

                response = client.messages.create(
                    model="claude-sonnet-4-5-20250929",
                    max_tokens=1024,
                    temperature=0.7,
                    system=SYSTEM_PROMPT,
                    messages=messages,
                    tools=TOOLS,
                )

            # Extract text response
            text_parts = []
            for block in response.content:
                if hasattr(block, "text"):
                    text_parts.append(block.text)

            full_response = " ".join(text_parts)
            messages.append({"role": "assistant", "content": full_response})

            print(f"\n🤖 Sunna: {full_response}\n")

        except anthropic.AuthenticationError:
            print("\n❌ API lykillinn er rangur. Athugaðu ANTHROPIC_API_KEY.\n")
            break
        except anthropic.RateLimitError:
            print("\n⏳ Of margar beiðnir. Bíddu aðeins og reyndu aftur.\n")
        except Exception as e:
            print(f"\n❌ Villa: {e}\n")


if __name__ == "__main__":
    main()
