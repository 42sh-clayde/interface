from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from app.config import Settings


REDIRECT_PATTERN = re.compile(
    r"^\s*(?:Redirect(?:Match|Permanent|Temp)?(?:\s+\d+)?|RewriteRule)\s+",
    re.IGNORECASE,
)


@dataclass
class Occurrence:
    file: str
    line_number: int
    content: str


@dataclass
class UrlSearchResult:
    url: str
    found: bool
    occurrences: list[Occurrence] = field(default_factory=list)


@dataclass
class ExtractionSummary:
    urls_analyzed: int
    occurrences_found: int
    files_impacted: int
    results: list[UrlSearchResult]


def target_dir(settings: Settings) -> Path:
    return Path(settings.repo_mount_path) / settings.target_folder


def iter_target_files(settings: Settings) -> list[Path]:
    base = target_dir(settings)
    if not base.exists():
        return []
    return [p for p in base.rglob("*") if p.is_file()]


def search_url_in_file(path: Path, url: str, repo_root: Path) -> list[Occurrence]:
    occurrences: list[Occurrence] = []
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return occurrences
    for idx, line in enumerate(content.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if url in line:
            rel = str(path.relative_to(repo_root))
            occurrences.append(Occurrence(file=rel, line_number=idx, content=stripped))
    return occurrences


def run_extraction(settings: Settings, urls: list[str]) -> ExtractionSummary:
    repo_root = Path(settings.repo_mount_path)
    files = iter_target_files(settings)
    results: list[UrlSearchResult] = []
    total_occurrences = 0
    impacted: set[str] = set()

    for url in urls:
        url_occurrences: list[Occurrence] = []
        for file_path in files:
            found = search_url_in_file(file_path, url, repo_root)
            url_occurrences.extend(found)
            for occ in found:
                impacted.add(occ.file)
        total_occurrences += len(url_occurrences)
        results.append(
            UrlSearchResult(url=url, found=bool(url_occurrences), occurrences=url_occurrences)
        )

    return ExtractionSummary(
        urls_analyzed=len(urls),
        occurrences_found=total_occurrences,
        files_impacted=len(impacted),
        results=results,
    )


def export_extraction_txt(summary: ExtractionSummary, filename: str) -> str:
    lines = [
        f"# Rapport extraction — {filename}",
        f"URLs analysées: {summary.urls_analyzed}",
        f"Occurrences: {summary.occurrences_found}",
        f"Fichiers impactés: {summary.files_impacted}",
        "",
    ]
    for result in summary.results:
        lines.append(f"## {result.url} — {'TROUVÉ' if result.found else 'NON TROUVÉ'}")
        if not result.occurrences:
            lines.append("  (aucune occurrence)")
        for occ in result.occurrences:
            lines.append(f"  [{occ.file}:{occ.line_number}] {occ.content}")
        lines.append("")
    return "\n".join(lines)
