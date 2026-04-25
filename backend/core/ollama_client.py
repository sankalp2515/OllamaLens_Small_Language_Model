"""
ollama_client.py
----------------
Central HTTP client for all communication with the Ollama REST API.

WHY NOT USE THE OFFICIAL `ollama` PYTHON PACKAGE?
  The official package is convenient but abstracts away the raw HTTP layer,
  making it harder to instrument latency, stream raw chunks, and inject
  custom retry / timeout logic.  httpx gives us full async I/O, streaming,
  and per-request timeouts with no extra magic.

WHY httpx INSTEAD OF aiohttp OR requests?
  • httpx has a 1-to-1 API parity between sync and async — good for testing.
  • Built-in HTTP/2 support (Ollama 0.2+ speaks HTTP/2 locally).
  • Native HTTPX timeout object lets us separate connect vs. read timeouts,
    critical when first-token latency can be 5-30 s on cold models.
"""

import json
import time
import asyncio
from typing import AsyncGenerator, Optional

import httpx
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log,
)
import logging

from backend.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Timeout policy
# ---------------------------------------------------------------------------
# connect  – Ollama is local so 5 s is generous
# read     – 120 s covers cold-start of a 7B model on a 1660 Ti
# write    – prompt send is tiny
# pool     – prevents connection starvation under benchmark load
OLLAMA_TIMEOUT = httpx.Timeout(
    connect=5.0,
    read=120.0,
    write=10.0,
    pool=5.0,
)


class OllamaConnectionError(Exception):
    """Raised when we cannot reach the Ollama daemon at all."""


class OllamaModelError(Exception):
    """Raised when Ollama reports a model-level error (wrong name, not pulled)."""


class OllamaClient:
    """
    Async HTTP client that wraps the Ollama /api/* endpoints.

    Lifetime: create once at app startup, close at shutdown.
    Usage:
        client = OllamaClient()
        await client.aclose()
    """

    def __init__(self, base_url: str = None):
        self.base_url = base_url or settings.OLLAMA_BASE_URL
        # WHY a shared AsyncClient instead of per-request Client?
        # Connection pooling: keeps a TCP socket warm to Ollama.
        # On a 1660 Ti the GPU is the bottleneck, not the socket, but
        # for benchmark loops re-connecting every call adds ~3 ms noise.
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=OLLAMA_TIMEOUT,
            headers={"Content-Type": "application/json"},
        )

    async def aclose(self):
        await self._client.aclose()

    # ------------------------------------------------------------------
    # List available models
    # ------------------------------------------------------------------
    async def list_models(self) -> list[dict]:
        """Return all models currently pulled into Ollama."""
        try:
            resp = await self._client.get("/api/tags")
            resp.raise_for_status()
            return resp.json().get("models", [])
        except httpx.ConnectError as exc:
            raise OllamaConnectionError(
                f"Cannot reach Ollama at {self.base_url}. "
                "Is `ollama serve` running?"
            ) from exc

    # ------------------------------------------------------------------
    # Generate — non-streaming, with Tenacity retry
    # ------------------------------------------------------------------
    @retry(
        # WHY stop_after_attempt(3)?
        # One transient failure is common (model still loading into VRAM).
        # Three attempts covers the warm-up window without hanging forever.
        stop=stop_after_attempt(3),
        # WHY exponential back-off?
        # If the GPU is paging memory, hammering instantly worsens the
        # situation.  2^attempt seconds: 2 s → 4 s → give up.
        wait=wait_exponential(multiplier=1, min=2, max=8),
        retry=retry_if_exception_type((httpx.ReadTimeout, httpx.ConnectError)),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    async def generate(
        self,
        model: str,
        prompt: str,
        system: Optional[str] = None,
        format: Optional[str] = None,   # pass "json" to force JSON mode
        options: Optional[dict] = None,
    ) -> dict:
        """
        Single-shot generation (no streaming).
        Returns the full Ollama response dict including timing fields.

        WHY capture timing inside the client AND in the benchmarker?
        The Ollama response body contains eval_count / eval_duration which
        reflect GPU time only.  Wall-clock time (including HTTP overhead)
        is measured externally in benchmarker.py for honest TPS numbers.
        """
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            **({"system": system} if system else {}),
            **({"format": format} if format else {}),
            **({"options": options} if options else {}),
        }
        try:
            resp = await self._client.post("/api/generate", json=payload)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise OllamaModelError(
                    f"Model '{model}' not found. Run: ollama pull {model}"
                ) from exc
            raise

    # ------------------------------------------------------------------
    # Generate — streaming, yields text chunks + timing on last chunk
    # ------------------------------------------------------------------
    async def generate_stream(
        self,
        model: str,
        prompt: str,
        system: Optional[str] = None,
        options: Optional[dict] = None,
    ) -> AsyncGenerator[dict, None]:
        """
        Streaming generation.  Yields one dict per chunk.
        The final chunk has 'done': True and contains timing fields.

        WHY use a context manager for streaming?
        httpx streaming responses hold the socket open until explicitly
        closed.  Using `async with` ensures the socket is freed even if
        the caller breaks out of the async-for loop early (e.g. user
        disconnects from SSE endpoint).
        """
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": True,
            **({"system": system} if system else {}),
            **({"options": options} if options else {}),
        }
        try:
            async with self._client.stream(
                "POST", "/api/generate", json=payload
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line:
                        yield json.loads(line)
        except httpx.ConnectError as exc:
            raise OllamaConnectionError(
                f"Lost connection to Ollama during stream: {exc}"
            ) from exc

    # ------------------------------------------------------------------
    # Pull a model (with progress streaming)
    # ------------------------------------------------------------------
    async def pull_model(self, model: str) -> AsyncGenerator[dict, None]:
        """Streams pull progress so the API can relay it to the frontend."""
        async with self._client.stream(
            "POST", "/api/pull", json={"name": model}
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line:
                    yield json.loads(line)

    # ------------------------------------------------------------------
    # Show model info (parameter size, quantization level, etc.)
    # ------------------------------------------------------------------
    async def show_model(self, model: str) -> dict:
        resp = await self._client.post("/api/show", json={"name": model})
        resp.raise_for_status()
        return resp.json()
