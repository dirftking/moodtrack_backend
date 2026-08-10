"""SQLite-backed persistent stores for MoodTrack.

Exposes three dict-like singletons (``projects``, ``plans``, ``generations``)
that behave like in-memory dicts but transparently persist every write to a
local SQLite database, so projects/plans/generation history survive process
restarts.
"""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Iterator, Type, TypeVar

from pydantic import BaseModel

from app.schemas import Generation, MusicPlan, Project

BASE_DIR = Path(__file__).resolve().parent.parent
STORAGE_DIR = BASE_DIR / "storage"
AUDIO_DIR = STORAGE_DIR / "audio"
DB_PATH = STORAGE_DIR / "moodtrack.db"

STORAGE_DIR.mkdir(parents=True, exist_ok=True)
AUDIO_DIR.mkdir(parents=True, exist_ok=True)


T = TypeVar("T", bound=BaseModel)


class SqliteModelStore:
    """Dict-like store that persists ``BaseModel`` values into one SQLite table."""

    _lock = threading.RLock()

    def __init__(self, table: str, model: Type[T]):
        self.table = table
        self.model = model
        self._conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        self._conn.execute(
            f"CREATE TABLE IF NOT EXISTS {table} ("
            " id TEXT PRIMARY KEY,"
            " data TEXT NOT NULL,"
            " created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
            ")"
        )
        self._conn.commit()

    # ------------------------------------------------------------------
    # Dict-like API used throughout the app
    # ------------------------------------------------------------------
    def __setitem__(self, key: str, value: T) -> None:
        payload = value.model_dump_json()
        with self._lock:
            self._conn.execute(
                f"INSERT INTO {self.table}(id, data) VALUES(?, ?) "
                f"ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                (key, payload),
            )
            self._conn.commit()

    def __getitem__(self, key: str) -> T:
        item = self.get(key)
        if item is None:
            raise KeyError(key)
        return item

    def __contains__(self, key: object) -> bool:
        if not isinstance(key, str):
            return False
        return self.get(key) is not None

    def __iter__(self) -> Iterator[str]:
        cursor = self._conn.execute(f"SELECT id FROM {self.table} ORDER BY created_at ASC")
        return iter(row[0] for row in cursor.fetchall())

    def __len__(self) -> int:
        cursor = self._conn.execute(f"SELECT COUNT(*) FROM {self.table}")
        return int(cursor.fetchone()[0])

    def get(self, key: str, default=None):
        cursor = self._conn.execute(
            f"SELECT data FROM {self.table} WHERE id=?", (key,)
        )
        row = cursor.fetchone()
        if not row:
            return default
        return self.model.model_validate_json(row[0])

    def values(self):
        cursor = self._conn.execute(
            f"SELECT data FROM {self.table} ORDER BY created_at ASC"
        )
        return [self.model.model_validate_json(row[0]) for row in cursor.fetchall()]

    def keys(self):
        return list(iter(self))

    def items(self):
        return [(k, self[k]) for k in self.keys()]

    def pop(self, key: str, default=None):
        with self._lock:
            existing = self.get(key, default)
            self._conn.execute(f"DELETE FROM {self.table} WHERE id=?", (key,))
            self._conn.commit()
        return existing


# Public singletons, keep names compatible with the rest of the codebase.
projects = SqliteModelStore("projects", Project)
plans = SqliteModelStore("plans", MusicPlan)
generations = SqliteModelStore("generations", Generation)
