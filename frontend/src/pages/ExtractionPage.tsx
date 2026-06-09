import { Fragment, useState } from "react";
import {
  PageHeader,
  SidePanel,
  StatCard,
} from "../components/Layout";
import {
  analyzeExtraction,
  downloadExtraction,
  resetExtraction,
  type ExtractionSummary,
} from "../api";
import { useSession } from "../context/SessionContext";

type Phase = "idle" | "loading" | "done";

interface ProgressItem {
  url: string;
  found: boolean;
  status: "pending" | "processing" | "done";
}

export function ExtractionPage() {
  const { refreshLogs } = useSession();
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("audit-redirections");
  const [filter, setFilter] = useState<"all" | "found" | "missing">("all");
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [summary, setSummary] = useState<ExtractionSummary | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const urls = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const runAnalyze = async () => {
    setError(null);
    setPhase("loading");
    setSummary(null);
    const items: ProgressItem[] = urls.map((url) => ({
      url,
      found: false,
      status: "pending",
    }));
    setProgress(items);

    try {
      const result = await analyzeExtraction(urls, filename, (p) => {
        setProgress((prev) =>
          prev.map((item, idx) => {
            if (idx + 1 < p.current) return { ...item, status: "done" };
            if (idx + 1 === p.current)
              return { ...item, status: "processing", found: p.found };
            return item;
          }),
        );
      });
      setProgress((prev) =>
        prev.map((item) => ({ ...item, status: "done" as const })),
      );
      setSummary(result);
      setPhase("done");
      await refreshLogs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      setPhase("idle");
    }
  };

  const handleReset = async () => {
    await resetExtraction();
    setPhase("idle");
    setText("");
    setSummary(null);
    setProgress([]);
    setExpanded(null);
    await refreshLogs();
  };

  const filteredResults =
    summary?.results.filter((r) => {
      if (filter === "found") return r.found;
      if (filter === "missing") return !r.found;
      return true;
    }) ?? [];

  return (
    <main className="page extraction-page">
      <PageHeader title="Extraction" />

      <div className="split-layout">
        <section className="main-panel">
          <label htmlFor="urls">Liste d&apos;URLs / chemins (une par ligne)</label>
          <textarea
            id="urls"
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={phase === "loading"}
            placeholder={"/ancien-chemin\n/autre-chemin"}
          />

          <label htmlFor="filename">Nom du fichier export</label>
          <input
            id="filename"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            disabled={phase === "loading"}
          />

          {phase === "loading" && (
            <div className="progress-block">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{
                    width: `${
                      progress.length
                        ? (progress.filter((p) => p.status === "done").length /
                            progress.length) *
                          100
                        : 0
                    }%`,
                  }}
                />
              </div>
              <p>
                {progress.filter((p) => p.status === "done").length} /{" "}
                {progress.length} URLs traitées
              </p>
              <ul className="progress-list">
                {progress.map((item) => (
                  <li key={item.url} className={`status-${item.status}`}>
                    {item.status === "done" ? "✓" : item.status === "processing" ? "…" : "○"}{" "}
                    {item.url}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {phase === "idle" && (
            <button
              type="button"
              className="btn primary"
              disabled={!urls.length}
              onClick={runAnalyze}
            >
              Analyser
            </button>
          )}

          {phase === "loading" && (
            <button type="button" className="btn primary" disabled>
              Analyse en cours…
            </button>
          )}

          {error && <p className="error">{error}</p>}

          {phase === "done" && summary && (
            <div className="results-block">
              <div className="stats-row">
                <StatCard label="URLs analysées" value={summary.urls_analyzed} />
                <StatCard
                  label="Occurrences"
                  value={summary.occurrences_found}
                />
                <StatCard
                  label="Fichiers impactés"
                  value={summary.files_impacted}
                />
              </div>

              <div className="filter-row">
                {(["all", "found", "missing"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`filter-chip ${filter === f ? "active" : ""}`}
                    onClick={() => setFilter(f)}
                  >
                    {f === "all" ? "Tous" : f === "found" ? "Trouvés" : "Non trouvés"}
                  </button>
                ))}
              </div>

              <table className="results-table">
                <thead>
                  <tr>
                    <th>URL</th>
                    <th>Occurrences</th>
                    <th>Fichiers</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.map((r) => (
                    <Fragment key={r.url}>
                      <tr
                        className="clickable"
                        onClick={() =>
                          setExpanded(expanded === r.url ? null : r.url)
                        }
                      >
                        <td>{r.url}</td>
                        <td>{r.occurrences.length}</td>
                        <td>
                          {[
                            ...new Set(r.occurrences.map((o) => o.file)),
                          ].join(", ") || "—"}
                        </td>
                      </tr>
                      {expanded === r.url &&
                        r.occurrences.map((o, i) => (
                          <tr key={`${r.url}-${i}`} className="detail-row">
                            <td colSpan={3}>
                              <code>
                                [{o.file}:{o.line_number}] {o.content}
                              </code>
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>

              <div className="action-bar">
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => downloadExtraction(filename)}
                >
                  Télécharger TXT
                </button>
                <button type="button" className="btn" onClick={handleReset}>
                  Nouvelle extraction
                </button>
              </div>
            </div>
          )}
        </section>

        <SidePanel>
          <h3>Résumé</h3>
          <p className="muted">{urls.length} ligne(s) saisie(s)</p>
          {summary && (
            <>
              <StatCard label="Occurrences" value={summary.occurrences_found} />
              <button
                type="button"
                className="btn primary full"
                disabled={phase !== "done"}
                onClick={() => downloadExtraction(filename)}
              >
                Télécharger TXT
              </button>
            </>
          )}
        </SidePanel>
      </div>
    </main>
  );
}
