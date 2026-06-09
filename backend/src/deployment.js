import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { join, relative } from "path";
import { settings } from "./config.js";

const ACTION_ALIASES = {
  ajout: "ajout",
  add: "ajout",
  a: "ajout",
  suppression: "suppression",
  suppr: "suppression",
  delete: "suppression",
  del: "suppression",
  modification: "modification",
  modif: "modification",
  mod: "modification",
  modify: "modification",
};

const LINE_PATTERN = /^\s*(\S+)\s+(\S+)\s+\[([^\]]+)\]\s*$/;

function targetDir() {
  return join(settings.repoMountPath, settings.targetFolder);
}

function iterTargetFiles() {
  const base = targetDir();
  const files = [];
  if (!existsSync(base)) return files;
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isFile()) files.push(p);
      else if (statSync(p).isDirectory()) walk(p);
    }
  }
  walk(base);
  return files;
}

export function parseDeploymentLines(text) {
  const lines = [];
  const errors = [];
  text.split("\n").forEach((raw, idx) => {
    const stripped = raw.trim();
    const lineNum = idx + 1;
    if (!stripped || stripped.startsWith("#")) return;
    const match = stripped.match(LINE_PATTERN);
    if (!match) {
      errors.push(
        `Ligne ${lineNum}: format invalide — attendu '/source /cible [ACTION]'`,
      );
      return;
    }
    const [, source, target, actionRaw] = match;
    const actionKey = actionRaw.trim().toLowerCase();
    if (!ACTION_ALIASES[actionKey]) {
      errors.push(`Ligne ${lineNum}: action inconnue '${actionRaw}'`);
      return;
    }
    lines.push({
      line_number: lineNum,
      source,
      target,
      action: ACTION_ALIASES[actionKey],
      raw: stripped,
    });
  });
  return { lines, errors };
}

function redirectExists(source, target = null) {
  const repoRoot = settings.repoMountPath;
  const hits = [];
  for (const filePath of iterTargetFiles()) {
    let content;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    content.split("\n").forEach((line, idx) => {
      const stripped = line.trim();
      if (!stripped || stripped.startsWith("#")) return;
      const parts = stripped.split(/\s+/);
      if (!parts.includes(source)) return;
      if (target !== null && !parts.includes(target)) return;
      hits.push(`${relative(repoRoot, filePath)}:${idx + 1} — ${stripped}`);
    });
  }
  return hits;
}

export function buildPreview(deploymentLines) {
  const items = deploymentLines.map((line) => {
    if (line.action === "ajout") {
      const existing = redirectExists(line.source);
      if (existing.length) {
        return {
          line_number: line.line_number,
          source: line.source,
          target: line.target,
          action: line.action,
          status: "conflict",
          message: `Conflit: ${existing[0]}`,
          applicable: false,
        };
      }
      return {
        line_number: line.line_number,
        source: line.source,
        target: line.target,
        action: line.action,
        status: "ready",
        message: "Aucune occurrence existante",
        applicable: true,
      };
    }
    const existing = redirectExists(line.source);
    if (!existing.length) {
      return {
        line_number: line.line_number,
        source: line.source,
        target: line.target,
        action: line.action,
        status: "not_found",
        message: "Source introuvable",
        applicable: false,
      };
    }
    return {
      line_number: line.line_number,
      source: line.source,
      target: line.target,
      action: line.action,
      status: "ready",
      message: existing[0],
      applicable: true,
    };
  });

  return {
    items,
    applicable_count: items.filter((i) => i.applicable).length,
    conflict_count: items.filter((i) => i.status === "conflict").length,
    error_count: items.filter((i) => i.status === "not_found").length,
  };
}

function defaultRedirectsFile() {
  const base = targetDir();
  mkdirSync(base, { recursive: true });
  const htaccess = join(base, ".htaccess");
  if (existsSync(htaccess)) return htaccess;
  const confFiles = readdirSync(base).filter((f) => f.endsWith(".conf"));
  if (confFiles.length) return join(base, confFiles[0]);
  writeFileSync(htaccess, "# Redirections Apache\n", "utf-8");
  return htaccess;
}

export function applyDeployment(deploymentLines, selectedLineNumbers) {
  const repoRoot = settings.repoMountPath;
  const targetFile = defaultRedirectsFile();
  let contentLines = readFileSync(targetFile, "utf-8").split("\n");
  if (contentLines[contentLines.length - 1] === "") contentLines.pop();

  let adds = 0;
  let mods = 0;
  const modifiedFiles = new Set();

  for (const line of deploymentLines) {
    if (!selectedLineNumbers.has(line.line_number)) continue;
    if (line.action === "ajout") {
      contentLines.push(`Redirect 301 ${line.source} ${line.target}`);
      adds++;
      modifiedFiles.add(relative(repoRoot, targetFile));
    } else if (line.action === "suppression") {
      let removed = false;
      contentLines = contentLines.filter((existing) => {
        if (!removed && existing.includes(line.source)) {
          removed = true;
          return false;
        }
        return true;
      });
      modifiedFiles.add(relative(repoRoot, targetFile));
    } else if (line.action === "modification") {
      contentLines = contentLines.map((existing) => {
        if (
          existing.includes(line.source) &&
          (existing.includes("Redirect") || existing.includes("RewriteRule"))
        ) {
          return `Redirect 301 ${line.source} ${line.target}`;
        }
        return existing;
      });
      mods++;
      modifiedFiles.add(relative(repoRoot, targetFile));
    }
  }

  writeFileSync(targetFile, contentLines.join("\n") + "\n", "utf-8");
  return { adds, mods, files: [...modifiedFiles].sort() };
}

export function buildCommitMessage(preview) {
  const adds = preview.items.filter(
    (i) => i.applicable && i.action === "ajout",
  ).length;
  const suppr = preview.items.filter(
    (i) => i.applicable && i.action === "suppression",
  ).length;
  const mods = preview.items.filter(
    (i) => i.applicable && i.action === "modification",
  ).length;
  const parts = [];
  if (adds) parts.push(`${adds} ajout${adds > 1 ? "s" : ""}`);
  if (suppr) parts.push(`${suppr} suppression${suppr > 1 ? "s" : ""}`);
  if (mods) parts.push(`${mods} modification${mods > 1 ? "s" : ""}`);
  return `chore(redirects): ${parts.length ? parts.join(", ") : "mise à jour"}`;
}

export function exportDeploymentReport(data) {
  const lines = [
    "# Rapport déploiement",
    `Branche: ${data.branch}`,
    `Commit: ${data.commitSha || "—"}`,
    `Push: ${data.pushOk ? "OK" : "—"}`,
    `Ajouts: ${data.adds}`,
    `Suppressions: ${data.suppressions}`,
    `Modifications: ${data.modifications}`,
    "Fichiers:",
  ];
  for (const f of data.files) lines.push(`  - ${f}`);
  return lines.join("\n");
}
