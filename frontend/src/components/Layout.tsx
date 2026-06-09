import { Link } from "react-router-dom";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  back = true,
}: {
  title: string;
  back?: boolean;
}) {
  return (
    <header className="page-header">
      {back && (
        <Link to="/" className="back-link">
          ← Accueil
        </Link>
      )}
      <h1>{title}</h1>
      <p className="session-banner">
        Session éphémère — refresh efface tout.
      </p>
    </header>
  );
}

export function ActionCard({
  title,
  description,
  onClick,
}: {
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="action-card" onClick={onClick}>
      <h3>{title}</h3>
      <p>{description}</p>
    </button>
  );
}

export function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function SidePanel({ children }: { children: ReactNode }) {
  return <aside className="side-panel">{children}</aside>;
}
