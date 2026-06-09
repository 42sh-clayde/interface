import { useState } from "react";
import { PageHeader } from "../components/Layout";
import {
  createBranch,
  commitDeployment,
  downloadReport,
  previewDeployment,
  pushDeployment,
  resetDeployment,
  validateDeployment,
  type PreviewItem,
  type PreviewResponse,
} from "../api";
import { useSession } from "../context/SessionContext";

type Phase = "draft" | "pipeline" | "complete";

type PipelineStep = "preview" | "branch" | "commit" | "push";

const defaultBranch = () => {
  const d = new Date();
  const iso = d.toISOString().slice(0, 10);
  return `feature/redirects-${iso}`;
};

export function DeploymentPage() {
  const { refreshLogs } = useSession();
  const [phase, setPhase] = useState<Phase>("draft");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [featureBranch, setFeatureBranch] = useState(defaultBranch());
  const [commitMessage, setCommitMessage] = useState("");
  const [activeStep, setActiveStep] = useState<PipelineStep>("preview");
  const [branchDone, setBranchDone] = useState(false);
  const [commitSha, setCommitSha] = useState<string | null>(null);
  const [pushDone, setPushDone] = useState(false);
  const [applyStats, setApplyStats] = useState<{
    adds: number;
    suppressions: number;
    files: string[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);

  const analyze = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await previewDeployment(text);
      setPreview(result);
      setSelected(
        new Set(result.items.filter((i) => i.applicable).map((i) => i.line_number)),
      );
      setCommitMessage(result.suggested_commit_message);
      await refreshLogs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur analyse");
    } finally {
      setLoading(false);
    }
  };

  const validatePreview = async () => {
    setError(null);
    setLoading(true);
    try {
      await validateDeployment(featureBranch, [...selected]);
      setPhase("pipeline");
      setActiveStep("branch");
      setPreviewCollapsed(true);
      await refreshLogs();
      await runBranchStep();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation échouée");
    } finally {
      setLoading(false);
    }
  };

  const runBranchStep = async () => {
    setLoading(true);
    try {
      const result = await createBranch();
      setBranchDone(true);
      setApplyStats({
        adds: result.adds,
        suppressions: result.suppressions,
        files: result.files,
      });
      setActiveStep("commit");
      await refreshLogs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création branche échouée");
    } finally {
      setLoading(false);
    }
  };

  const runCommit = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await commitDeployment(commitMessage);
      setCommitSha(result.commit_sha);
      setActiveStep("push");
      await refreshLogs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Commit échoué");
    } finally {
      setLoading(false);
    }
  };

  const runPush = async () => {
    if (!window.confirm(`Pousser ${featureBranch} vers origin ?`)) return;
    setError(null);
    setLoading(true);
    try {
      await pushDeployment();
      setPushDone(true);
      setPhase("complete");
      await refreshLogs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Push échoué");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    await resetDeployment();
    setPhase("draft");
    setText("");
    setPreview(null);
    setSelected(new Set());
    setFeatureBranch(defaultBranch());
    setCommitMessage("");
    setActiveStep("preview");
    setBranchDone(false);
    setCommitSha(null);
    setPushDone(false);
    setApplyStats(null);
    setPreviewCollapsed(false);
    await refreshLogs();
  };

  const toggleLine = (item: PreviewItem) => {
    if (!item.applicable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.line_number)) next.delete(item.line_number);
      else next.add(item.line_number);
      return next;
    });
  };

  const stepStatus = (step: PipelineStep) => {
    const order: PipelineStep[] = ["preview", "branch", "commit", "push"];
    const activeIdx = order.indexOf(activeStep);
    const idx = order.indexOf(step);
    if (phase === "complete") return "done";
    if (idx < activeIdx) return "done";
    if (idx === activeIdx) return "active";
    return "locked";
  };

  return (
    <main className="page deployment-page">
      <PageHeader title="Déploiement" />

      {phase === "draft" && (
        <section className="main-panel">
          <label htmlFor="lines">Redirections Apache</label>
          <textarea
            id="lines"
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"/source /cible [ajout]\n/old /gone [suppression]"}
          />
          <details className="help-block">
            <summary>Format attendu</summary>
            <pre>{`/source /cible [ajout]\n/old /gone [suppression]\n/source /new-cible [modification]`}</pre>
          </details>

          <button
            type="button"
            className="btn primary"
            disabled={!text.trim() || loading}
            onClick={analyze}
          >
            {loading ? "Analyse…" : "Analyser"}
          </button>

          {preview && (
            <div className="preview-block">
              <p className="recap">
                {preview.applicable_count} applicables · {preview.conflict_count}{" "}
                conflits · {preview.error_count} erreurs
              </p>
              <div className="preview-cards">
                {preview.items.map((item) => (
                  <label
                    key={item.line_number}
                    className={`preview-card status-${item.status}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(item.line_number)}
                      disabled={!item.applicable}
                      onChange={() => toggleLine(item)}
                    />
                    <div>
                      <strong>
                        {item.action.toUpperCase()} {item.source} → {item.target}
                      </strong>
                      <p>{item.message}</p>
                    </div>
                  </label>
                ))}
              </div>
              <label htmlFor="branch">Branche feature</label>
              <input
                id="branch"
                value={featureBranch}
                onChange={(e) => setFeatureBranch(e.target.value)}
              />
              <button
                type="button"
                className="btn primary"
                disabled={loading || selected.size === 0}
                onClick={validatePreview}
              >
                Valider la prévisualisation
              </button>
            </div>
          )}
        </section>
      )}

      {(phase === "pipeline" || phase === "complete") && (
        <section className="main-panel">
          {previewCollapsed && preview && (
            <details className="collapsed-preview">
              <summary>
                Prévisualisation ({preview.applicable_count} changements)
              </summary>
              <ul>
                {preview.items
                  .filter((i) => selected.has(i.line_number))
                  .map((i) => (
                    <li key={i.line_number}>
                      {i.action} {i.source} → {i.target}
                    </li>
                  ))}
              </ul>
            </details>
          )}

          <ol className="pipeline">
            <li className={`step ${stepStatus("preview")}`}>
              <span className="step-icon">
                {stepStatus("preview") === "done" ? "✓" : "●"}
              </span>
              <div>
                <h3>Prévisualisation validée</h3>
                <p>
                  {selected.size} changement(s) · branche {featureBranch}
                </p>
              </div>
            </li>

            <li className={`step ${stepStatus("branch")}`}>
              <span className="step-icon">
                {branchDone ? "✓" : stepStatus("branch") === "active" ? "●" : "○"}
              </span>
              <div>
                <h3>Création de branche</h3>
                {loading && activeStep === "branch" && <p>En cours…</p>}
                {branchDone && applyStats && (
                  <p>
                    ✓ Branche créée — {applyStats.files.length} fichier(s) modifié(s)
                  </p>
                )}
              </div>
            </li>

            <li className={`step ${stepStatus("commit")}`}>
              <span className="step-icon">
                {commitSha ? "✓" : stepStatus("commit") === "active" ? "●" : "○"}
              </span>
              <div>
                <h3>Commit</h3>
                {activeStep === "commit" && !commitSha && (
                  <>
                    <textarea
                      rows={2}
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn primary"
                      disabled={loading}
                      onClick={runCommit}
                    >
                      Commit
                    </button>
                  </>
                )}
                {commitSha && <p>Commit {commitSha}</p>}
              </div>
            </li>

            <li className={`step ${stepStatus("push")}`}>
              <span className="step-icon">
                {pushDone ? "✓" : stepStatus("push") === "active" ? "●" : "○"}
              </span>
              <div>
                <h3>Push</h3>
                {activeStep === "push" && !pushDone && (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={loading}
                    onClick={runPush}
                  >
                    Push
                  </button>
                )}
                {pushDone && <p>✓ origin/{featureBranch}</p>}
              </div>
            </li>
          </ol>

          {phase === "complete" && (
            <div className="complete-block">
              <h2>Déploiement terminé</h2>
              <dl className="info-grid">
                <div>
                  <dt>Branche</dt>
                  <dd>{featureBranch}</dd>
                </div>
                <div>
                  <dt>Commit</dt>
                  <dd>{commitSha}</dd>
                </div>
                <div>
                  <dt>Changements</dt>
                  <dd>
                    {applyStats?.adds ?? 0} ajouts,{" "}
                    {applyStats?.suppressions ?? 0} suppressions
                  </dd>
                </div>
              </dl>
              <div className="action-bar">
                <button type="button" className="btn" onClick={downloadReport}>
                  Télécharger rapport
                </button>
                <button type="button" className="btn primary" onClick={handleReset}>
                  Nouveau déploiement
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  );
}
