"""
routers/chat.py
---------------
Endpoints for interactive chat with local LLMs.

ENDPOINTS
  POST /chat/generate          — single-shot or streaming text generation
  POST /chat/structured        — JSON-mode generation with Pydantic validation
  GET  /chat/models            — list available Ollama models

WHY SERVER-SENT EVENTS (SSE) INSTEAD OF WEBSOCKETS?
  SSE is one-directional: server → client.
  For token streaming the client only ever listens, never sends mid-stream.
  SSE:
    • Works over plain HTTP (no upgrade handshake)
    • Automatically reconnects on disconnect
    • Supported natively by browsers (EventSource API)
    • No extra library needed on the backend (just text/event-stream mime type)
  WebSockets would add complexity (ws:// vs http://, connection lifecycle)
  for zero benefit in this unidirectional streaming case.
"""

import json
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.ollama_client import OllamaClient, OllamaConnectionError, OllamaModelError
from backend.core.database import get_session
from backend.models.schemas import (
    ChatRequest,
    ChatResponse,
    StructuredRequest,
    StructuredResponse,
    HealthResponse,
)
from backend.utils.structured_output import generate_structured

router = APIRouter(prefix="/chat", tags=["Chat"])


# ---------------------------------------------------------------------------
# Dependency: share one OllamaClient per request (injected by FastAPI DI)
# ---------------------------------------------------------------------------
# WHY NOT a module-level singleton?
# FastAPI's dependency injection makes it easy to swap the client in tests
# with a mock.  A module-level singleton is harder to patch.
def get_ollama_client() -> OllamaClient:
    return OllamaClient()


# ---------------------------------------------------------------------------
# SSE helpers
# ---------------------------------------------------------------------------

async def _token_stream(
    client: OllamaClient,
    request: ChatRequest,
) -> AsyncGenerator[str, None]:
    """
    Wraps OllamaClient.generate_stream() into SSE-formatted strings.

    SSE wire format:
        data: {"token": "Hello"}\n\n
        data: {"token": " world"}\n\n
        data: [DONE]\n\n

    WHY include [DONE] sentinel?
    EventSource doesn't have a built-in "stream ended" concept.
    The frontend listens for `data: [DONE]` to close the connection cleanly.
    """
    async for chunk in client.generate_stream(
        model=request.model.value,
        prompt=request.prompt,
        system=request.system,
        options=request.options,
    ):
        token = chunk.get("response", "")
        if token:
            payload = json.dumps({"token": token})
            yield f"data: {payload}\n\n"

        if chunk.get("done"):
            # Send final timing metadata before closing
            meta = {
                "done": True,
                "eval_tokens": chunk.get("eval_count", 0),
                "total_duration_ms": round(chunk.get("total_duration", 0) / 1e6, 2),
            }
            yield f"data: {json.dumps(meta)}\n\n"
            yield "data: [DONE]\n\n"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post(
    "/generate",
    summary="Generate a chat response (streaming or non-streaming)",
    response_model=None,  # StreamingResponse has dynamic content type
)
async def generate(
    request: ChatRequest,
    client: OllamaClient = Depends(get_ollama_client),
    session: AsyncSession = Depends(get_session),
):
    """
    If `stream=True` (default): returns text/event-stream (SSE).
    If `stream=False`: returns application/json with full response.

    WHY BOTH MODES ON ONE ENDPOINT?
    The frontend can request non-streaming for use cases like the benchmark
    runner (where we need the full response at once to measure total time)
    and streaming for interactive chat (where partial tokens improve UX).
    """
    try:
        if request.stream:
            return StreamingResponse(
                _token_stream(client, request),
                media_type="text/event-stream",
                headers={
                    # Prevent nginx/CDN from buffering the SSE stream
                    "Cache-Control": "no-cache",
                    "X-Accel-Buffering": "no",
                },
            )
        else:
            response = await client.generate(
                model=request.model.value,
                prompt=request.prompt,
                system=request.system,
                options=request.options,
            )
            eval_tokens = response.get("eval_count", 0)
            total_ms = response.get("total_duration", 0) / 1e6
            tps = eval_tokens / (total_ms / 1000) if total_ms > 0 else 0.0

            return ChatResponse(
                model=request.model.value,
                response=response.get("response", ""),
                prompt_tokens=response.get("prompt_eval_count", 0),
                eval_tokens=eval_tokens,
                total_duration_ms=round(total_ms, 2),
                tokens_per_second=round(tps, 2),
            )

    except OllamaConnectionError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except OllamaModelError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post(
    "/structured",
    response_model=StructuredResponse,
    summary="Generate JSON output validated against a provided schema",
)
async def generate_structured_output(
    request: StructuredRequest,
    client: OllamaClient = Depends(get_ollama_client),
):
    """
    Forces the model to produce JSON conforming to `json_schema`.
    Retries up to 3 times with corrective prompts on malformed output.

    Example json_schema:
    ```json
    {
      "type": "object",
      "properties": {
        "summary": {"type": "string"},
        "keywords": {"type": "array", "items": {"type": "string"}},
        "sentiment": {"type": "string", "enum": ["positive","negative","neutral"]}
      },
      "required": ["summary", "keywords", "sentiment"]
    }
    ```
    """
    try:
        data, attempts, raw = await generate_structured(
            client=client,
            model=request.model.value,
            prompt=request.prompt,
            json_schema=request.json_schema,
            system=request.system,
        )

        # Get TPS from a quick non-streaming call for metadata
        response = await client.generate(
            model=request.model.value,
            prompt="echo 1",  # lightweight probe for timing
        )
        eval_tokens = response.get("eval_count", 1)
        total_ms = response.get("total_duration", 1) / 1e6
        tps = eval_tokens / (total_ms / 1000)

        return StructuredResponse(
            model=request.model.value,
            data=data,
            attempts=attempts,
            raw_response=raw,
            tokens_per_second=round(tps, 2),
        )

    except OllamaConnectionError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get(
    "/models",
    summary="List models currently available in Ollama",
)
async def list_models(client: OllamaClient = Depends(get_ollama_client)):
    """Returns the raw Ollama model list (name, size, modified_at)."""
    try:
        return {"models": await client.list_models()}
    except OllamaConnectionError as e:
        raise HTTPException(status_code=503, detail=str(e))
