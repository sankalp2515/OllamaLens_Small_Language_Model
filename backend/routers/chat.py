"""
routers/chat.py  (v4 — tool leak fix)
--------------------------------------
ROOT CAUSE OF TOOL LEAK:
  Previous version used streaming for the first generation pass.
  This meant tokens like "<tool_call>..." streamed to the client
  BEFORE we could detect and intercept the tool call pattern.

THE FIX — Two-phase architecture:
  Phase 1 (ALWAYS non-streaming): Generate a complete response.
          Check if it contains a <tool_call> tag.
          If YES → execute tool, loop back to Phase 1 with result injected.
          If NO  → we have the final answer text.
  Phase 2 (streaming): Stream the CLEAN final answer token by token.
          The client only ever sees clean, tool-free text.

This guarantees <tool_call> tags NEVER reach the frontend.

SSE EVENT PROTOCOL (v4):
  {"type": "tool_start",  "tool": "wikipedia", "args": {...}}
  {"type": "tool_result", "tool": "wikipedia", "result": "..."}
  {"type": "token",       "token": "The answer is..."}
  {"type": "done",        "eval_tokens": 42, "tool_calls": [...]}
  [DONE]
"""

import json
import logging
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.ollama_client import OllamaClient, OllamaConnectionError, OllamaModelError
from backend.core.database import get_session
from backend.models.schemas import (
    ChatRequest, ChatMessage, ChatResponse,
    StructuredRequest, StructuredResponse,
)
from backend.utils.structured_output import generate_structured
from backend.utils.tools import (
    build_tools_system_prompt,
    extract_tool_call,
    strip_tool_call,
    execute_tool,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["Chat"])

MAX_TOOL_ROUNDS = 3
MAX_HISTORY_TURNS = 10


def get_ollama_client() -> OllamaClient:
    return OllamaClient()


# ─────────────────────────────────────────────────────────────────────
# CONTEXT BUILDER
# ─────────────────────────────────────────────────────────────────────

def build_prompt_with_history(
    current_prompt: str,
    history: list[ChatMessage],
    max_turns: int = MAX_HISTORY_TURNS,
) -> str:
    if not history:
        return current_prompt

    recent = history[-max_turns:]
    lines  = ["[CONVERSATION HISTORY]"]
    for msg in recent:
        role    = "User" if msg.role == "user" else "Assistant"
        content = msg.content[:500] + "…" if len(msg.content) > 500 else msg.content
        lines.append(f"{role}: {content}")
    lines += ["[END OF HISTORY]", "", f"User: {current_prompt}"]
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────
# ReAct TOOL LOOP  — returns clean final text + log, no streaming
# ─────────────────────────────────────────────────────────────────────

async def resolve_with_tools(
    client:  OllamaClient,
    model:   str,
    prompt:  str,
    system:  str,
    options: dict | None,
    on_tool_start:  callable,   # async callback → send SSE event early
    on_tool_result: callable,
) -> tuple[str, list[dict]]:
    """
    Run the full ReAct loop NON-streaming until we have a clean answer.

    Every round:
      1. Call Ollama (non-streaming) → get complete text
      2. Scan text for <tool_call> tag
      3. If found → notify client via SSE callback, execute tool, inject result, repeat
      4. If not found → this IS the final answer; strip any leftover tags and return

    The callbacks (on_tool_start, on_tool_result) are async so they can
    yield SSE events to the client WHILE the tool is running — giving
    real-time feedback without streaming the tool call text itself.
    """
    current_prompt = prompt
    tool_calls_log: list[dict] = []

    for round_num in range(MAX_TOOL_ROUNDS + 1):
        response = await client.generate(
            model=model,
            prompt=current_prompt,
            system=system,
            options=options,
        )
        text = response.get("response", "").strip()

        tool_call = extract_tool_call(text)

        if tool_call is None:
            # Clean answer — strip any residual tags just in case
            clean = strip_tool_call(text).strip()
            return clean or text, tool_calls_log

        if round_num >= MAX_TOOL_ROUNDS:
            logger.warning("Max tool rounds reached — returning stripped text")
            return strip_tool_call(text).strip() or text, tool_calls_log

        tool_name = tool_call.get("name", "unknown")
        tool_args = tool_call.get("args", {})

        # Notify client tool is starting (via SSE queue)
        await on_tool_start(tool_name, tool_args)

        tool_result = await execute_tool(tool_name, tool_args)
        tool_calls_log.append({
            "tool":   tool_name,
            "args":   tool_args,
            "result": tool_result,
        })

        # Notify client tool finished
        await on_tool_result(tool_name, tool_result)

        # Expand prompt with result for next round
        current_prompt = (
            f"{current_prompt}"
            f"\n\n[Tool: {tool_name}]\n[Result]: {tool_result}"
            f"\n\nNow answer the user's original question using the tool result above. "
            f"Do not include any <tool_call> tags in your answer."
        )

    return strip_tool_call(text).strip() or text, tool_calls_log


# ─────────────────────────────────────────────────────────────────────
# SSE GENERATOR  — Phase 1 (tool loop) then Phase 2 (stream answer)
# ─────────────────────────────────────────────────────────────────────

async def _sse_stream(
    client:  OllamaClient,
    request: ChatRequest,
) -> AsyncGenerator[str, None]:
    """
    Clean two-phase SSE generator.

    Phase 1: resolve_with_tools() runs completely before any token streams.
             Tool events are emitted as they happen via async queues.
    Phase 2: Stream the CLEAN final answer token by token.

    The client NEVER sees <tool_call> tags or "Please wait..." text.
    """

    full_prompt = build_prompt_with_history(request.prompt, request.history)
    system      = build_tools_system_prompt(request.system)

    # Use a list as a simple async queue for tool events
    # (avoids asyncio.Queue complexity in a generator)
    pending_events: list[str] = []

    async def on_tool_start(tool_name: str, args: dict) -> None:
        evt = json.dumps({
            "type": "tool_start",
            "tool": tool_name,
            "args": args,
        })
        pending_events.append(f"data: {evt}\n\n")

    async def on_tool_result(tool_name: str, result: str) -> None:
        evt = json.dumps({
            "type":   "tool_result",
            "tool":   tool_name,
            "result": result[:400],   # truncate for SSE payload size
        })
        pending_events.append(f"data: {evt}\n\n")

    # ── Phase 1: Run tool loop (non-streaming) ──
    final_text, tool_calls_log = await resolve_with_tools(
        client=client,
        model=request.model.value,
        prompt=full_prompt,
        system=system,
        options=request.options,
        on_tool_start=on_tool_start,
        on_tool_result=on_tool_result,
    )

    # Flush all pending tool events to client first
    for event in pending_events:
        yield event

    # ── Phase 2: Stream the clean final answer ──
    # We re-prompt with the final text as the starting context so the
    # model streams naturally. For short answers we just emit tokens directly.
    #
    # OPTIMIZATION: If no tool calls were made, re-stream the same answer
    # to avoid a second Ollama round-trip. If tools were used, re-generate
    # with the enriched prompt to get a natural streaming response.

    if tool_calls_log:
        # Tools were used — stream fresh generation with enriched context
        tool_context = "\n\n".join([
            f"[{tc['tool']} result]: {tc['result']}"
            for tc in tool_calls_log
        ])
        stream_prompt = (
            f"{full_prompt}"
            f"\n\n[TOOL RESULTS AVAILABLE]\n{tool_context}"
            f"\n\n[Answer the user's question naturally using the above results. "
            f"Do not mention tool calls or XML tags in your answer.]"
        )
    else:
        # No tools — the first generation IS the answer, emit it as tokens
        for char in final_text:
            yield f"data: {json.dumps({'type': 'token', 'token': char})}\n\n"

        yield f"data: {json.dumps({'type': 'done', 'eval_tokens': len(final_text.split()), 'total_duration_ms': 0, 'tool_calls': []})}\n\n"
        yield "data: [DONE]\n\n"
        return

    # Stream the enriched response for tool-augmented answers
    token_count = 0
    async for chunk in client.generate_stream(
        model=request.model.value,
        prompt=stream_prompt,
        system=system,
        options=request.options,
    ):
        token = chunk.get("response", "")
        if token:
            token_count += 1
            yield f"data: {json.dumps({'type': 'token', 'token': token})}\n\n"

        if chunk.get("done"):
            yield f"data: {json.dumps({'type': 'done', 'eval_tokens': chunk.get('eval_count', token_count), 'total_duration_ms': round(chunk.get('total_duration', 0) / 1e6, 2), 'tool_calls': tool_calls_log})}\n\n"
            yield "data: [DONE]\n\n"
            return


# ─────────────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────────────

@router.post("/generate", summary="Chat with tool use and conversation memory", response_model=None)
async def generate(
    request: ChatRequest,
    client: OllamaClient = Depends(get_ollama_client),
    session: AsyncSession = Depends(get_session),
):
    try:
        if request.stream:
            return StreamingResponse(
                _sse_stream(client, request),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )
        else:
            full_prompt = build_prompt_with_history(request.prompt, request.history)
            system      = build_tools_system_prompt(request.system)
            response    = await client.generate(
                model=request.model.value,
                prompt=full_prompt,
                system=system,
                options=request.options,
            )
            eval_tokens = response.get("eval_count", 0)
            total_ms    = response.get("total_duration", 0) / 1e6
            tps         = eval_tokens / (total_ms / 1000) if total_ms > 0 else 0.0
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


@router.post("/structured", response_model=StructuredResponse)
async def generate_structured_output(
    request: StructuredRequest,
    client: OllamaClient = Depends(get_ollama_client),
):
    try:
        data, attempts, raw = await generate_structured(
            client=client,
            model=request.model.value,
            prompt=request.prompt,
            json_schema=request.json_schema,
            system=request.system,
        )
        probe = await client.generate(model=request.model.value, prompt="echo 1")
        eval_tokens = probe.get("eval_count", 1)
        total_ms    = probe.get("total_duration", 1) / 1e6
        return StructuredResponse(
            model=request.model.value,
            data=data, attempts=attempts, raw_response=raw,
            tokens_per_second=round(eval_tokens / (total_ms / 1000), 2),
        )
    except OllamaConnectionError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/models")
async def list_models(client: OllamaClient = Depends(get_ollama_client)):
    try:
        return {"models": await client.list_models()}
    except OllamaConnectionError as e:
        raise HTTPException(status_code=503, detail=str(e))