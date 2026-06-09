from __future__ import annotations

import asyncio
import json
from typing import Annotated

from fastapi import Cookie, Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.config import Settings, get_settings
from app.deployment import (
    apply_deployment,
    build_commit_message,
    build_preview,
    export_deployment_report,
    parse_deployment_lines,
)
from app.extraction import export_extraction_txt, run_extraction
from app.git_service import GitError, GitService
from app.logging_service import LogLevel
from app.session import AppSession, session_manager

app = FastAPI(title="Assistant Redirections Apache / AzDO")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SESSION_COOKIE = "session_id"


def get_or_create_session(session_id: str | None) -> tuple[AppSession, bool]:
    if session_id and (session := session_manager.get(session_id)):
        return session, False
    session = session_manager.create()
    return session, True


def require_session(session_id: Annotated[str | None, Cookie()] = None) -> AppSession:
    if not session_id or not (session := session_manager.get(session_id)):
        raise HTTPException(status_code=401, detail="Session invalide — reconnectez-vous")
    return session


def require_connected(session: AppSession = Depends(require_session)) -> AppSession:
    if not session.connected:
        raise HTTPException(status_code=401, detail="Non connecté")
    return session


class ConnectRequest(BaseModel):
    pat: str


class ConnectResponse(BaseModel):
    connected: bool
    org: str
    project: str
    repo: str
    default_branch: str
    target_folder: str


class ExtractionAnalyzeRequest(BaseModel):
    urls: list[str] = Field(default_factory=list)
    filename: str = "audit-redirections"


class DeploymentPreviewRequest(BaseModel):
    text: str


class DeploymentValidateRequest(BaseModel):
    feature_branch: str
    selected_line_numbers: list[int]


class CommitRequest(BaseModel):
    message: str


@app.post("/api/session/connect", response_model=ConnectResponse)
def connect(
    body: ConnectRequest,
    response: Response,
    session_id: Annotated[str | None, Cookie()] = None,
    settings: Settings = Depends(get_settings),
) -> ConnectResponse:
    session, created = get_or_create_session(session_id)
    if created:
        response.set_cookie(
            key=SESSION_COOKIE,
            value=session.session_id,
            httponly=True,
            samesite="lax",
            max_age=None,
        )

    git = GitService(settings, session.logs, pat=body.pat)
    try:
        git.validate_repo()
        if not settings.skip_remote_check:
            git.ls_remote()
        else:
            session.logs.info("Validation remote ignorée (SKIP_REMOTE_CHECK)")
    except GitError as exc:
        session.logs.error(str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    session.connected = True
    session.pat = body.pat
    session.logs.info("PAT validé — connexion établie")
    return ConnectResponse(
        connected=True,
        org=settings.azdo_org,
        project=settings.azdo_project,
        repo=settings.azdo_repo,
        default_branch=settings.default_branch,
        target_folder=settings.target_folder,
    )


@app.post("/api/session/disconnect")
def disconnect(
    response: Response,
    session: AppSession = Depends(require_session),
) -> dict[str, bool]:
    session_manager.delete(session.session_id)
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}


@app.get("/api/session/status")
def session_status(
    session_id: Annotated[str | None, Cookie()] = None,
    settings: Settings = Depends(get_settings),
) -> ConnectResponse | dict[str, bool]:
    if not session_id or not (session := session_manager.get(session_id)):
        return {"connected": False}
    if not session.connected:
        return {"connected": False}
    return ConnectResponse(
        connected=True,
        org=settings.azdo_org,
        project=settings.azdo_project,
        repo=settings.azdo_repo,
        default_branch=settings.default_branch,
        target_folder=settings.target_folder,
    )


@app.get("/api/logs")
def get_logs(session: AppSession = Depends(require_session)) -> list[dict]:
    return [
        {"timestamp": e.timestamp, "level": e.level.value, "message": e.message}
        for e in session.logs.entries
    ]


@app.get("/api/logs/stream")
async def stream_logs(session: AppSession = Depends(require_session)) -> EventSourceResponse:
    queue = session.logs.subscribe()

    async def event_generator():
        for entry in session.logs.entries:
            yield {"event": "log", "data": json.dumps({
                "timestamp": entry.timestamp,
                "level": entry.level.value,
                "message": entry.message,
            })}
        try:
            async for entry in session.logs.stream(queue):
                yield {"event": "log", "data": json.dumps({
                    "timestamp": entry.timestamp,
                    "level": entry.level.value,
                    "message": entry.message,
                })}
        finally:
            session.logs.unsubscribe(queue)

    return EventSourceResponse(event_generator())


@app.post("/api/extraction/analyze")
async def extraction_analyze(
    body: ExtractionAnalyzeRequest,
    session: AppSession = Depends(require_connected),
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    urls = [u.strip() for u in body.urls if u.strip()]
    if not urls:
        raise HTTPException(status_code=400, detail="Aucune URL fournie")

    session.extraction_export_name = body.filename or "audit-redirections"

    async def generate():
        results = []
        total_occ = 0
        impacted: set[str] = set()
        for idx, url in enumerate(urls, start=1):
            partial = run_extraction(settings, [url])
            result = partial.results[0]
            results.append(result)
            for occ in result.occurrences:
                impacted.add(occ.file)
            total_occ += len(result.occurrences)
            payload = {
                "type": "progress",
                "current": idx,
                "total": len(urls),
                "url": url,
                "found": result.found,
            }
            session.logs.info(f"Extraction {idx}/{len(urls)} — {url}")
            yield json.dumps(payload) + "\n"
            await asyncio.sleep(0.05)

        from app.extraction import ExtractionSummary

        summary = ExtractionSummary(
            urls_analyzed=len(urls),
            occurrences_found=total_occ,
            files_impacted=len(impacted),
            results=results,
        )
        session.extraction_result = summary
        final = {
            "type": "complete",
            "summary": {
                "urls_analyzed": summary.urls_analyzed,
                "occurrences_found": summary.occurrences_found,
                "files_impacted": summary.files_impacted,
                "results": [
                    {
                        "url": r.url,
                        "found": r.found,
                        "occurrences": [
                            {
                                "file": o.file,
                                "line_number": o.line_number,
                                "content": o.content,
                            }
                            for o in r.occurrences
                        ],
                    }
                    for r in summary.results
                ],
            },
        }
        session.logs.info(
            f"Extraction terminée — {summary.occurrences_found} occurrences"
        )
        yield json.dumps(final) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@app.get("/api/extraction/export")
def extraction_export(
    filename: str | None = None,
    session: AppSession = Depends(require_connected),
) -> PlainTextResponse:
    if not session.extraction_result:
        raise HTTPException(status_code=400, detail="Aucun résultat d'extraction")
    name = filename or session.extraction_export_name or "audit-redirections"
    content = export_extraction_txt(session.extraction_result, name)
    session.logs.info(f"Export TXT — {name}.txt")
    return PlainTextResponse(
        content,
        headers={"Content-Disposition": f'attachment; filename="{name}.txt"'},
    )


@app.post("/api/deployment/preview")
def deployment_preview(
    body: DeploymentPreviewRequest,
    session: AppSession = Depends(require_connected),
    settings: Settings = Depends(get_settings),
):
    lines, errors = parse_deployment_lines(body.text)
    if errors:
        for err in errors:
            session.logs.warn(err)
        raise HTTPException(status_code=400, detail={"errors": errors})
    if not lines:
        raise HTTPException(status_code=400, detail="Aucune ligne valide")

    preview = build_preview(settings, lines)
    session.deployment_lines = lines
    session.deployment_preview = preview
    session.selected_line_numbers = {
        i.line_number for i in preview.items if i.applicable
    }
    session.logs.info(
        f"Analyse — {preview.applicable_count} applicables, "
        f"{preview.conflict_count} conflits"
    )
    return {
        "items": [
            {
                "line_number": i.line_number,
                "source": i.source,
                "target": i.target,
                "action": i.action.value,
                "status": i.status.value,
                "message": i.message,
                "applicable": i.applicable,
            }
            for i in preview.items
        ],
        "applicable_count": preview.applicable_count,
        "conflict_count": preview.conflict_count,
        "error_count": preview.error_count,
        "suggested_commit_message": build_commit_message(preview),
    }


@app.post("/api/deployment/validate")
def deployment_validate(
    body: DeploymentValidateRequest,
    session: AppSession = Depends(require_connected),
    settings: Settings = Depends(get_settings),
):
    if not session.deployment_preview or not session.deployment_lines:
        raise HTTPException(status_code=400, detail="Aucune preview — analysez d'abord")
    if body.selected_line_numbers:
        session.selected_line_numbers = set(body.selected_line_numbers)
    applicable = [n for n in session.selected_line_numbers if n]
    if not applicable:
        raise HTTPException(status_code=400, detail="Aucune ligne applicable sélectionnée")

    session.feature_branch = body.feature_branch.strip()
    if not session.feature_branch:
        raise HTTPException(status_code=400, detail="Nom de branche requis")

    git = GitService(settings, session.logs, pat=session.pat)
    try:
        git.prepare_base_branch()
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    session.logs.info("Prévisualisation validée — prep Git OK")
    return {"ok": True, "feature_branch": session.feature_branch}


@app.post("/api/deployment/branch")
def deployment_branch(
    session: AppSession = Depends(require_connected),
    settings: Settings = Depends(get_settings),
):
    if not session.feature_branch:
        raise HTTPException(status_code=400, detail="Branche feature non définie")
    if not session.deployment_lines:
        raise HTTPException(status_code=400, detail="Aucune ligne de déploiement")

    git = GitService(settings, session.logs, pat=session.pat)
    try:
        git.create_branch(session.feature_branch)
        adds, mods, files = apply_deployment(
            settings,
            session.deployment_lines,
            session.selected_line_numbers,
        )
        suppr = sum(
            1
            for line in session.deployment_lines
            if line.line_number in session.selected_line_numbers
            and line.action.value == "suppression"
        )
        session.deployment_applied = True
        session.apply_stats = (adds, suppr, files)
        session.logs.info(f"Branche {session.feature_branch} créée — fichiers modifiés")
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    adds, suppr, files = session.apply_stats
    return {
        "branch": session.feature_branch,
        "adds": adds,
        "suppressions": suppr,
        "modifications": mods,
        "files": files,
    }


@app.post("/api/deployment/commit")
def deployment_commit(
    body: CommitRequest,
    session: AppSession = Depends(require_connected),
    settings: Settings = Depends(get_settings),
):
    if not session.deployment_applied:
        raise HTTPException(status_code=400, detail="Appliquez d'abord les changements")

    git = GitService(settings, session.logs, pat=session.pat)
    try:
        sha = git.commit(body.message)
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    session.commit_sha = sha
    session.logs.info(f"Commit {sha}")
    return {"commit_sha": sha}


@app.post("/api/deployment/push")
def deployment_push(
    session: AppSession = Depends(require_connected),
    settings: Settings = Depends(get_settings),
):
    if not session.commit_sha:
        raise HTTPException(status_code=400, detail="Commit requis avant push")

    git = GitService(settings, session.logs, pat=session.pat)
    try:
        git.push(session.feature_branch)
    except GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    session.push_done = True
    session.logs.info(f"Push OK — origin/{session.feature_branch}")
    adds, suppr, files = session.apply_stats
    return {
        "branch": session.feature_branch,
        "commit_sha": session.commit_sha,
        "push_ok": True,
        "adds": adds,
        "suppressions": suppr,
        "files": files,
    }


@app.get("/api/deployment/report")
def deployment_report(session: AppSession = Depends(require_connected)) -> PlainTextResponse:
    adds, suppr, files = session.apply_stats
    mods = sum(
        1
        for line in session.deployment_lines
        if line.line_number in session.selected_line_numbers
        and line.action.value == "modification"
    )
    content = export_deployment_report(
        branch=session.feature_branch,
        commit_sha=session.commit_sha,
        push_ok=session.push_done,
        adds=adds,
        suppr=suppr,
        mods=mods,
        files=files,
    )
    return PlainTextResponse(
        content,
        headers={"Content-Disposition": 'attachment; filename="rapport-deploiement.txt"'},
    )


@app.post("/api/deployment/reset")
def deployment_reset(session: AppSession = Depends(require_connected)) -> dict[str, bool]:
    session.deployment_lines = []
    session.deployment_preview = None
    session.selected_line_numbers = set()
    session.feature_branch = ""
    session.commit_sha = None
    session.push_done = False
    session.deployment_applied = False
    session.apply_stats = (0, 0, [])
    session.logs.info("Nouveau déploiement — session réinitialisée")
    return {"ok": True}


@app.post("/api/extraction/reset")
def extraction_reset(session: AppSession = Depends(require_connected)) -> dict[str, bool]:
    session.extraction_result = None
    session.extraction_export_name = "audit-redirections"
    session.logs.info("Nouvelle extraction — session réinitialisée")
    return {"ok": True}


def mount_frontend() -> None:
    from pathlib import Path

    frontend_dist = Path(__file__).resolve().parent.parent / "static"
    if frontend_dist.exists():
        app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="static")


mount_frontend()
