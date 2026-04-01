import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getAgentPluginsDir,
  getAgentSkillsDir,
  resolveAddPluginAgentSelectionRows,
} from "./agents";

describe("plugin agent path resolution @unit", () => {
  it("exposes plugin selection rows for local codex installs @unit", () => {
    const rows = resolveAddPluginAgentSelectionRows("local");
    expect(rows.find((row) => row.id === "codex")).toMatchObject({
      id: "codex",
      label: "Codex",
      description: ".agents/plugins/cache",
    });
  });

  it("resolves plugin directories without changing skill directories @unit", () => {
    const cwd = path.join("/tmp", "skillspp-plugin-agent-paths");

    expect(getAgentPluginsDir("codex", false, cwd)).toBe(
      path.join(cwd, ".agents", "plugins", "cache"),
    );
    expect(getAgentPluginsDir("codex", true, cwd)).toBe(
      path.join(os.homedir(), ".codex", "plugins", "cache"),
    );

    expect(getAgentSkillsDir("codex", false, cwd)).toBe(
      path.join(cwd, ".agents", "skills"),
    );
    expect(getAgentSkillsDir("codex", true, cwd)).toBe(
      path.join(os.homedir(), ".codex", "skills"),
    );
  });
});
