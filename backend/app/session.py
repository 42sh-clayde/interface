from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.deployment import DeploymentLine, DeploymentPreview
from app.extraction import ExtractionSummary
from app.logging_service import SessionLogStore


@dataclass
class AppSession:
    session_id: str
    connected: bool = False
    pat: str | None = None
    logs: SessionLogStore = field(default_factory=SessionLogStore)
    extraction_result: ExtractionSummary | None = None
    extraction_export_name: str = "audit-redirections"
    deployment_lines: list[DeploymentLine] = field(default_factory=list)
    deployment_preview: DeploymentPreview | None = None
    selected_line_numbers: set[int] = field(default_factory=set)
    feature_branch: str = ""
    commit_sha: str | None = None
    push_done: bool = False
    deployment_applied: bool = False
    apply_stats: tuple[int, int, list[str]] = (0, 0, [])


class SessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, AppSession] = {}

    def create(self) -> AppSession:
        session_id = str(uuid.uuid4())
        session = AppSession(session_id=session_id)
        self._sessions[session_id] = session
        return session

    def get(self, session_id: str) -> AppSession | None:
        return self._sessions.get(session_id)

    def delete(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)


session_manager = SessionManager()
