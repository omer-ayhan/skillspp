import path from "node:path";
import type { ParsedSource } from "../contracts/runtime-types";

function isLocalPath(input: string): boolean {
  return (
    path.isAbsolute(input) ||
    input === "." ||
    input === ".." ||
    input.startsWith("./") ||
    input.startsWith("../") ||
    /^[a-zA-Z]:[\\/]/.test(input)
  );
}

export function parseSource(input: string): ParsedSource {
  if (input.startsWith("catalog+https://")) {
    return { type: "catalog", url: input.slice("catalog+".length) };
  }

  if (isLocalPath(input)) {
    return { type: "local", localPath: path.resolve(input) };
  }

  const githubTreeWithPath = input.match(
    /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/
  );
  if (githubTreeWithPath) {
    const [, owner, repo, ref, subpath] = githubTreeWithPath;
    return {
      type: "github",
      repoUrl: `https://github.com/${owner}/${repo.replace(/\.git$/, "")}.git`,
      ref,
      subpath,
    };
  }

  const githubTree = input.match(
    /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)$/
  );
  if (githubTree) {
    const [, owner, repo, ref] = githubTree;
    return {
      type: "github",
      repoUrl: `https://github.com/${owner}/${repo.replace(/\.git$/, "")}.git`,
      ref,
    };
  }

  const githubRepo = input.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (githubRepo) {
    const [, owner, repo] = githubRepo;
    return {
      type: "github",
      repoUrl: `https://github.com/${owner}/${repo.replace(/\.git$/, "")}.git`,
    };
  }

  const gitlabRepo = input.match(/gitlab\.com\/([^/]+)\/([^/]+)/);
  if (gitlabRepo) {
    const [, owner, repo] = gitlabRepo;
    return {
      type: "git",
      repoUrl: `https://gitlab.com/${owner}/${repo.replace(/\.git$/, "")}.git`,
    };
  }

  const shorthand = input.match(/^([^/]+)\/([^/]+)(?:\/(.+))?$/);
  if (shorthand && !input.includes(":") && !input.startsWith(".")) {
    const [, owner, repo, subpath] = shorthand;
    return {
      type: "github",
      repoUrl: `https://github.com/${owner}/${repo.replace(/\.git$/, "")}.git`,
      subpath,
    };
  }

  if (input.startsWith("http://") || input.startsWith("https://")) {
    if (input.endsWith(".git")) {
      return { type: "git", repoUrl: input };
    }
    return { type: "well-known", url: input };
  }

  return { type: "git", repoUrl: input };
}
