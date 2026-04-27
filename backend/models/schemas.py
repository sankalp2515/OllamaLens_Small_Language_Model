"""
models.py
---------
All data models in one place: API request/response schemas (Pydantic)
and database table definitions (SQLModel).

WHY PYDANTIC v2?
  • Runtime validation — if a field is declared `float`, Pydantic rejects
    a string value at the boundary, not deep inside business logic.
  • Automatic JSON serialisation / deserialisation for FastAPI responses.
  • model_validator / field_validator hooks let us enforce complex rules
    (e.g. temperature must be 0–2) with a clear error message.

WHY SQLModel TABLES HERE TOO?
  One class does double duty: it IS the DB table AND the API schema.
  No risk of the two drifting out of sync.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional, Any

from pydantic import BaseModel, Field, field_validator, model_validator
from sqlmodel import SQLModel, Field as SQLField, Column, JSON


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class SupportedModel(str, Enum):
    """
    Enumerated model names.  Using an Enum (not a plain string) means
    FastAPI validates the value at the HTTP boundary and returns a clear
    422 error if an unsupported model name is passed.
    """
    LLAMA3      = "llama3:8b-instruct-q4_K_M"
    MISTRAL     = "mistral:7b-instruct-q4_K_M"
    PHI3        = "phi3:mini"


# ---------------------------------------------------------------------------
# Chat models
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    """
    A single turn in a conversation.

    WHY A SEPARATE CLASS FOR HISTORY?
    Rather than passing a raw string, we pass structured message objects.
    This lets the backend reconstruct the conversation in a standard
    [User]: / [Assistant]: format that all three models understand.
    It also makes the API self-documenting — callers know exactly what
    shape the history must be in.

    role must be "user" or "assistant" — matching the standard chat roles
    used by every major LLM API (OpenAI, Anthropic, Ollama).
    """
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., min_length=1)


class ChatRequest(BaseModel):
    """
    POST /chat/generate

    WHY not just accept a plain string prompt?
    Structured input lets us version the schema.  Adding `system`,
    `history`, and `options` in v1 means the frontend never needs a
    breaking change when we add memory / multi-turn support.

    WHY history IN THE REQUEST (not server-side session)?
    LLMs are stateless — Ollama has no concept of a session ID.
    The client is the source of truth for conversation history.
    This is the same architecture used by OpenAI's Chat Completions API:
    the caller sends the full message history every time.

    MEMORY APPROACH — SHORT-TERM CONTEXT WINDOW:
    We send the last N turns of conversation as a formatted string
    prepended to the current prompt.  The model reads this and
    "remembers" what was said.  This is not true long-term memory
    (that would require a vector DB) but covers 95% of chat use cases.
    """
    model: SupportedModel = SupportedModel.LLAMA3
    prompt: str = Field(..., min_length=1, max_length=8000)
    history: list[ChatMessage] = Field(
        default=[],
        description=(
            "Previous turns in the conversation. Send the full list each time. "
            "The backend will format this into a context string for the model."
        ),
    )
    system: Optional[str] = Field(
        default=None,
        description="System prompt — injected before the conversation history",
    )
    stream: bool = Field(
        default=True,
        description="If True, response is delivered as SSE chunks",
    )
    options: Optional[dict] = Field(
        default=None,
        description="Raw Ollama options (temperature, top_p, seed, …)",
    )

    @field_validator("prompt")
    @classmethod
    def prompt_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("prompt must not be blank or whitespace only")
        return v.strip()


class ChatResponse(BaseModel):
    """Non-streaming response envelope."""
    model: str
    response: str
    prompt_tokens: int
    eval_tokens: int
    total_duration_ms: float
    tokens_per_second: float


# ---------------------------------------------------------------------------
# Structured output models (JSON mode)
# ---------------------------------------------------------------------------

class StructuredRequest(ChatRequest):
    """
    POST /chat/structured

    Extends ChatRequest to request JSON-schema-conformant output.
    The backend will:
      1. Append a JSON instruction to the system prompt.
      2. Pass `format="json"` to Ollama.
      3. Parse + validate the output with Pydantic.
      4. Retry up to 3 times if the model returns malformed JSON.

    WHY retry for JSON?
    Small quantised models (especially phi3:mini) sometimes emit partial
    JSON or wrap output in markdown fences.  Rather than surfacing a
    500 error, the retry loop gives the model a second chance with an
    explicit correction message.
    """
    json_schema: dict = Field(
        ...,
        description=(
            "JSON Schema that the model output must conform to. "
            "Example: {'type':'object','properties':{'answer':{'type':'string'}}}"
        ),
    )


class StructuredResponse(BaseModel):
    """
    Structured output response.
    `data` holds the validated JSON object.
    `attempts` tells the caller how many tries it took — useful for
    monitoring model reliability over time.
    """
    model: str
    data: dict[str, Any]
    attempts: int
    raw_response: str
    tokens_per_second: float


# ---------------------------------------------------------------------------
# Benchmark DB table + API models
# ---------------------------------------------------------------------------

class BenchmarkRun(SQLModel, table=True):
    """
    Database table storing individual benchmark run results.

    WHY store per-run raw data instead of aggregates?
    Aggregates (mean, p50) are cheap to compute from raw data but
    impossible to reconstruct if you only stored aggregates.
    Raw data lets us add percentile charts later without re-running benchmarks.
    """
    id: Optional[int] = SQLField(default=None, primary_key=True)
    run_id: str = SQLField(default_factory=lambda: str(uuid.uuid4()), index=True)
    model: str
    prompt_hash: str           # SHA-256 of the prompt — avoids storing large prompts
    prompt_tokens: int
    eval_tokens: int
    time_to_first_token_ms: float   # TTFT: wall-clock ms until first token arrives
    total_duration_ms: float        # Wall-clock time for entire generation
    tokens_per_second: float        # eval_tokens / (total_duration_ms / 1000)
    gpu_used: bool = True
    created_at: datetime = SQLField(default_factory=datetime.utcnow)


class BenchmarkRequest(BaseModel):
    """
    POST /benchmark/run

    WHY allow custom `runs` per request (not just settings.BENCHMARK_RUNS)?
    During development a quick 1-run sanity check is useful.  For a
    final comparison report, 5+ runs give tighter confidence intervals.
    """
    model: SupportedModel
    prompt: Optional[str] = None      # falls back to DEFAULT_BENCHMARK_PROMPT
    runs: int = Field(default=3, ge=1, le=10)
    options: Optional[dict] = None


class RunStats(BaseModel):
    """Aggregate statistics for a single model across N runs."""
    model: str
    runs: int
    mean_tps: float
    median_tps: float
    min_tps: float
    max_tps: float
    mean_ttft_ms: float
    median_ttft_ms: float
    mean_total_ms: float
    mean_eval_tokens: float


class BenchmarkResponse(BaseModel):
    """
    POST /benchmark/run response.
    Returns both per-run detail and aggregated statistics.
    """
    run_id: str
    model: str
    prompt_used: str
    individual_runs: list[dict]
    stats: RunStats


# ---------------------------------------------------------------------------
# Model comparison models
# ---------------------------------------------------------------------------

class CompareRequest(BaseModel):
    """
    POST /compare/run

    Send the same prompt to multiple models simultaneously.
    WHY Optional[list[SupportedModel]]?
    Default None → compare ALL supported models.  Explicit list → subset.
    """
    prompt: str = Field(..., min_length=1)
    models: Optional[list[SupportedModel]] = None   # None = all models
    runs_per_model: int = Field(default=2, ge=1, le=5)


class ModelComparisonResult(BaseModel):
    """One model's result within a multi-model comparison."""
    model: str
    response_preview: str          # first 300 chars of the response
    stats: RunStats
    vram_estimate_gb: float        # rough estimate from model size


class CompareResponse(BaseModel):
    """
    POST /compare/run response.
    Includes a winner field so the frontend can highlight it.
    """
    prompt: str
    results: list[ModelComparisonResult]
    fastest_model: str
    highest_tps_model: str


# ---------------------------------------------------------------------------
# Report models
# ---------------------------------------------------------------------------

class ReportSection(BaseModel):
    """One section of the technical report."""
    title: str
    content: str
    data: Optional[dict] = None


class ReportResponse(BaseModel):
    """
    GET /report response.
    Generated from all benchmark data in the SQLite DB.
    """
    generated_at: datetime
    hardware: dict
    sections: list[ReportSection]
    raw_stats: list[RunStats]


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    status: str
    ollama_reachable: bool
    models_loaded: list[str]
    version: str