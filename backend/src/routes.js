import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { settings, connectInfo } from "./config.js";
import { createSession, getSession, deleteSession } from "./session.js";
import { GitError, GitService } from "./gitService.js";
import { runExtraction, exportExtractionTxt } from "./extraction.js";
import {
  parseDeploymentLines,
  buildPreview,
  applyDeployment,
  buildCommitMessage,
  exportDeploymentReport,
} from "./deployment.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_COOKIE = "session_id";

export function createApp() {
  const app = express();
  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(express.json());

  function getOrCreateSession(req, res) {
    let session = getSession(req.cookies[SESSION_COOKIE]);
    let created = false;
    if (!session) {
      session = createSession();
      created = true;
      res.cookie(SESSION_COOKIE, session.sessionId, {
        httpOnly: true,
        sameSite: "lax",
      });
    }
    return { session, created };
  }

  function requireSession(req, res, next) {
    const session = getSession(req.cookies[SESSION_COOKIE]);
    if (!session) {
      return res.status(401).json({ detail: "Session invalide — reconnectez-vous" });
    }
    req.session = session;
    next();
  }

  function requireConnected(req, res, next) {
    if (!req.session.connected) {
      return res.status(401).json({ detail: "Non connecté" });
    }
    next();
  }

  app.post("/api/session/connect", (req, res) => {
    const { session } = getOrCreateSession(req, res);
    const pat = req.body?.pat;
    if (!pat) return res.status(400).json({ detail: "PAT requis" });

    const git = new GitService(session.logs, pat);
    try {
      git.validateRepo();
      if (!settings.skipRemoteCheck) git.lsRemote();
      else session.logs.info("Validation remote ignorée (SKIP_REMOTE_CHECK)");
    } catch (e) {
      const msg = e instanceof GitError ? e.message : String(e);
      return res.status(400).json({ detail: msg });
    }

    session.connected = true;
    session.pat = pat;
    session.logs.info("PAT validé — connexion établie");
    res.json(connectInfo());
  });

  app.post("/api/session/disconnect", requireSession, (req, res) => {
    deleteSession(req.session.sessionId);
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  });

  app.get("/api/session/status", (req, res) => {
    const session = getSession(req.cookies[SESSION_COOKIE]);
    if (!session?.connected) return res.json({ connected: false });
    res.json(connectInfo());
  });

  app.get("/api/logs", requireSession, (req, res) => {
    res.json(req.session.logs.entries);
  });

  app.post("/api/extraction/analyze", requireSession, requireConnected, async (req, res) => {
    const urls = (req.body?.urls || []).map((u) => u.trim()).filter(Boolean);
    if (!urls.length) return res.status(400).json({ detail: "Aucune URL fournie" });

    const session = req.session;
    session.extractionExportName = req.body?.filename || "audit-redirections";

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");

    const results = [];
    let totalOcc = 0;
    const impacted = new Set();

    for (let idx = 0; idx < urls.length; idx++) {
      const url = urls[idx];
      const partial = runExtraction([url]);
      const result = partial.results[0];
      results.push(result);
      result.occurrences.forEach((o) => impacted.add(o.file));
      totalOcc += result.occurrences.length;
      session.logs.info(`Extraction ${idx + 1}/${urls.length} — ${url}`);
      res.write(
        JSON.stringify({
          type: "progress",
          current: idx + 1,
          total: urls.length,
          url,
          found: result.found,
        }) + "\n",
      );
      await new Promise((r) => setTimeout(r, 50));
    }

    const summary = {
      urls_analyzed: urls.length,
      occurrences_found: totalOcc,
      files_impacted: impacted.size,
      results,
    };
    session.extractionResult = summary;
    session.logs.info(`Extraction terminée — ${totalOcc} occurrences`);
    res.write(JSON.stringify({ type: "complete", summary }) + "\n");
    res.end();
  });

  app.get("/api/extraction/export", requireSession, requireConnected, (req, res) => {
    const session = req.session;
    if (!session.extractionResult) {
      return res.status(400).json({ detail: "Aucun résultat d'extraction" });
    }
    const name = req.query.filename || session.extractionExportName || "audit-redirections";
    const content = exportExtractionTxt(session.extractionResult, name);
    session.logs.info(`Export TXT — ${name}.txt`);
    res.setHeader("Content-Disposition", `attachment; filename="${name}.txt"`);
    res.type("text/plain").send(content);
  });

  app.post("/api/extraction/reset", requireSession, requireConnected, (req, res) => {
    req.session.extractionResult = null;
    req.session.extractionExportName = "audit-redirections";
    req.session.logs.info("Nouvelle extraction — session réinitialisée");
    res.json({ ok: true });
  });

  app.post("/api/deployment/preview", requireSession, requireConnected, (req, res) => {
    const { lines, errors } = parseDeploymentLines(req.body?.text || "");
    if (errors.length) {
      errors.forEach((e) => req.session.logs.warn(e));
      return res.status(400).json({ detail: { errors } });
    }
    if (!lines.length) return res.status(400).json({ detail: "Aucune ligne valide" });

    const preview = buildPreview(lines);
    req.session.deploymentLines = lines;
    req.session.deploymentPreview = preview;
    req.session.selectedLineNumbers = new Set(
      preview.items.filter((i) => i.applicable).map((i) => i.line_number),
    );
    req.session.logs.info(
      `Analyse — ${preview.applicable_count} applicables, ${preview.conflict_count} conflits`,
    );
    res.json({
      items: preview.items,
      applicable_count: preview.applicable_count,
      conflict_count: preview.conflict_count,
      error_count: preview.error_count,
      suggested_commit_message: buildCommitMessage(preview),
    });
  });

  app.post("/api/deployment/validate", requireSession, requireConnected, (req, res) => {
    const session = req.session;
    if (!session.deploymentPreview || !session.deploymentLines.length) {
      return res.status(400).json({ detail: "Aucune preview — analysez d'abord" });
    }
    if (req.body?.selected_line_numbers?.length) {
      session.selectedLineNumbers = new Set(req.body.selected_line_numbers);
    }
    const applicable = [...session.selectedLineNumbers].filter(Boolean);
    if (!applicable.length) {
      return res.status(400).json({ detail: "Aucune ligne applicable sélectionnée" });
    }
    session.featureBranch = (req.body?.feature_branch || "").trim();
    if (!session.featureBranch) {
      return res.status(400).json({ detail: "Nom de branche requis" });
    }

    const git = new GitService(session.logs, session.pat);
    try {
      git.prepareBaseBranch();
    } catch (e) {
      return res.status(400).json({ detail: e instanceof GitError ? e.message : String(e) });
    }
    session.logs.info("Prévisualisation validée — prep Git OK");
    res.json({ ok: true, feature_branch: session.featureBranch });
  });

  app.post("/api/deployment/branch", requireSession, requireConnected, (req, res) => {
    const session = req.session;
    if (!session.featureBranch) {
      return res.status(400).json({ detail: "Branche feature non définie" });
    }
    if (!session.deploymentLines.length) {
      return res.status(400).json({ detail: "Aucune ligne de déploiement" });
    }

    const git = new GitService(session.logs, session.pat);
    try {
      git.createBranch(session.featureBranch);
      const { adds, mods, files } = applyDeployment(
        session.deploymentLines,
        session.selectedLineNumbers,
      );
      const suppr = session.deploymentLines.filter(
        (l) =>
          session.selectedLineNumbers.has(l.line_number) &&
          l.action === "suppression",
      ).length;
      session.deploymentApplied = true;
      session.applyStats = { adds, suppressions: suppr, files };
      session.logs.info(`Branche ${session.featureBranch} créée — fichiers modifiés`);
      res.json({
        branch: session.featureBranch,
        adds,
        suppressions: suppr,
        modifications: mods,
        files,
      });
    } catch (e) {
      res.status(400).json({ detail: e instanceof GitError ? e.message : String(e) });
    }
  });

  app.post("/api/deployment/commit", requireSession, requireConnected, (req, res) => {
    const session = req.session;
    if (!session.deploymentApplied) {
      return res.status(400).json({ detail: "Appliquez d'abord les changements" });
    }
    const git = new GitService(session.logs, session.pat);
    try {
      session.commitSha = git.commit(req.body?.message || "chore(redirects): update");
      session.logs.info(`Commit ${session.commitSha}`);
      res.json({ commit_sha: session.commitSha });
    } catch (e) {
      res.status(400).json({ detail: e instanceof GitError ? e.message : String(e) });
    }
  });

  app.post("/api/deployment/push", requireSession, requireConnected, (req, res) => {
    const session = req.session;
    if (!session.commitSha) {
      return res.status(400).json({ detail: "Commit requis avant push" });
    }
    const git = new GitService(session.logs, session.pat);
    try {
      git.push(session.featureBranch);
      session.pushDone = true;
      session.logs.info(`Push OK — origin/${session.featureBranch}`);
      res.json({
        branch: session.featureBranch,
        commit_sha: session.commitSha,
        push_ok: true,
        adds: session.applyStats.adds,
        suppressions: session.applyStats.suppressions,
        files: session.applyStats.files,
      });
    } catch (e) {
      res.status(400).json({ detail: e instanceof GitError ? e.message : String(e) });
    }
  });

  app.get("/api/deployment/report", requireSession, requireConnected, (req, res) => {
    const session = req.session;
    const mods = session.deploymentLines.filter(
      (l) =>
        session.selectedLineNumbers.has(l.line_number) &&
        l.action === "modification",
    ).length;
    const content = exportDeploymentReport({
      branch: session.featureBranch,
      commitSha: session.commitSha,
      pushOk: session.pushDone,
      adds: session.applyStats.adds,
      suppressions: session.applyStats.suppressions,
      modifications: mods,
      files: session.applyStats.files,
    });
    res.setHeader("Content-Disposition", 'attachment; filename="rapport-deploiement.txt"');
    res.type("text/plain").send(content);
  });

  app.post("/api/deployment/reset", requireSession, requireConnected, (req, res) => {
    const session = req.session;
    session.deploymentLines = [];
    session.deploymentPreview = null;
    session.selectedLineNumbers = new Set();
    session.featureBranch = "";
    session.commitSha = null;
    session.pushDone = false;
    session.deploymentApplied = false;
    session.applyStats = { adds: 0, suppressions: 0, files: [] };
    session.logs.info("Nouveau déploiement — session réinitialisée");
    res.json({ ok: true });
  });

  const staticDir = join(__dirname, "..", "static");
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(join(staticDir, "index.html"));
    });
  }

  return app;
}
