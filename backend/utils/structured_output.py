"""
structured_output.py
--------------------
Forces the LLM to return valid JSON and validates it against a schema.

THE PROBLEM WITH LLM JSON OUTPUT
  Even with Ollama's `format="json"` flag, small quantised models will
  occasionally:
    • Wrap output in markdown fences (```json ... ```)
    • Produce trailing commas (invalid JSON)
    • Return partial output if the context window is exceeded
    • Add explanatory text before or after the JSON blob

THE SOLUTION: PARSE → VALIDATE → RETRY
  1. Strip known fence patterns with regex
  2. Attempt json.loads()
  3. Validate against user-supplied JSON Schema
  4. If any step fails, inject a correction message and retry (max 3×)

WHY jsonschema NOT pydantic FOR SCHEMA VALIDATION?
  The user supplies the schema at runtime as a dict — we don't know the
  shape ahead of time, so we can't create a static Pydantic model class.
  jsonschema.validate() works with arbitrary JSON Schema dicts at runtime.
  Pydantic is still used to validate our own fixed API request/response models.
"""

import json
import re
from typing import Any

import jsonschema
from tenacity import retry, stop_after_attempt, wait_fixed, RetryError

from backend.core.ollama_client import OllamaClient

import logging
logger = logging.getLogger(__name__)

# Regex to strip markdown code fences that models sometimes emit
# Handles: ```json...``` and ```...```
_FENCE_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL)


def _clean_json(raw: str) -> str:
    """
    Strip markdown fences and find the first {...} or [...] block.

    WHY find the first brace?
    Some models preface the JSON with a sentence like
    "Here is the answer:" followed by the actual JSON blob.
    Searching for the opening brace / bracket skips that preamble.
    """
    # Try stripping fences first
    match = _FENCE_RE.match(raw.strip())
    if match:
        return match.group(1)

    # Find the first JSON container character
    for i, char in enumerate(raw):
        if char in ("{", "["):
            return raw[i:]

    return raw  # give up cleaning, let json.loads raise a meaningful error


def _build_correction_prompt(original_prompt: str, bad_response: str, error: str) -> str:
    """
    Construct a follow-up prompt that shows the model what went wrong.

    WHY include the error message?
    Models can often self-correct when shown the specific parse error.
    "Expected ',' delimiter: line 3 column 5" is more actionable than
    a generic "try again" instruction.
    """
    return (
        f"{original_prompt}\n\n"
        f"Your previous response was not valid JSON. Error: {error}\n"
        f"Previous response: {bad_response[:200]}\n"
        f"Respond with ONLY valid JSON matching the requested schema. "
        f"No markdown fences, no extra text."
    )


async def generate_structured(
    client: OllamaClient,
    model: str,
    prompt: str,
    json_schema: dict,
    system: str | None = None,
    max_attempts: int = 3,
) -> tuple[dict[str, Any], int, str]:
    """
    Generate structured (JSON) output with automatic retry on failure.

    Returns:
        (validated_data, attempt_count, raw_response)

    Raises:
        ValueError: if all attempts are exhausted without valid JSON
    """
    # Append JSON instruction to system prompt
    json_instruction = (
        "You must respond with ONLY valid JSON that matches this schema:\n"
        f"{json.dumps(json_schema, indent=2)}\n"
        "Do not include any explanation, markdown, or extra text."
    )
    full_system = f"{system}\n\n{json_instruction}" if system else json_instruction

    current_prompt = prompt
    last_error = ""
    last_raw = ""

    for attempt in range(1, max_attempts + 1):
        logger.info(f"Structured output attempt {attempt}/{max_attempts} — model={model}")

        response = await client.generate(
            model=model,
            prompt=current_prompt,
            system=full_system,
            format="json",   # Ollama-level JSON mode — constrains token sampling
        )

        raw = response.get("response", "")
        last_raw = raw

        try:
            cleaned = _clean_json(raw)
            parsed = json.loads(cleaned)
            jsonschema.validate(instance=parsed, schema=json_schema)
            logger.info(f"Structured output succeeded on attempt {attempt}")
            return parsed, attempt, raw

        except (json.JSONDecodeError, jsonschema.ValidationError) as exc:
            last_error = str(exc)
            logger.warning(f"Attempt {attempt} failed: {last_error}")
            if attempt < max_attempts:
                # Build corrective prompt for next attempt
                current_prompt = _build_correction_prompt(prompt, raw, last_error)
            # If this was the last attempt, fall through to raise

    raise ValueError(
        f"Failed to get valid JSON after {max_attempts} attempts. "
        f"Last error: {last_error}\nLast response: {last_raw[:300]}"
    )
