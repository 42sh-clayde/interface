import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { settings } from "./config.js";

export class GitError extends Error {}

export class GitService {
  constructor(logs, pat = null) {
    this.logs = logs;
    this.pat = pat;
    this.repoPath = settings.repoMountPath;
  }

  env() {
    const env = { ...process.env };
    if (this.pat) {
      env.GIT_TERMINAL_PROMPT = "0";
      env.GIT_ASKPASS = "echo";
      env.GIT_USERNAME = "pat";
      env.GIT_PASSWORD = this.pat;
    }
    return env;
  }

  run(args, logCmd = true) {
    if (logCmd) this.logs.info(`git ${args.join(" ")}`);
    const result = spawnSync("git", args, {
      cwd: this.repoPath,
      encoding: "utf-8",
      env: this.env(),
    });
    if (result.status !== 0) {
      const message =
        (result.stderr || result.stdout || "").trim() || "Commande git échouée";
      this.logs.error(message);
      throw new GitError(message);
    }
    const out = (result.stdout || "").trim();
    if (out && logCmd) {
      const last = out.split("\n").pop();
      this.logs.info(last.slice(0, 200));
    }
    return { stdout: result.stdout || "", stderr: result.stderr || "" };
  }

  validateRepo() {
    if (!existsSync(this.repoPath)) {
      throw new GitError(`Repo introuvable: ${this.repoPath}`);
    }
    if (!existsSync(join(this.repoPath, ".git"))) {
      throw new GitError(`Pas un dépôt git: ${this.repoPath}`);
    }
  }

  lsRemote() {
    this.run(["ls-remote", settings.remoteName, "HEAD"]);
  }

  checkout(branch) {
    this.run(["checkout", branch]);
  }

  fetch() {
    this.run(["fetch", settings.remoteName]);
  }

  pull(branch = settings.defaultBranch) {
    this.run(["pull", settings.remoteName, branch]);
  }

  createBranch(name) {
    this.run(["checkout", "-b", name]);
  }

  commit(message) {
    this.run(["add", "-A", settings.targetFolder]);
    const status = this.run(["status", "--porcelain"], false);
    if (!status.stdout.trim()) {
      throw new GitError("Aucun changement à committer");
    }
    this.run(["commit", "-m", message]);
    return this.run(["rev-parse", "--short", "HEAD"], false).stdout.trim();
  }

  push(branchName) {
    this.run(["push", "-u", settings.remoteName, branchName]);
  }

  prepareBaseBranch() {
    this.checkout(settings.defaultBranch);
    this.fetch();
    this.pull(settings.defaultBranch);
    const head = this.run(["rev-parse", "--short", "HEAD"], false).stdout.trim();
    this.logs.info(`Branche ${settings.defaultBranch} à jour (${head})`);
    return head;
  }
}
