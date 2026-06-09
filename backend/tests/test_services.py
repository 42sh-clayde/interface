from pathlib import Path

from app.config import Settings
from app.deployment import build_preview, parse_deployment_lines
from app.extraction import run_extraction


def test_extraction_finds_redirect(tmp_path: Path):
    repo = tmp_path / "repo"
    target = repo / "config/apache/redirects"
    target.mkdir(parents=True)
    (target / ".htaccess").write_text("Redirect 301 /foo /bar\n")
    settings = Settings(
        repo_mount_path=str(repo),
        target_folder="config/apache/redirects",
    )
    summary = run_extraction(settings, ["/foo", "/missing"])
    assert summary.urls_analyzed == 2
    assert summary.occurrences_found >= 1
    assert summary.results[0].found
    assert not summary.results[1].found


def test_deployment_rejects_action_without_brackets():
    lines, errors = parse_deployment_lines("/foo /baz ajout")
    assert not lines
    assert any("format invalide" in e for e in errors)


def test_deployment_preview_add_conflict(tmp_path: Path):
    repo = tmp_path / "repo"
    target = repo / "config/apache/redirects"
    target.mkdir(parents=True)
    (target / ".htaccess").write_text("Redirect 301 /foo /bar\n")
    settings = Settings(
        repo_mount_path=str(repo),
        target_folder="config/apache/redirects",
    )
    lines, errors = parse_deployment_lines("/foo /baz [ajout]\n/new /dest [ajout]")
    assert not errors
    preview = build_preview(settings, lines)
    assert preview.conflict_count == 1
    assert preview.applicable_count == 1
