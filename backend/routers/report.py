"""
routers/report.py
-----------------
Endpoint that generates the technical comparison report.

ENDPOINT
  GET /report      — full report with all sections
  GET /report/markdown — same report formatted as Markdown text
"""

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.database import get_session
from backend.models.schemas import ReportResponse
from backend.utils.report_generator import generate_report

router = APIRouter(prefix="/report", tags=["Report"])


@router.get(
    "",
    response_model=ReportResponse,
    summary="Generate the technical comparison report from all benchmark data",
)
async def get_report(session: AsyncSession = Depends(get_session)):
    """
    Dynamically aggregates all stored BenchmarkRun rows from SQLite
    and returns a structured report.

    WHY DYNAMIC INSTEAD OF CACHED?
    Every time you run a new benchmark, the report should reflect it.
    For a local tool with <1000 rows, the aggregation is instantaneous.
    """
    return await generate_report(session)


@router.get(
    "/markdown",
    response_class=PlainTextResponse,
    summary="Same report as raw Markdown text (copy-paste into your README)",
)
async def get_report_markdown(session: AsyncSession = Depends(get_session)):
    """Returns the report as a Markdown string for easy documentation use."""
    report = await generate_report(session)

    lines = [
        f"# OllamaLens Technical Comparison Report",
        f"Generated: {report.generated_at.isoformat()}",
        "",
        "## Hardware",
        *[f"- **{k}**: {v}" for k, v in report.hardware.items()],
        "",
    ]

    for section in report.sections:
        lines += [f"## {section.title}", "", section.content, ""]

    lines += ["## Raw Statistics", ""]
    for s in report.raw_stats:
        lines += [
            f"### {s.model}",
            f"- Runs: {s.runs}",
            f"- Median TPS: {s.median_tps}",
            f"- Mean TTFT: {s.mean_ttft_ms} ms",
            f"- Mean Total Duration: {s.mean_total_ms} ms",
            "",
        ]

    return "\n".join(lines)
