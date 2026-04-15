import YAML from "yaml";
import type { AgentType } from "../contracts/runtime-types";

export type AgentConfigTemplateInput = {
  skillName: string;
  description: string;
};

export type AgentConfigMapping = {
  path: string;
  renderContent: (input: AgentConfigTemplateInput) => string;
};

function normalizeDescription(text: string): string {
  return text.trim().replace(/\.+$/, "");
}

function buildDefaultPrompt(input: AgentConfigTemplateInput): string {
  const desc = normalizeDescription(input.description) || "execute this skill";
  return `Use $${input.skillName} to ${desc}.`;
}

function renderOpenAiInterfaceYaml(input: AgentConfigTemplateInput): string {
  const payload = {
    interface: {
      display_name: input.skillName,
      short_description: normalizeDescription(input.description),
      default_prompt: buildDefaultPrompt(input),
    },
  };
  return YAML.stringify(payload);
}

export const AGENT_INIT_CONFIG_MAPPINGS: Partial<Record<AgentType, AgentConfigMapping>> = {
  codex: {
    path: "agents/openai.yaml",
    renderContent: renderOpenAiInterfaceYaml,
  },
};

export function resolveAgentInitConfigMapping(agent: AgentType): AgentConfigMapping | undefined {
  return AGENT_INIT_CONFIG_MAPPINGS[agent];
}

export function buildAgentConfigScaffoldPlan(
  agents: AgentType[],
  input: AgentConfigTemplateInput,
): {
  mapped: Array<{ agent: AgentType; path: string; content: string }>;
  unmapped: AgentType[];
} {
  const mapped: Array<{ agent: AgentType; path: string; content: string }> = [];
  const unmapped: AgentType[] = [];
  const seenPaths = new Set<string>();

  for (const agent of agents) {
    const mapping = resolveAgentInitConfigMapping(agent);
    if (!mapping) {
      unmapped.push(agent);
      continue;
    }

    if (seenPaths.has(mapping.path)) {
      continue;
    }
    seenPaths.add(mapping.path);

    mapped.push({
      agent,
      path: mapping.path,
      content: mapping.renderContent(input),
    });
  }

  return { mapped, unmapped };
}
