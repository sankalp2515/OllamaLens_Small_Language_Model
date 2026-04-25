"""
routers/compare.py
------------------
Endpoints that run the same prompt across multiple models simultaneously
and return a side-by-side comparison.

ENDPOINTS
  POST /compare/run    — run comparison across models, return ranked results
  GET  /compare/latest — retrieve the most recent comparison from DB

WHY asyncio.gather() FOR MULTI-MODEL RUNS?
  Each model is loaded into VRAM sequentially by Ollama anyway (only one
  model active at a time on a 6 GB card).  So true parallelism isn't
  possible for the GPU work.  However, gathering the HTTP requests in
  parallel means:
    1. We send all requests immediately.
    2. Ollama queues them internally.
    3. We await all responses together.
  This gives cleaner code and future-proofs the design for multi-GPU setups.

  For the 1660 Ti (single GPU), the effective behaviour is sequential
  (GPU processes one model at a time) but the async structure doesn't hurt.
"""

import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.ollama_client import OllamaClient, OllamaConnectionError
from backend.core.database import get_session
from backend.core.config import settings
from backend.models.schemas import (
    CompareRequest,
    CompareResponse,
    ModelComparisonResult,
    SupportedModel,
)
from backend.utils.benchmarker import run_benchmark_suite, VRAM_ESTIMATES

import logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/compare", tags=["Model Comparison"])


def get_ollama_client() -> OllamaClient:
    return OllamaClient()


async def _compare_one_model(
    client: OllamaClient,
    model: str,
    prompt: str,
    runs: int,
) -> ModelComparisonResult:
    """Run benchmark suite for a single model, return ComparisonResult."""
    individual, stats = await run_benchmark_suite(
        client=client,
        model=model,
        prompt=prompt,
        runs=runs,
    )
    # Grab the response preview from the last run
    preview = individual[-1].get("response_preview", "")[:300] if individual else ""

    return ModelComparisonResult(
        model=model,
        response_preview=preview,
        stats=stats,
        vram_estimate_gb=VRAM_ESTIMATES.get(model, 0.0),
    )


@router.post(
    "/run",
    response_model=CompareResponse,
    summary="Compare multiple models on the same prompt",
)
async def compare_models(
    request: CompareRequest,
    client: OllamaClient = Depends(get_ollama_client),
    session: AsyncSession = Depends(get_session),
):
    """
    Sends the same prompt to multiple (or all) supported models and
    returns performance metrics side-by-side.

    Default: compares all three models (llama3, mistral, phi3).
    Pass `models` list to restrict to a subset.

    NOTE: On a single 6 GB GPU this runs sequentially under the hood
    (Ollama serialises GPU access), but the response is still a unified
    comparison view.
    """
    model_names = (
        [m.value for m in request.models]
        if request.models
        else [m.value for m in SupportedModel]
    )

    try:
        # Run each model comparison task.
        # asyncio.gather runs coroutines concurrently in the event loop;
        # on single-GPU hardware Ollama handles the serialisation.
        tasks = [
            _compare_one_model(client, model, request.prompt, request.runs_per_model)
            for model in model_names
        ]
        results: list[ModelComparisonResult] = await asyncio.gather(*tasks)

    except OllamaConnectionError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Compare failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

    # Rank by median TPS
    sorted_results = sorted(results, key=lambda r: r.stats.median_tps, reverse=True)

    return CompareResponse(
        prompt=request.prompt,
        results=sorted_results,
        fastest_model=sorted_results[0].model,       # lowest TTFT
        highest_tps_model=sorted_results[0].model,   # highest tokens/sec
    )
