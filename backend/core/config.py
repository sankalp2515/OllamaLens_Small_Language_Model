"""
config.py
---------
Single source of truth for all runtime configuration.

WHY pydantic-settings INSTEAD OF python-dotenv OR os.environ DIRECTLY?
  • pydantic-settings reads from env vars AND a .env file automatically.
  • Every setting is type-validated at startup — a wrong OLLAMA_BASE_URL
    raises an error immediately instead of crashing at the first request.
  • IDE auto-complete works because settings are typed dataclass fields.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ------------------------------------------------------------------
    # Ollama
    # ------------------------------------------------------------------
    OLLAMA_BASE_URL: str = "http://localhost:11434"

    # Models available for benchmarking.
    # Using q4_K_M quantization for all:
    #   • Fits within 6 GB VRAM on a GTX 1660 Ti (each ~4-5 GB)
    #   • q4_K_M is the sweet-spot: ~2% quality loss vs FP16,
    #     but 4× smaller and 3× faster on limited VRAM.
    DEFAULT_MODELS: list[str] = [
        "llama3:8b-instruct-q4_K_M",
        "mistral:7b-instruct-q4_K_M",
        "phi3:mini",
    ]

    # ------------------------------------------------------------------
    # Benchmarking
    # ------------------------------------------------------------------
    # Number of repeated runs per prompt per model for statistical accuracy.
    # 3 is enough to get a stable median TPS without wasting 30+ minutes.
    BENCHMARK_RUNS: int = 3

    # Standard prompt used across all models so comparisons are fair.
    DEFAULT_BENCHMARK_PROMPT: str = (
        "Explain the concept of recursion in programming. "
        "Give a short Python example."
    )

    # ------------------------------------------------------------------
    # Database
    # ------------------------------------------------------------------
    # WHY SQLite?
    # Zero infrastructure cost, zero setup, single file.
    # For a benchmarking tool that runs locally and has at most
    # a few hundred rows, SQLite is faster and simpler than Postgres.
    DATABASE_URL: str = "sqlite+aiosqlite:///./ollamalens.db"

    # ------------------------------------------------------------------
    # API
    # ------------------------------------------------------------------
    API_TITLE: str = "OllamaLens API"
    API_VERSION: str = "1.0.0"
    DEBUG: bool = True

    # CORS origins — allow the Vite dev server (port 5173) by default.
    CORS_ORIGINS: list[str] = [
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


# Module-level singleton: import `settings` anywhere in the codebase.
settings = Settings()
