import { resolveRepoMountPath } from "./paths.js";

export const settings = {
  azdoOrg: process.env.AZDO_ORG || "mon-org",
  azdoProject: process.env.AZDO_PROJECT || "mon-projet",
  azdoRepo: process.env.AZDO_REPO || "mon-repo",
  defaultBranch: process.env.DEFAULT_BRANCH || "main",
  targetFolder: process.env.TARGET_FOLDER || "config/apache/redirects",
  repoMountPath: resolveRepoMountPath(),
  remoteName: process.env.REMOTE_NAME || "origin",
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 3100),
  skipRemoteCheck: process.env.SKIP_REMOTE_CHECK === "true",
};

export function connectInfo() {
  return {
    connected: true,
    org: settings.azdoOrg,
    project: settings.azdoProject,
    repo: settings.azdoRepo,
    default_branch: settings.defaultBranch,
    target_folder: settings.targetFolder,
  };
}
