export interface ConnectInfo {
  connected: boolean;
  org?: string;
  project?: string;
  repo?: string;
  default_branch?: string;
  target_folder?: string;
}

export interface LogEntry {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
}

export interface Occurrence {
  file: string;
  line_number: number;
  content: string;
}

export interface UrlResult {
  url: string;
  found: boolean;
  occurrences: Occurrence[];
}

export interface ExtractionSummary {
  urls_analyzed: number;
  occurrences_found: number;
  files_impacted: number;
  results: UrlResult[];
}

export interface PreviewItem {
  line_number: number;
  source: string;
  target: string;
  action: string;
  status: string;
  message: string;
  applicable: boolean;
}

export interface PreviewResponse {
  items: PreviewItem[];
  applicable_count: number;
  conflict_count: number;
  error_count: number;
  suggested_commit_message: string;
}

async function api<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    const detail =
      typeof body.detail === "string"
        ? body.detail
        : JSON.stringify(body.detail ?? body);
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const connect = (pat: string) =>
  api<ConnectInfo>("/api/session/connect", {
    method: "POST",
    body: JSON.stringify({ pat }),
  });

export const disconnect = () =>
  api<{ ok: boolean }>("/api/session/disconnect", { method: "POST" });

export const sessionStatus = () =>
  api<ConnectInfo | { connected: false }>("/api/session/status");

export const fetchLogs = () => api<LogEntry[]>("/api/logs");

export const resetExtraction = () =>
  api<{ ok: boolean }>("/api/extraction/reset", { method: "POST" });

export const resetDeployment = () =>
  api<{ ok: boolean }>("/api/deployment/reset", { method: "POST" });

export async function analyzeExtraction(
  urls: string[],
  filename: string,
  onProgress: (data: {
    current: number;
    total: number;
    url: string;
    found: boolean;
  }) => void,
): Promise<ExtractionSummary> {
  const res = await fetch("/api/extraction/analyze", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls, filename }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? "Erreur analyse");
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let summary: ExtractionSummary | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const data = JSON.parse(line);
      if (data.type === "progress") {
        onProgress(data);
      } else if (data.type === "complete") {
        summary = data.summary;
      }
    }
  }
  if (!summary) throw new Error("Analyse incomplète");
  return summary;
}

export const previewDeployment = (text: string) =>
  api<PreviewResponse>("/api/deployment/preview", {
    method: "POST",
    body: JSON.stringify({ text }),
  });

export const validateDeployment = (
  feature_branch: string,
  selected_line_numbers: number[],
) =>
  api<{ ok: boolean }>("/api/deployment/validate", {
    method: "POST",
    body: JSON.stringify({ feature_branch, selected_line_numbers }),
  });

export const createBranch = () =>
  api<{
    branch: string;
    adds: number;
    suppressions: number;
    modifications: number;
    files: string[];
  }>("/api/deployment/branch", { method: "POST" });

export const commitDeployment = (message: string) =>
  api<{ commit_sha: string }>("/api/deployment/commit", {
    method: "POST",
    body: JSON.stringify({ message }),
  });

export const pushDeployment = () =>
  api<{
    branch: string;
    commit_sha: string;
    push_ok: boolean;
  }>("/api/deployment/push", { method: "POST" });

export function downloadExtraction(filename: string) {
  window.open(
    `/api/extraction/export?filename=${encodeURIComponent(filename)}`,
    "_blank",
  );
}

export function downloadReport() {
  window.open("/api/deployment/report", "_blank");
}
