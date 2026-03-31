# [Issue] Plugins CLI: `remove` Command Implementation

> **Depends on:** Plugins CLI App Setup, Plugins CLI: `add` Command (for core contracts)

## Summary

Implement the `remove` command in `apps/skillspp-plugins-cli` that unregisters/removes one or more AI-agent plugins (codex, claude-code, gemini-cli, cursor, etc.). The command should:

1. Accept one or more plugin names as positional arguments (or `--all` flag)
2. Optionally accept `--global` to target user-level installs
3. Show an interactive confirmation prompt before deleting anything
4. Delegate to `packages/core` / `packages/platform-node` for all business logic

---

## Background

The `add` command (tracked in a separate issue) creates agent directories. The `remove` command is the inverse: it removes the directories created by `add`. If any skills are installed inside the agent directory, the user should be warned before proceeding.

This command follows the same architectural pattern as `apps/skillspp-cli/src/commands/remove.ts` but operates on agent (plugin) directories rather than skill subdirectories.

---

## CLI Interface

```
skillspp-plugins remove <plugin...> [options]
Alias: skillspp-plugins rm

Arguments:
  plugin          One or more plugin names (e.g., codex, claude-code, gemini-cli)

Options:
  --all                 Remove all installed plugins
  -g, --global          Target global installs (user home directory)
  --force               Skip the confirmation prompt (use with care)
  --non-interactive     Disable all prompts (implies --force in CI)
  -h, --help            Show help
```

### Examples

```bash
# Remove a single plugin
skillspp-plugins remove codex

# Remove multiple plugins
skillspp-plugins remove codex claude-code

# Remove all installed plugins (with confirmation)
skillspp-plugins remove --all

# Remove globally, skip confirmation
skillspp-plugins remove cursor --global --force
```

---

## Core Package Scaling

If `packages/core` does not yet have remove-plugin contracts (may be added during the `add` issue), the following additions are needed:

### New contracts (`packages/core/src/contracts/`)

```typescript
// commands.ts additions
export type RemovePluginCommand = {
  plugins?: string[];         // agent names; undefined or empty = interactive
  all?: boolean;              // remove all installed plugins
  global?: boolean;
  force?: boolean;            // skip confirmation
  nonInteractive?: boolean;
};

// results.ts additions
export type RemovePluginResult = {
  removedPlugins: string[];
  skippedPlugins: string[];   // not found / already absent
  failedPlugins: { name: string; reason: string }[];
  hadInstalledSkills: string[]; // plugins that had skills inside (warn user)
};
```

### New port method (`packages/core/src/interfaces/ports.ts`)

```typescript
export type CoreCommandPort = {
  // ... existing methods
  removePlugin(command: RemovePluginCommand): Promise<RemovePluginResult>;
};
```

### New service (`packages/core/src/application/services.ts`)

```typescript
export class RemovePluginService {
  constructor(private readonly port: CoreCommandPort) {}
  execute(command: RemovePluginCommand): Promise<RemovePluginResult> {
    return this.port.removePlugin(command);
  }
}
```

### Platform-node adapter (`packages/platform-node/src/core-port.ts`)

Implement `removePlugin` by:

1. Resolving the install directory for each plugin (project or global path via `getAgentSkillsDir`)
2. Detecting if skills are installed inside the directory (non-empty subdirectory check)
3. Deleting the directory with `fs.rmSync({ recursive: true, force: true })`
4. Returning the result set with `removedPlugins`, `skippedPlugins`, `hadInstalledSkills`

---

## Implementation Plan

### Phase 1: Core contracts (if missing)

- [ ] Add `RemovePluginCommand` to `packages/core/src/contracts/commands.ts`
- [ ] Add `RemovePluginResult` to `packages/core/src/contracts/results.ts`
- [ ] Add `removePlugin` to `CoreCommandPort` in `packages/core/src/interfaces/ports.ts`
- [ ] Add `RemovePluginService` to `packages/core/src/application/services.ts`
- [ ] Implement `removePlugin` in `packages/platform-node/src/core-port.ts`
- [ ] Export `RemovePluginService` from `packages/core/src/index.ts`

### Phase 2: CLI command

- [ ] Create `apps/skillspp-plugins-cli/src/commands/remove.ts`
  - Parse positional `<plugin...>`, `--all`, `--global`, `--force`, `--non-interactive`
  - Resolve candidate plugins: explicit list → all installed (if `--all`) → interactive
  - In interactive TTY, render a "Confirm removal" step listing all targeted plugins
  - Warn (but allow proceeding) if any targeted plugin has skills inside
  - Call `RemovePluginService` via `platform-node` adapter
  - Print `removedPlugins` and `hadInstalledSkills` warnings in output
- [ ] Register the command with alias `rm` in `apps/skillspp-plugins-cli/src/cli.ts`

### Phase 3: Tests

See "Test Plan" below.

---

## Test Plan

### Unit tests (`tests/unit/remove.test.ts`)

| Scenario | Expected |
|----------|----------|
| Valid plugin name(s) | Builds `RemovePluginCommand` with correct `plugins` array |
| `--all` flag | Sets `all: true`, `plugins` is undefined |
| `--global` flag | Sets `global: true` |
| `--force` flag | Sets `force: true`, no confirmation prompt issued |
| Unknown plugin name | Exits non-zero with "Unknown plugin: <name>" |

### Integration tests (`tests/integration/remove.test.ts`)

| Scenario | Expected |
|----------|----------|
| Remove installed plugin (temp dir) | Plugin directory deleted, exits 0 |
| Remove plugin with skills inside | Warns about installed skills, proceeds after confirmation |
| Remove non-existent plugin | Reports skipped, exits 0 |
| `--all` with no installed plugins | Prints "No plugins installed", exits 0 |
| `--force` skips confirmation | No prompt shown, removal completes |
| `--non-interactive` without `--force` in non-TTY | Proceeds without prompt, exits 0 |

### Contract tests

Verify `RemovePluginService` delegates command to `CoreCommandPort.removePlugin` and surfaces the result correctly.

---

## Acceptance Criteria

- [ ] `skillspp-plugins remove <plugin>` deletes the agent directory
- [ ] `skillspp-plugins remove --all` removes all installed plugin directories
- [ ] Plugins not found are reported as skipped (not errors)
- [ ] Removal of a plugin that has skills inside shows a warning
- [ ] Interactive confirmation is shown in TTY mode (skipped with `--force`)
- [ ] `--non-interactive` / `--force` work correctly in CI environments
- [ ] All unit and integration tests pass
- [ ] `pnpm run typecheck` passes across the monorepo
- [ ] `scripts/check-boundaries.sh` passes

---

## Labels

`enhancement`, `plugins-cli`
