"""
routers/benchmark.py
--------------------
Endpoints for running, storing, and retrieving benchmark results.

ENDPOINTS
  POST /benchmark/run          — run N inferences, store to SQLite, return stats
  GET  /benchmark/history      — list past runs from SQLite
  GET  /benchmark/history/{id} — single run detail
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from backend.core.ollama_client import OllamaClient, OllamaConnectionError, OllamaModelError
from backend.core.database import get_session
from backend.core.config import settings
from backend.models.schemas import (
    BenchmarkRequest,
    BenchmarkResponse,
    BenchmarkRun,
    SupportedModel,
)
from backend.utils.benchmarker import run_benchmark_suite

import logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/benchmark", tags=["Benchmark"])


def get_ollama_client() -> OllamaClient:
    return OllamaClient()


@router.post(
    "/run",
    response_model=BenchmarkResponse,
    summary="Run a benchmark suite for a single model",
)
async def run_benchmark(
    request: BenchmarkRequest,
    client: OllamaClient = Depends(get_ollama_client),
    session: AsyncSession = Depends(get_session),
):
    """
    Runs `runs` inference iterations for `model`, measures TTFT + TPS,
    persists each run to SQLite, and returns aggregate statistics.

    WHY PERSIST TO DB?
    The comparison report at GET /report aggregates data across multiple
    /benchmark/run calls.  Without persistence, closing the server loses
    all benchmark history.  SQLite needs zero setup — just a file.
    """
    prompt = request.prompt or settings.DEFAULT_BENCHMARK_PROMPT

    try:
        individual, stats = await run_benchmark_suite(
            client=client,
            model=request.model.value,
            prompt=prompt,
            runs=request.runs,
            options=request.options,
        )
    except OllamaConnectionError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except OllamaModelError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Persist each individual run to SQLite
    run_id = str(uuid.uuid4())
    for run_data in individual:
        db_run = BenchmarkRun(
            run_id=run_id,
            model=run_data["model"],
            prompt_hash=run_data["prompt_hash"],
            prompt_tokens=run_data["prompt_tokens"],
            eval_tokens=run_data["eval_tokens"],
            time_to_first_token_ms=run_data["time_to_first_token_ms"],
            total_duration_ms=run_data["total_duration_ms"],
            tokens_per_second=run_data["tokens_per_second"],
        )
        session.add(db_run)
    await session.commit()

    return BenchmarkResponse(
        run_id=run_id,
        model=request.model.value,
        prompt_used=prompt,
        individual_runs=individual,
        stats=stats,
    )


@router.get(
    "/history",
    summary="List all benchmark runs stored in the database",
)
async def benchmark_history(
    model: Optional[str] = Query(default=None, description="Filter by model name"),
    limit: int = Query(default=50, le=500),
    session: AsyncSession = Depends(get_session),
):
    """
    Returns benchmark history rows.  Filter by model name if provided.

    Useful for the frontend's history page: show a table of past runs
    with TPS trend over time (is the model getting faster as VRAM warms up?).
    """
    stmt = select(BenchmarkRun).order_by(BenchmarkRun.created_at.desc()).limit(limit)
    if model:
        stmt = stmt.where(BenchmarkRun.model == model)
    result = await session.execute(stmt)
    runs = result.scalars().all()
    return {"runs": [r.model_dump() for r in runs], "total": len(runs)}


@router.get(
    "/history/{run_id}",
    summary="Get all rows for a specific benchmark run ID",
)
async def benchmark_run_detail(
    run_id: str,
    session: AsyncSession = Depends(get_session),
):
    stmt = select(BenchmarkRun).where(BenchmarkRun.run_id == run_id)
    result = await session.execute(stmt)
    runs = result.scalars().all()
    if not runs:
        raise HTTPException(status_code=404, detail=f"run_id '{run_id}' not found")
    return {"run_id": run_id, "runs": [r.model_dump() for r in runs]}
