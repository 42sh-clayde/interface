from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

from app.config import Settings
from app.extraction import iter_target_files, search_url_in_file


class ActionType(str, Enum):
    AJOUT = "ajout"
    SUPPRESSION = "suppression"
    MODIFICATION = "modification"


ACTION_ALIASES: dict[str, ActionType] = {
    "ajout": ActionType.AJOUT,
    "add": ActionType.AJOUT,
    "a": ActionType.AJOUT,
    "suppression": ActionType.SUPPRESSION,
    "suppr": ActionType.SUPPRESSION,
    "delete": ActionType.SUPPRESSION,
    "del": ActionType.SUPPRESSION,
    "modification": ActionType.MODIFICATION,
    "modif": ActionType.MODIFICATION,
    "mod": ActionType.MODIFICATION,
    "modify": ActionType.MODIFICATION,
}


class PreviewStatus(str, Enum):
    READY = "ready"
    CONFLICT = "conflict"
    NOT_FOUND = "not_found"
    INVALID = "invalid"


@dataclass
class DeploymentLine:
    line_number: int
    source: str
    target: str
    action: ActionType
    raw: str


@dataclass
class PreviewItem:
    line_number: int
    source: str
    target: str
    action: ActionType
    status: PreviewStatus
    message: str
    applicable: bool = True


@dataclass
class DeploymentPreview:
    items: list[PreviewItem]
    applicable_count: int
    conflict_count: int
    error_count: int


LINE_PATTERN = re.compile(
    r"^\s*(\S+)\s+(\S+)\s+\[([^\]]+)\]\s*$",
)


def _normalize_action(action_raw: str) -> str:
    return action_raw.strip().lower()


def parse_deployment_lines(text: str) -> tuple[list[DeploymentLine], list[str]]:
    lines: list[DeploymentLine] = []
    errors: list[str] = []
    for idx, raw in enumerate(text.splitlines(), start=1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = LINE_PATTERN.match(stripped)
        if not match:
            errors.append(
                f"Ligne {idx}: format invalide — attendu '/source /cible [ACTION]'"
            )
            continue
        source, target, action_raw = match.groups()
        action_key = _normalize_action(action_raw)
        if action_key not in ACTION_ALIASES:
            errors.append(f"Ligne {idx}: action inconnue '{action_raw}'")
            continue
        lines.append(
            DeploymentLine(
                line_number=idx,
                source=source,
                target=target,
                action=ACTION_ALIASES[action_key],
                raw=stripped,
            )
        )
    return lines, errors


def redirect_exists(settings: Settings, source: str, target: str | None = None) -> list[str]:
    repo_root = Path(settings.repo_mount_path)
    hits: list[str] = []
    for file_path in iter_target_files(settings):
        try:
            lines = file_path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line_no, line in enumerate(lines, start=1):
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            parts = stripped.split()
            if source not in parts:
                continue
            if target is not None and target not in parts:
                continue
            rel = str(file_path.relative_to(repo_root))
            hits.append(f"{rel}:{line_no} — {stripped}")
    return hits


def build_preview(settings: Settings, lines: list[DeploymentLine]) -> DeploymentPreview:
    items: list[PreviewItem] = []
    for line in lines:
        if line.action == ActionType.AJOUT:
            existing = redirect_exists(settings, line.source)
            if existing:
                items.append(
                    PreviewItem(
                        line_number=line.line_number,
                        source=line.source,
                        target=line.target,
                        action=line.action,
                        status=PreviewStatus.CONFLICT,
                        message=f"Conflit: {existing[0]}",
                        applicable=False,
                    )
                )
            else:
                items.append(
                    PreviewItem(
                        line_number=line.line_number,
                        source=line.source,
                        target=line.target,
                        action=line.action,
                        status=PreviewStatus.READY,
                        message="Aucune occurrence existante",
                        applicable=True,
                    )
                )
        else:
            existing = redirect_exists(settings, line.source)
            if not existing:
                items.append(
                    PreviewItem(
                        line_number=line.line_number,
                        source=line.source,
                        target=line.target,
                        action=line.action,
                        status=PreviewStatus.NOT_FOUND,
                        message="Source introuvable",
                        applicable=False,
                    )
                )
            else:
                items.append(
                    PreviewItem(
                        line_number=line.line_number,
                        source=line.source,
                        target=line.target,
                        action=line.action,
                        status=PreviewStatus.READY,
                        message=existing[0],
                        applicable=True,
                    )
                )

    applicable = sum(1 for i in items if i.applicable)
    conflicts = sum(1 for i in items if i.status == PreviewStatus.CONFLICT)
    errors = sum(1 for i in items if i.status == PreviewStatus.NOT_FOUND)
    return DeploymentPreview(
        items=items,
        applicable_count=applicable,
        conflict_count=conflicts,
        error_count=errors,
    )


def _default_redirects_file(settings: Settings) -> Path:
    base = Path(settings.repo_mount_path) / settings.target_folder
    base.mkdir(parents=True, exist_ok=True)
    htaccess = base / ".htaccess"
    if htaccess.exists():
        return htaccess
    conf_files = list(base.glob("*.conf"))
    if conf_files:
        return conf_files[0]
    htaccess.write_text("# Redirections Apache\n", encoding="utf-8")
    return htaccess


def apply_deployment(
    settings: Settings,
    lines: list[DeploymentLine],
    selected_line_numbers: set[int],
) -> tuple[int, int, list[str]]:
    modified_files: set[str] = set()
    adds = mods = 0
    repo_root = Path(settings.repo_mount_path)
    target_file = _default_redirects_file(settings)
    content_lines = target_file.read_text(encoding="utf-8", errors="replace").splitlines()

    for line in lines:
        if line.line_number not in selected_line_numbers:
            continue
        if line.action == ActionType.AJOUT:
            content_lines.append(f"Redirect 301 {line.source} {line.target}")
            adds += 1
            modified_files.add(str(target_file.relative_to(repo_root)))
        elif line.action == ActionType.SUPPRESSION:
            new_lines = []
            removed = False
            for existing in content_lines:
                if not removed and line.source in existing:
                    removed = True
                    continue
                new_lines.append(existing)
            content_lines = new_lines
            modified_files.add(str(target_file.relative_to(repo_root)))
        elif line.action == ActionType.MODIFICATION:
            new_lines = []
            for existing in content_lines:
                if line.source in existing and (
                    "Redirect" in existing or "RewriteRule" in existing
                ):
                    new_lines.append(f"Redirect 301 {line.source} {line.target}")
                else:
                    new_lines.append(existing)
            content_lines = new_lines
            mods += 1
            modified_files.add(str(target_file.relative_to(repo_root)))

    target_file.write_text("\n".join(content_lines) + "\n", encoding="utf-8")
    return adds, mods, sorted(modified_files)


def build_commit_message(preview: DeploymentPreview) -> str:
    adds = sum(1 for i in preview.items if i.applicable and i.action == ActionType.AJOUT)
    suppr = sum(
        1 for i in preview.items if i.applicable and i.action == ActionType.SUPPRESSION
    )
    mods = sum(
        1 for i in preview.items if i.applicable and i.action == ActionType.MODIFICATION
    )
    parts: list[str] = []
    if adds:
        parts.append(f"{adds} ajout{'s' if adds > 1 else ''}")
    if suppr:
        parts.append(f"{suppr} suppression{'s' if suppr > 1 else ''}")
    if mods:
        parts.append(f"{mods} modification{'s' if mods > 1 else ''}")
    detail = ", ".join(parts) if parts else "mise à jour"
    return f"chore(redirects): {detail}"


def export_deployment_report(
    branch: str,
    commit_sha: str | None,
    push_ok: bool,
    adds: int,
    suppr: int,
    mods: int,
    files: list[str],
) -> str:
    lines = [
        "# Rapport déploiement",
        f"Branche: {branch}",
        f"Commit: {commit_sha or '—'}",
        f"Push: {'OK' if push_ok else '—'}",
        f"Ajouts: {adds}",
        f"Suppressions: {suppr}",
        f"Modifications: {mods}",
        "Fichiers:",
    ]
    for f in files:
        lines.append(f"  - {f}")
    return "\n".join(lines)
