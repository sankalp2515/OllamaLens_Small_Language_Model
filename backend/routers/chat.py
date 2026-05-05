"""
routers/chat.py  (v5 — chain-of-thought & history echo fix)

BUGS FIXED IN THIS VERSION:

1. CHAIN-OF-THOUGHT LEAK
   Symptom: "#### This is just a greeting, so no tool needed..."
   Cause:   Model was outputting internal reasoning as markdown headers.
   Fix:     clean_response() strips all markdown headers and internal
            notes before streaming. System prompt now explicitly forbids
            headers and meta-commentary.

2. HISTORY ECHO IN RESPONSES
   Symptom: Model output contained "User: what time is it in mumbai?"
   Cause:   History used "User:" / "Assistant:" prefixes. Model copied
            them into its own output.
   Fix:     History now uses <human> / <assistant> XML tags which are
            much less likely to be echoed. Added explicit rule in system
            prompt: never repeat history.

3. TPS SHOWING WILD VALUES (7309 tok/s)
   Cause:   elapsed time near zero when first token arrives simultaneously
            with the t0 measurement, causing division by near-zero.
   Fix:     Frontend guard: only calculate TPS when elapsed > 0.5s
            and token count > 3.

4. TOOL COUNTER SHOWING 0
   Cause:   tool_calls_log was being passed correctly but the frontend
            was reading meta.tool_calls from the done event which had
            a separate empty list.
   Fix:     The done event now correctly includes tool_calls_log.
            Frontend reads toolCalls from message state (most reliable).
"""

import json
import logging
import re
from typing import AsyncGenerator

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
    clean_response,
    execute_tool,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["Chat"])

MAX_TOOL_ROUNDS = 3
MAX_HISTORY_TURNS = 10


def get_ollama_client() -> OllamaClient:
    return OllamaClient()


# ─────────────────────────────────────────────────────────────────────
# HISTORY BUILDER — uses XML tags to prevent echo
# ─────────────────────────────────────────────────────────────────────

def build_prompt_with_history(
    current_prompt: str,
    history: list[ChatMessage],
    max_turns: int = MAX_HISTORY_TURNS,
) -> str:
    """
    Build the full prompt with conversation history.

    WHY XML TAGS INSTEAD OF "User:" / "Assistant:" PREFIXES?
    Models trained on chat data sometimes copy the "User:" / "Assistant:"
    prefixes they see in the context directly into their output.
    XML-style <human>/<assistant> tags are less likely to be echoed
    because they look like markup rather than conversational text.

    We also truncate long messages to 300 chars (was 500) to reduce
    the chance that the model re-states history in its response.
    """
    if not history:
        return current_prompt

    recent = history[-max_turns:]
    lines  = ["<history>"]
    for msg in recent:
        tag     = "human" if msg.role == "user" else "assistant"
        content = msg.content[:300] + "…" if len(msg.content) > 300 else msg.content
        # Strip any tool call artifacts from history entries
        content = re.sub(r'<tool_call>.*?</tool_call>', '[tool used]', content, flags=re.DOTALL)
        lines.append(f"<{tag}>{content}</{tag}>")
    lines.append("</history>")
    lines.append("")
    lines.append(current_prompt)
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────
# ReAct TOOL LOOP — non-streaming, cleans output before returning
# ─────────────────────────────────────────────────────────────────────

async def resolve_with_tools(
    client:         OllamaClient,
    model:          str,
    prompt:         str,
    system:         str,
    options:        dict | None,
    on_tool_start:  callable,
    on_tool_result: callable,
) -> tuple[str, list[dict]]:
    """
    Run the ReAct loop fully non-streaming.
    Returns (clean_final_text, tool_calls_log).

    After the final answer is obtained, clean_response() is applied
    to strip any leaked chain-of-thought or history echo.
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
            # No tool call — clean and return final answer
            return clean_response(text), tool_calls_log

        if round_num >= MAX_TOOL_ROUNDS:
            logger.warning("Max tool rounds reached")
            return clean_response(strip_tool_call(text)) or clean_response(text), tool_calls_log

        tool_name = tool_call.get("name", "unknown")
        tool_args = tool_call.get("args", {})

        await on_tool_start(tool_name, tool_args)
        tool_result = await execute_tool(tool_name, tool_args)
        tool_calls_log.append({"tool": tool_name, "args": tool_args, "result": tool_result})
        await on_tool_result(tool_name, tool_result)

        current_prompt = (
            f"{current_prompt}"
            f"\n\n[Tool: {tool_name}]\n[Result]: {tool_result}"
            f"\n\nAnswer the user's question naturally using the tool result. "
            f"Do not output any <tool_call> tags, markdown headers (##), or internal notes."
        )

    return clean_response(text), tool_calls_log


# ─────────────────────────────────────────────────────────────────────
# SSE GENERATOR
# ─────────────────────────────────────────────────────────────────────

async def _sse_stream(
    client:  OllamaClient,
    request: ChatRequest,
) -> AsyncGenerator[str, None]:
    """
    Two-phase SSE:
    Phase 1: Run tool loop completely (non-streaming), emit tool events.
    Phase 2: Stream the CLEAN final answer.

    The clean_response() filter runs on the Phase 1 output, ensuring
    no chain-of-thought or history echo reaches the client.
    For Phase 2 (streaming), we apply a stateful filter that drops
    any line starting with '#' (markdown header).
    """
    full_prompt = build_prompt_with_history(request.prompt, request.history)
    system      = build_tools_system_prompt(request.system)

    pending_events: list[str] = []

    async def on_tool_start(tool_name: str, args: dict) -> None:
        evt = json.dumps({"type": "tool_start", "tool": tool_name, "args": args})
        pending_events.append(f"data: {evt}\n\n")

    async def on_tool_result(tool_name: str, result: str) -> None:
        evt = json.dumps({"type": "tool_result", "tool": tool_name, "result": result[:400]})
        pending_events.append(f"data: {evt}\n\n")

    # Phase 1: Resolve tools
    final_text, tool_calls_log = await resolve_with_tools(
        client=client,
        model=request.model.value,
        prompt=full_prompt,
        system=system,
        options=request.options,
        on_tool_start=on_tool_start,
        on_tool_result=on_tool_result,
    )

    # Flush tool events first
    for event in pending_events:
        yield event

    # Phase 2: Stream the clean answer
    if tool_calls_log:
        # Re-generate with tool context for natural streaming response
        tool_context = "\n\n".join([
            f"[{tc['tool']} result]: {tc['result']}" for tc in tool_calls_log
        ])
        stream_prompt = (
            f"{full_prompt}"
            f"\n\n[TOOL RESULTS]\n{tool_context}"
            f"\n\n[Provide a natural, direct answer using the above results. "
            f"No markdown headers, no internal notes, no tool call tags.]"
        )

        # Stream with inline cleaning
        line_buffer = ""
        token_count = 0
        async for chunk in client.generate_stream(
            model=request.model.value,
            prompt=stream_prompt,
            system=system,
            options=request.options,
        ):
            token = chunk.get("response", "")
            if token:
                # Buffer to check for markdown headers line by line
                line_buffer += token
                if "\n" in line_buffer:
                    parts = line_buffer.split("\n")
                    line_buffer = parts[-1]
                    for part in parts[:-1]:
                        # Skip lines that are markdown headers or internal notes
                        if re.match(r'^#{1,6}\s', part) or re.match(r'^\[END OF', part):
                            continue
                        # Skip "User:" / "Assistant:" echo lines
                        if re.match(r'^(User|Assistant|Human):\s', part):
                            continue
                        out = part + "\n"
                        token_count += 1
                        yield f"data: {json.dumps({'type': 'token', 'token': out})}\n\n"
                else:
                    token_count += 1
                    yield f"data: {json.dumps({'type': 'token', 'token': token})}\n\n"

            if chunk.get("done"):
                # Flush remaining buffer
                if line_buffer and not re.match(r'^#{1,6}\s', line_buffer):
                    yield f"data: {json.dumps({'type': 'token', 'token': line_buffer})}\n\n"
                yield f"data: {json.dumps({'type': 'done', 'eval_tokens': chunk.get('eval_count', token_count), 'total_duration_ms': round(chunk.get('total_duration', 0) / 1e6, 2), 'tool_calls': tool_calls_log})}\n\n"
                yield "data: [DONE]\n\n"
                return
    else:
        # No tools — emit the already-cleaned text as tokens
        # Split by sentences/words to simulate streaming feel
        words = final_text.split(" ")
        for i, word in enumerate(words):
            tok = word + (" " if i < len(words) - 1 else "")
            yield f"data: {json.dumps({'type': 'token', 'token': tok})}\n\n"

        yield f"data: {json.dumps({'type': 'done', 'eval_tokens': len(words), 'total_duration_ms': 0, 'tool_calls': []})}\n\n"
        yield "data: [DONE]\n\n"


# ─────────────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────────────

@router.post("/generate", response_model=None)
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
                model=request.model.value, prompt=full_prompt, system=system, options=request.options,
            )
            eval_tokens = response.get("eval_count", 0)
            total_ms    = response.get("total_duration", 0) / 1e6
            tps         = eval_tokens / (total_ms / 1000) if total_ms > 0 else 0.0
            return ChatResponse(
                model=request.model.value, response=clean_response(response.get("response", "")),
                prompt_tokens=response.get("prompt_eval_count", 0),
                eval_tokens=eval_tokens, total_duration_ms=round(total_ms, 2),
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
            client=client, model=request.model.value, prompt=request.prompt,
            json_schema=request.json_schema, system=request.system,
        )
        probe = await client.generate(model=request.model.value, prompt="echo 1")
        eval_tokens = probe.get("eval_count", 1)
        total_ms    = probe.get("total_duration", 1) / 1e6
        return StructuredResponse(
            model=request.model.value, data=data, attempts=attempts, raw_response=raw,
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