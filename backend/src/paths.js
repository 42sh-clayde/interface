import { resolve } from "path";

/** Corrige C:/c/users/... (double lettre de lecteur après conversion MSYS). */
function fixDoubleDrive(p) {
  const m = p.match(/^([A-Za-z]):\/?([a-zA-Z])\/?(.*)$/);
  if (m && m[1].toLowerCase() === m[2].toLowerCase()) {
    return `/${m[2]}/${m[3]}`;
  }
  return p;
}

/** Normalise REPO_PATH / REPO_MOUNT_PATH (Git Bash /c/... → chemin utilisable par Node). */
export function normalizeRepoPath(raw) {
  if (!raw) return raw;
  let p = raw.trim();
  if (!p) return p;

  p = p.replace(/\\/g, "/");
  p = fixDoubleDrive(p);

  // Git Bash : /c/Users/foo → C:/Users/foo (Node + git.exe sur Windows)
  const bashDrive = p.match(/^\/([a-zA-Z])\/(.*)$/);
  if (bashDrive) {
    return `${bashDrive[1].toUpperCase()}:/${bashDrive[2]}`;
  }

  // C:/Users/foo déjà OK
  const winDrive = p.match(/^([a-zA-Z]):\/(.*)$/);
  if (winDrive) {
    return `${winDrive[1].toUpperCase()}:/${winDrive[2]}`;
  }

  return resolve(p);
}

export function resolveRepoMountPath() {
  const raw = process.env.REPO_MOUNT_PATH || process.env.REPO_PATH || "/workspace/repo";
  const normalized = normalizeRepoPath(raw);

  if (
    process.platform === "win32" &&
    (raw === "/workspace/repo" ||
      normalized.replace(/\\/g, "/").toLowerCase().includes("/program files/git/"))
  ) {
    throw new Error(
      "REPO_PATH invalide sur Windows : indiquez le chemin local du clone (ex. C:/Users/Vous/mon-repo), pas /workspace/repo",
    );
  }

  return normalized;
}
