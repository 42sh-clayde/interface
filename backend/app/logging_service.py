from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import AsyncIterator


class LogLevel(str, Enum):
    INFO = "INFO"
    WARN = "WARN"
    ERROR = "ERROR"


@dataclass
class LogEntry:
    timestamp: str
    level: LogLevel
    message: str


@dataclass
class SessionLogStore:
    entries: list[LogEntry] = field(default_factory=list)
    subscribers: list[asyncio.Queue[LogEntry | None]] = field(default_factory=list)

    def add(self, level: LogLevel, message: str) -> LogEntry:
        entry = LogEntry(
            timestamp=datetime.now(timezone.utc).strftime("%H:%M:%S"),
            level=level,
            message=message,
        )
        self.entries.append(entry)
        for queue in self.subscribers:
            queue.put_nowait(entry)
        return entry

    def info(self, message: str) -> LogEntry:
        return self.add(LogLevel.INFO, message)

    def warn(self, message: str) -> LogEntry:
        return self.add(LogLevel.WARN, message)

    def error(self, message: str) -> LogEntry:
        return self.add(LogLevel.ERROR, message)

    def subscribe(self) -> asyncio.Queue[LogEntry | None]:
        queue: asyncio.Queue[LogEntry | None] = asyncio.Queue()
        self.subscribers.append(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[LogEntry | None]) -> None:
        if queue in self.subscribers:
            self.subscribers.remove(queue)

    async def stream(self, queue: asyncio.Queue[LogEntry | None]) -> AsyncIterator[LogEntry]:
        try:
            while True:
                entry = await queue.get()
                if entry is None:
                    break
                yield entry
        finally:
            self.unsubscribe(queue)
