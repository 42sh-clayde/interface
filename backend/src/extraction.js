import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { settings } from "./config.js";

function targetDir() {
  return join(settings.repoMountPath, settings.targetFolder);
}

function iterTargetFiles() {
  const base = targetDir();
  const files = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isFile()) files.push(p);
      else if (statSync(p).isDirectory()) walk(p);
    }
  }
  walk(base);
  return files;
}

function searchUrlInFile(filePath, url, repoRoot) {
  const occurrences = [];
  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return occurrences;
  }
  content.split("\n").forEach((line, idx) => {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) return;
    if (line.includes(url)) {
      occurrences.push({
        file: relative(repoRoot, filePath),
        line_number: idx + 1,
        content: stripped,
      });
    }
  });
  return occurrences;
}

export function runExtraction(urls) {
  const repoRoot = settings.repoMountPath;
  const files = iterTargetFiles();
  const results = [];
  let totalOccurrences = 0;
  const impacted = new Set();

  for (const url of urls) {
    const urlOccurrences = [];
    for (const filePath of files) {
      const found = searchUrlInFile(filePath, url, repoRoot);
      urlOccurrences.push(...found);
      found.forEach((o) => impacted.add(o.file));
    }
    totalOccurrences += urlOccurrences.length;
    results.push({
      url,
      found: urlOccurrences.length > 0,
      occurrences: urlOccurrences,
    });
  }

  return {
    urls_analyzed: urls.length,
    occurrences_found: totalOccurrences,
    files_impacted: impacted.size,
    results,
  };
}

export function exportExtractionTxt(summary, filename) {
  const lines = [
    `# Rapport extraction — ${filename}`,
    `URLs analysées: ${summary.urls_analyzed}`,
    `Occurrences: ${summary.occurrences_found}`,
    `Fichiers impactés: ${summary.files_impacted}`,
    "",
  ];
  for (const r of summary.results) {
    lines.push(`## ${r.url} — ${r.found ? "TROUVÉ" : "NON TROUVÉ"}`);
    if (!r.occurrences.length) lines.push("  (aucune occurrence)");
    for (const o of r.occurrences) {
      lines.push(`  [${o.file}:${o.line_number}] ${o.content}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
