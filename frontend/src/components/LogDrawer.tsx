import { useMemo, useState } from "react";
import { useSession } from "../context/SessionContext";

type Level = "INFO" | "WARN" | "ERROR";

export function LogDrawer() {
  const { logs, refreshLogs } = useSession();
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<Record<Level, boolean>>({
    INFO: true,
    WARN: true,
    ERROR: true,
  });

  const filtered = useMemo(
    () => logs.filter((l) => filters[l.level]),
    [logs, filters],
  );

  const toggle = (level: Level) =>
    setFilters((f) => ({ ...f, [level]: !f[level] }));

  return (
    <>
      <button
        type="button"
        className="log-fab"
        onClick={() => {
          setOpen(true);
          refreshLogs();
        }}
        aria-label="Ouvrir les logs"
      >
        ≡ Logs
      </button>
      {open && (
        <div className="drawer-overlay" onClick={() => setOpen(false)}>
          <aside
            className="log-drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="drawer-header">
              <h2>Logs</h2>
              <button type="button" onClick={() => setOpen(false)}>
                ×
              </button>
            </header>
            <div className="log-filters">
              {(["INFO", "WARN", "ERROR"] as Level[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`filter-chip ${filters[level] ? "active" : ""} level-${level.toLowerCase()}`}
                  onClick={() => toggle(level)}
                >
                  {level}
                </button>
              ))}
            </div>
            <div className="log-list">
              {filtered.length === 0 && (
                <p className="muted">Aucun log pour le moment.</p>
              )}
              {filtered.map((entry, idx) => (
                <div
                  key={`${entry.timestamp}-${idx}`}
                  className={`log-entry level-${entry.level.toLowerCase()}`}
                >
                  <span className="log-time">{entry.timestamp}</span>
                  <span className="log-level">{entry.level}</span>
                  <span className="log-msg">{entry.message}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
