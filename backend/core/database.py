"""
database.py
-----------
Async SQLite setup using SQLModel + aiosqlite.

WHY SQLModel INSTEAD OF raw SQLAlchemy OR tortoise-orm?
  SQLModel is built by the same author as FastAPI (Sebastián Ramírez).
  It unifies the SQLAlchemy ORM model with a Pydantic model in a single
  class definition — no duplication between DB schema and API schema.

WHY aiosqlite?
  FastAPI is fully async.  Standard sqlite3 is synchronous and would
  block the event loop during writes.  aiosqlite wraps sqlite3 in a
  thread so I/O is non-blocking without needing a heavier DB engine.
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlmodel import SQLModel

from backend.core.config import settings

# WHY check_same_thread=False?
# SQLite's default is to allow access from the creating thread only.
# asyncio may schedule coroutines across different threads in the pool,
# so we disable this safety check (aiosqlite handles thread safety itself).
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    connect_args={"check_same_thread": False},
)

AsyncSessionLocal = sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,  # objects stay accessible after commit
)


async def init_db():
    """Create all tables on startup (idempotent — safe to call repeatedly)."""
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


async def get_session() -> AsyncSession:
    """
    FastAPI dependency that yields one DB session per request.

    WHY yield instead of return?
    Using `yield` turns this into a context manager dependency.
    FastAPI will automatically call the code after `yield` (the finally
    block) when the request finishes — ensuring the session is always
    closed, even if the route raises an exception.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
