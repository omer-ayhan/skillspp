# [Issue] Plugins CLI: `add` Command Implementation

> **Depends on:** Plugins CLI App Setup

## Summary

Implement the `add` command in `apps/skillspp-plugins-cli` that installs one or more AI-agent plugins (e.g., codex, claude-code, gemini-cli, cursor). The command should:

1. Accept a plugin name (or a list of plugin names) as positional arguments
2. Optionally accept `--global` to install for the current user rather than the project
3. Interactively confirm the installation when running in a TTY
4. Delegate to `packages/core` / `packages/platform-node` for all business logic

"Plugins" in this context are the agent entries defined in `packages/core/src/runtime/agents.ts` (`AGENTS` / `STANDARD_AGENTS`). The `add` command registers an agent config directory so the agent can discover skills installed by `skillspp-cli`.

---

## Background

The existing `skillspp add` command in `apps/skillspp-cli` installs **skills** into agent directories. The new `skillspp-plugins add` command installs/registers the **agent directories themselves** — it is the complement operation. If `packages/core` does not yet have the necessary contracts or services for plugin management, they must be added as part of this work (see "Core Package Scaling" below).

---

## CLI Interface

```
skillspp-plugins add <plugin...> [options]

Arguments:
  plugin          One or more plugin names (e.g., codex, claude-code, gemini-cli)
                  Use '*' to install all detected supported plugins.

Options:
  -g, --global          Install globally (user home directory)
  --non-interactive     Disable all prompts
  -h, --help            Show help
```

### Examples

```bash
# Install codex plugin
skillspp-plugins add codex

# Install multiple plugins
skillspp-plugins add codex claude-code gemini-cli

# Install globally
skillspp-plugins add cursor --global

# Non-interactive (CI)
skillspp-plugins add codex --non-interactive
```

---

## Core Package Scaling

If `packages/core` does not yet have plugin (agent) management contracts, the following additions are needed **before** the CLI command can delegate properly:

### New contracts (`packages/core/src/contracts/`)

```typescript
// commands.ts additions
export type AddPluginCommand = {
  plugins: string[];          // agent names (e.g., ['codex', 'claude-code'])
  global?: boolean;
  nonInteractive?: boolean;
};

// results.ts additions
export type AddPluginResult = {
  installedPlugins: string[];
  skippedPlugins: string[];   // already installed
  failedPlugins: { name: string; reason: string }[];
};
```

### New port method (`packages/core/src/interfaces/ports.ts`)

```typescript
export type CoreCommandPort = {
  // ... existing methods
  addPlugin(command: AddPluginCommand): Promise<AddPluginResult>;
};
```

### New service (`packages/core/src/application/services.ts`)

```typescript
export class AddPluginService {
  constructor(private readonly port: CoreCommandPort) {}
  execute(command: AddPluginCommand): Promise<AddPluginResult> {
    return this.port.addPlugin(command);
  }
}
```

### Platform-node adapter (`packages/platform-node/src/core-port.ts`)

Implement `addPlugin` by:
1. Validating each plugin name against `AGENTS`
2. Creating the agent's skill directory (`projectSkillsDir` or `globalSkillsDir`) under the appropriate base path
3. Writing a minimal marker file (e.g., `.skillspp-plugin`) if needed to signal "managed by skillspp-plugins"
4. Returning the result set

---

## Implementation Plan

### Phase 1: Core contracts (if missing)

- [ ] Add `AddPluginCommand` to `packages/core/src/contracts/commands.ts`
- [ ] Add `AddPluginResult` to `packages/core/src/contracts/results.ts`
- [ ] Add `addPlugin` to `CoreCommandPort` in `packages/core/src/interfaces/ports.ts`
- [ ] Add `AddPluginService` to `packages/core/src/application/services.ts`
- [ ] Implement `addPlugin` in `packages/platform-node/src/core-port.ts`
- [ ] Export `AddPluginService` from `packages/core/src/index.ts`

### Phase 2: CLI command

- [ ] Create `apps/skillspp-plugins-cli/src/commands/add.ts`
  - Parse positional `<plugin...>` and `--global` / `--non-interactive` flags
  - Validate plugin names against `AGENTS` (import from `@skillspp/core/agents`)
  - Show interactive confirmation summary when running in a TTY
  - Call `AddPluginService` via `platform-node` adapter
  - Render success / failure output using Commander or minimal `picocolors` output
- [ ] Register the command in `apps/skillspp-plugins-cli/src/cli.ts`

### Phase 3: Tests

See "Test Plan" below.

---

## Test Plan

### Unit tests (`tests/unit/add.test.ts`)

| Scenario | Expected |
|----------|----------|
| Valid single plugin name | Resolves `AddPluginCommand` with correct fields |
| Valid multiple plugin names | All names passed in `plugins` array |
| Unknown plugin name | Throws / prints error "Unknown plugin: <name>" |
| `--global` flag | Sets `global: true` in command |
| `--non-interactive` flag | Sets `nonInteractive: true` |

### Integration tests (`tests/integration/add.test.ts`)

| Scenario | Expected |
|----------|----------|
| `skillspp-plugins add codex` (temp dir) | Creates `.codex/` marker directory |
| `skillspp-plugins add codex --global` | Creates `~/.codex/` marker directory |
| `skillspp-plugins add unknown-plugin` | Exits non-zero, prints error |
| `skillspp-plugins add codex --non-interactive` | Completes without prompt, exits 0 |
| `skillspp-plugins add codex` (already installed) | Reports skipped, exits 0 |

### Contract tests (if core contracts change)

Verify `AddPluginService` correctly passes the command to `CoreCommandPort.addPlugin` and surfaces the result.

---

## Acceptance Criteria

- [ ] `skillspp-plugins add <plugin>` creates the expected agent directory
- [ ] `skillspp-plugins add <plugin> --global` targets home directory
- [ ] Unknown plugin names exit non-zero with a descriptive error
- [ ] Already-installed plugins are reported as skipped, not as errors
- [ ] `--non-interactive` mode works correctly in CI environments
- [ ] All unit and integration tests pass
- [ ] `pnpm run typecheck` passes across the monorepo
- [ ] `scripts/check-boundaries.sh` passes

---

## Labels

`enhancement`, `plugins-cli`
