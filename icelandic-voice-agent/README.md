# Icelandic Voice Agent

AI-powered Icelandic phone agent built with FastAPI, Twilio, Google Chirp STT, Azure Neural TTS, and Claude.

## Architecture

```
Incoming Call (Twilio)
    │
    ▼
┌──────────────────┐
│  Twilio Webhook   │  POST /incoming-call
│  (TwiML response) │  Returns <Connect><Stream> TwiML
└──────┬───────────┘
       │
       ▼
┌──────────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Media Stream WS  │────▶│  Google STT   │────▶│   Claude LLM  │────▶│  Azure TTS   │
│  (bidirectional)  │     │  (Chirp v2)   │     │  (streaming)  │     │  (is-IS)     │
│                   │◀────│  is-IS        │     │  + tools      │     │  GudrunNeural│
└──────────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
   mulaw 8kHz              PCM16 16kHz          Text (sentences)      PCM16 → mulaw
```

## Components

| Component | Provider | Purpose |
|-----------|----------|---------|
| Telephony | Twilio Media Streams | Bidirectional audio WebSocket |
| STT | Google Cloud Speech V2 (Chirp) | Icelandic speech recognition |
| LLM | Anthropic Claude | Reasoning, conversation, tool use |
| TTS | Azure Neural TTS | Icelandic speech synthesis |

## Prerequisites

- Python 3.12+
- Twilio account with an Icelandic phone number (+354)
- Google Cloud project with Speech-to-Text API enabled
- Azure Speech Services resource (North Europe region)
- Anthropic API key

## Quick Start

1. **Clone and install dependencies:**
```bash
cd icelandic-voice-agent
pip install -r requirements.txt
```

2. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your API keys
```

3. **Start the server:**
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

4. **Expose to Twilio (development):**
```bash
ngrok http 8000
# Set BASE_URL in .env to the ngrok HTTPS URL
```

5. **Configure Twilio:**
   - Set your phone number's Voice webhook to `https://{BASE_URL}/incoming-call` (HTTP POST)

## Docker

```bash
# Create credentials directory for GCP service account
mkdir credentials
cp /path/to/service-account.json credentials/

# Build and run
docker compose up --build
```

## Running Tests

```bash
pip install pytest pytest-asyncio
python -m pytest tests/ -v
```

## Project Structure

```
app/
├── main.py                 # FastAPI entry point
├── config.py               # Environment configuration
├── telephony/
│   ├── twilio_handler.py   # Incoming call webhook + TwiML
│   └── media_stream.py     # WebSocket audio handler (core orchestration)
├── stt/
│   ├── base.py             # Abstract STT interface
│   ├── google_stt.py       # Google Cloud STT V2 + Chirp
│   └── whisper_stt.py      # Whisper fallback
├── tts/
│   ├── base.py             # Abstract TTS interface
│   └── azure_tts.py        # Azure Neural TTS (is-IS)
├── llm/
│   ├── claude_client.py    # Claude streaming with sentence detection
│   ├── system_prompt.py    # Icelandic agent persona
│   └── tools.py            # Function calling definitions
├── conversation/
│   ├── manager.py          # Per-call conversation state
│   └── models.py           # Data models
├── audio/
│   └── transcoder.py       # mulaw/PCM16 audio conversion
└── utils/
    └── logging.py          # Structured JSON logging
```

## Latency Optimizations

- **Sentence-level streaming**: Claude's response is streamed and split at sentence boundaries. Each sentence is sent to TTS immediately.
- **Filler phrases**: Pre-synthesized Icelandic phrases ("Augnablik...") are cached at startup for instant playback during tool calls.
- **Connection warmup**: All API connections are initialized and warmed up at startup.
- **Interruption handling**: Caller can interrupt the agent mid-sentence. Playback is cleared and the new utterance is processed immediately.

## Customization

The system prompt in `app/llm/system_prompt.py` defines the agent persona. Replace it for different businesses:
- Car dealership (default): search inventory, book test drives
- Restaurant: book tables, check menu
- Medical office: book appointments
- Generic customer service: answer questions, take messages

## Provider Decisions

- **STT**: Google Chirp is the best available cloud STT for Icelandic
- **TTS**: Azure is the only major cloud provider with Icelandic neural voices (Google TTS has no Icelandic support)
- **LLM**: Claude provides strong multilingual reasoning and native tool use
