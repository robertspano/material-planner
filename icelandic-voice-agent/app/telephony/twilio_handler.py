"""Twilio incoming call webhook handler.

Returns TwiML to connect the call to a bidirectional Media Stream WebSocket.
Validates Twilio request signatures for security.
"""

from urllib.parse import urljoin

from fastapi import Request, Response
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import Connect, VoiceResponse

from app.utils.logging import get_logger

logger = get_logger(__name__)


def validate_twilio_request(
    request: Request,
    body: dict,
    auth_token: str,
) -> bool:
    """Validate incoming Twilio request signature.

    Args:
        request: FastAPI request object.
        body: Parsed form body as dict.
        auth_token: Twilio auth token for validation.

    Returns:
        True if the request is valid, False otherwise.
    """
    validator = RequestValidator(auth_token)
    signature = request.headers.get("X-Twilio-Signature", "")
    url = str(request.url)

    is_valid = validator.validate(url, body, signature)
    if not is_valid:
        logger.warning(
            "twilio_invalid_signature",
            url=url,
            signature=signature[:20] + "...",
        )
    return is_valid


def build_media_stream_twiml(
    base_url: str,
    call_sid: str,
    caller: str,
) -> str:
    """Build TwiML response that connects to our WebSocket Media Stream.

    The TwiML instructs Twilio to:
    1. Connect to a bidirectional WebSocket for audio streaming
    2. Pass custom parameters (call_sid, caller) to the stream

    Args:
        base_url: Public URL of the application (e.g., ngrok URL).
        call_sid: Twilio Call SID.
        caller: Caller phone number.

    Returns:
        TwiML XML string.
    """
    response = VoiceResponse()

    # Convert http(s):// to ws(s)://
    ws_url = base_url.replace("https://", "wss://").replace("http://", "ws://")
    ws_url = ws_url.rstrip("/")
    stream_url = f"{ws_url}/media-stream/{call_sid}"

    connect = Connect()
    stream = connect.stream(url=stream_url)
    stream.parameter(name="caller", value=caller)
    stream.parameter(name="call_sid", value=call_sid)

    response.append(connect)

    twiml = str(response)
    logger.info(
        "twilio_twiml_generated",
        call_sid=call_sid,
        caller=caller,
        stream_url=stream_url,
    )
    return twiml
