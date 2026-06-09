import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ActionCard } from "../components/Layout";
import { useSession } from "../context/SessionContext";

export function HubPage() {
  const navigate = useNavigate();
  const { connected, info, connect, disconnect } = useSession();
  const [pat, setPat] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setError(null);
    setLoading(true);
    try {
      await connect(pat);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connexion échouée");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page hub-page">
      <div className="hub-card">
        <h1>Assistant Redirections Apache</h1>

        {!connected ? (
          <div className="connect-form">
            <label htmlFor="pat">PAT Azure DevOps</label>
            <input
              id="pat"
              type="password"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder="Personal Access Token"
              autoComplete="off"
            />
            <p className="hint">Scopes requis : Code (Read &amp; Write)</p>
            {error && <p className="error">{error}</p>}
            <button
              type="button"
              className="btn primary"
              disabled={!pat || loading}
              onClick={handleConnect}
            >
              {loading ? "Vérification…" : "Vérifier la connexion"}
            </button>
          </div>
        ) : (
          <div className="connected-block">
            <div className="status-pill">✓ Connecté</div>
            <dl className="info-grid">
              <div>
                <dt>Organisation / Projet / Repo</dt>
                <dd>
                  {info?.org} / {info?.project} / {info?.repo}
                </dd>
              </div>
              <div>
                <dt>Branche cible</dt>
                <dd>{info?.default_branch}</dd>
              </div>
              <div>
                <dt>Dossier</dt>
                <dd>{info?.target_folder}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="btn link"
              onClick={() => disconnect()}
            >
              Se déconnecter
            </button>
            <div className="action-cards">
              <ActionCard
                title="Extraction"
                description="Auditer les URLs dans le repo"
                onClick={() => navigate("/extraction")}
              />
              <ActionCard
                title="Déploiement"
                description="Pipeline Git pour les redirections"
                onClick={() => navigate("/deployment")}
              />
            </div>
          </div>
        )}

        <p className="session-banner center">
          Session éphémère — refresh efface tout.
        </p>
      </div>
    </main>
  );
}
