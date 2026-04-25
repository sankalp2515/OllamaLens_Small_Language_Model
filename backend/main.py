"""
main.py
-------
FastAPI application factory and startup/shutdown lifecycle.

WHY FASTAPI OVER FLASK OR DJANGO?
  • FastAPI is fully async — critical for SSE token streaming without
    blocking worker threads.
  • Automatic OpenAPI docs at /docs (great for showing recruiters the API).
  • Pydantic integration is native: request bodies are validated by type.
  • Performance: Starlette ASGI core, comparable to Node.js in benchmarks.

  Flask is synchronous by default and would require flask-socketio or
  Quart for streaming.  Django REST Framework adds significant boilerplate
  for a small API like this.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.core.config import settings
from backend.core.database import init_db
from backend.routers import chat, benchmark, compare, report

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan (startup / shutdown)
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan context manager.

    WHY LIFESPAN INSTEAD OF @app.on_event("startup")?
    on_event is deprecated in FastAPI 0.93+.  Lifespan is the modern
    pattern and uses a single async context manager for both startup
    and shutdown — cleaner and easier to test.
    """
    logger.info("Starting OllamaLens API...")
    await init_db()
    logger.info("SQLite database initialised.")
    yield
    # Shutdown
    logger.info("OllamaLens API shutting down.")


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------
app = FastAPI(
    title=settings.API_TITLE,
    version=settings.API_VERSION,
    description=(
        "Local SLM benchmarking and assistant platform. "
        "Runs entirely offline via Ollama. "
        "No API keys, no cloud, no cost."
    ),
    lifespan=lifespan,
    docs_url="/docs",       # Swagger UI
    redoc_url="/redoc",     # ReDoc UI
)

# ---------------------------------------------------------------------------
# CORS Middleware
# ---------------------------------------------------------------------------
# WHY CORS?
# The React frontend (Vite dev server on :5173) and the FastAPI backend
# (Uvicorn on :8000) are different origins.  Browsers block cross-origin
# requests by default.  CORSMiddleware adds the required
# Access-Control-Allow-Origin header so the frontend can call the API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(chat.router)
app.include_router(benchmark.router)
app.include_router(compare.router)
app.include_router(report.router)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/health", tags=["Health"])
async def health():
    """
    Lightweight health check — no DB or Ollama dependency.
    Used by the frontend to detect if the backend is reachable before
    rendering the UI.
    """
    return {
        "status": "ok",
        "version": settings.API_VERSION,
        "ollama_url": settings.OLLAMA_BASE_URL,
    }


@app.get("/", tags=["Health"])
async def root():
    return {
        "message": "OllamaLens API",
        "docs": "/docs",
        "version": settings.API_VERSION,
    }
