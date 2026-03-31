import { describe, expect, it } from "vitest";
import {
  AddPluginService,
  AddSkillService,
  CheckSkillService,
  FindSkillService,
  InitSkillService,
  ListSkillService,
  RemoveSkillService,
  UpdateSkillService,
  ValidateSkillService,
  type CoreCommandPort,
} from "../index";

describe("core services delegation @unit", () => {
  it("delegates each service call to its command port @unit", async () => {
    const calls: string[] = [];

    const port: CoreCommandPort = {
      async addSkill() {
        calls.push("add");
        return { installedSkillNames: [], agentCount: 0 };
      },
      async updateSkill() {
        calls.push("update");
        return { updatedSkillNames: [] };
      },
      async checkSkill() {
        calls.push("check");
        return { drift: [], checked: 0 };
      },
      async validateSkill() {
        calls.push("validate");
        return { diagnostics: [] };
      },
      async listSkill() {
        calls.push("list");
        return { rows: [] };
      },
      async removeSkill() {
        calls.push("remove");
        return { removedCount: 0, removedSkillNames: [] };
      },
      async findSkill() {
        calls.push("find");
        return { sourceType: "local", sourceLabel: "", skills: [] };
      },
      async initSkill() {
        calls.push("init");
        return { skillPath: "", agentsConfigured: [] };
      },
      async addPlugin() {
        calls.push("addPlugin");
        return { installedPlugins: [], skippedPlugins: [], failedPlugins: [] };
      },
    };

    await new AddSkillService(port).execute({ source: "./skills" });
    await new UpdateSkillService(port).execute({});
    await new CheckSkillService(port).execute({});
    await new ValidateSkillService(port).execute({ source: "./skills" });
    await new ListSkillService(port).execute({});
    await new RemoveSkillService(port).execute({});
    await new FindSkillService(port).execute({ source: "./skills" });
    await new InitSkillService(port).execute({});
    await new AddPluginService(port).execute({ source: "./plugins", agents: ["codex"] });

    expect(calls).toEqual([
      "add",
      "update",
      "check",
      "validate",
      "list",
      "remove",
      "find",
      "init",
      "addPlugin",
    ]);
  });
});
