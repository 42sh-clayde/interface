import { randomUUID } from "crypto";
import { createLogStore } from "./logs.js";

const sessions = new Map();

export function createSession() {
  const session = {
    sessionId: randomUUID(),
    connected: false,
    pat: null,
    logs: createLogStore(),
    extractionResult: null,
    extractionExportName: "audit-redirections",
    deploymentLines: [],
    deploymentPreview: null,
    selectedLineNumbers: new Set(),
    featureBranch: "",
    commitSha: null,
    pushDone: false,
    deploymentApplied: false,
    applyStats: { adds: 0, suppressions: 0, files: [] },
  };
  sessions.set(session.sessionId, session);
  return session;
}

export function getSession(id) {
  return sessions.get(id) || null;
}

export function deleteSession(id) {
  sessions.delete(id);
}
