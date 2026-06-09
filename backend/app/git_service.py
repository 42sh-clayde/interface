from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from app.config import Settings
from app.logging_service import LogLevel, SessionLogStore


class GitError(Exception):
    pass


@dataclass
class GitResult:
    stdout: str
    stderr: str


class GitService:
    def __init__(
        self,
        settings: Settings,
        logs: SessionLogStore,
        pat: str | None = None,
    ) -> None:
        self.settings = settings
        self.logs = logs
        self.pat = pat
        self.repo_path = Path(settings.repo_mount_path)

    def _env(self) -> dict[str, str]:
        env = os.environ.copy()
        if self.pat:
            env["GIT_TERMINAL_PROMPT"] = "0"
            env["GIT_ASKPASS"] = "echo"
            env["GIT_USERNAME"] = "pat"
            env["GIT_PASSWORD"] = self.pat
        return env

    def _run(self, args: list[str], *, log_cmd: bool = True) -> GitResult:
        if log_cmd:
            self.logs.info(f"git {' '.join(args)}")
        result = subprocess.run(
            ["git", *args],
            cwd=self.repo_path,
            capture_output=True,
            text=True,
            env=self._env(),
            check=False,
        )
        if result.returncode != 0:
            message = result.stderr.strip() or result.stdout.strip() or "Commande git échouée"
            self.logs.error(message)
            raise GitError(message)
        output = result.stdout.strip()
        if output:
            self.logs.info(output.splitlines()[-1][:200])
        return GitResult(stdout=result.stdout, stderr=result.stderr)

    def validate_repo(self) -> None:
        if not self.repo_path.exists():
            raise GitError(f"Repo introuvable: {self.repo_path}")
        if not (self.repo_path / ".git").exists():
            raise GitError(f"Pas un dépôt git: {self.repo_path}")

    def ls_remote(self) -> None:
        self._run(["ls-remote", self.settings.remote_name, "HEAD"])

    def current_branch(self) -> str:
        result = self._run(["branch", "--show-current"], log_cmd=False)
        return result.stdout.strip() or "HEAD"

    def checkout(self, branch: str) -> None:
        self._run(["checkout", branch])

    def fetch(self) -> None:
        self._run(["fetch", self.settings.remote_name])

    def pull(self, branch: str | None = None) -> None:
        branch = branch or self.settings.default_branch
        self._run(["pull", self.settings.remote_name, branch])

    def create_branch(self, branch_name: str) -> None:
        self._run(["checkout", "-b", branch_name])

    def commit(self, message: str) -> str:
        self._run(["add", "-A", self.settings.target_folder])
        status = self._run(["status", "--porcelain"], log_cmd=False)
        if not status.stdout.strip():
            raise GitError("Aucun changement à committer")
        self._run(["commit", "-m", message])
        sha = self._run(["rev-parse", "--short", "HEAD"], log_cmd=False).stdout.strip()
        return sha

    def push(self, branch_name: str) -> None:
        self._run(["push", "-u", self.settings.remote_name, branch_name])

    def prepare_base_branch(self) -> str:
        branch = self.settings.default_branch
        self.checkout(branch)
        self.fetch()
        self.pull(branch)
        head = self._run(["rev-parse", "--short", "HEAD"], log_cmd=False).stdout.strip()
        self.logs.info(f"Branche {branch} à jour ({head})")
        return head
