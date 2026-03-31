# [Issue] Plugins CLI: `update` Command Implementation

> **Depends on:** Plugins CLI App Setup, Plugins CLI: `add` Command (for core contracts)

## Summary

Implement the `update` command in `apps/skillspp-plugins-cli` that refreshes one or more AI-agent plugin configurations to their latest state. The command should:

1. Accept one or more plugin names as positional arguments (or update all installed plugins by default)
2. Optionally accept `--global` to target user-level installs
3. Support a `--dry-run` mode that reports what would change without applying changes
4. Show interactive selection of which plugins to update when running in a TTY
5. Delegate to `packages/core` / `packages/platform-node` for all business logic

---

## Background

As agent tools evolve, their required directory layout, configuration files, or marker files may change. The `update` command is responsible for applying those changes — for example, renaming directories, adding new config files, or migrating a plugin's structure when a new version of `skillspp-plugins-cli` ships a new agent definition.

The update strategy can be defined per-agent in `packages/core/src/runtime/agents.ts`. If no migration is required, `update` is a no-op for that plugin (reports "up to date").

This parallels the `skillspp update` command in `apps/skillspp-cli`, which updates skill content; here we update the plugin/agent infrastructure instead.

---

## CLI Interface

```
skillspp-plugins update [plugin...] [options]

Arguments:
  plugin          Plugin names to update (default: all installed plugins)

Options:
  -g, --global          Update global installs
  --dry-run             Show what would be changed without applying
  --non-interactive     Disable interactive selection prompt
  -h, --help            Show help
```

### Examples

```bash
# Update all installed plugins (interactive selection)
skillspp-plugins update

# Update specific plugin
skillspp-plugins update codex

# Update multiple plugins non-interactively
skillspp-plugins update codex claude-code --non-interactive

# Dry-run to see what would change
skillspp-plugins update --dry-run

# Update global installs
skillspp-plugins update --global
```

---

## Core Package Scaling

If `packages/core` does not yet have update-plugin contracts, the following additions are needed:

### Plugin version/migration descriptor

Each agent entry in `AGENTS` (or a separate `PLUGIN_MIGRATIONS` map) should optionally declare a `schemaVersion` and a `migrate(prevVersion, installDir)` function. This lives in `packages/core/src/runtime/agents.ts` or a new `packages/core/src/runtime/plugin-migrations.ts`.

```typescript
// packages/core/src/runtime/agents.ts or plugin-migrations.ts
export type PluginMigration = {
  fromVersion: number;         // schema version this migration applies to
  toVersion: number;           // resulting schema version
  migrate(installDir: string): Promise<void>;
};

export const PLUGIN_MIGRATIONS: Partial<Record<AgentType, PluginMigration[]>> = {
  // Populated as migrations are needed
};
```

### New contracts (`packages/core/src/contracts/`)

```typescript
// commands.ts additions
export type UpdatePluginCommand = {
  plugins?: string[];          // agent names; undefined = all installed
  global?: boolean;
  dryRun?: boolean;
  nonInteractive?: boolean;
};

// results.ts additions
export type PluginUpdateStatus = 'updated' | 'up-to-date' | 'failed' | 'dry-run';

export type UpdatePluginResult = {
  results: {
    plugin: string;
    status: PluginUpdateStatus;
    details?: string;
  }[];
};
```

### New port method (`packages/core/src/interfaces/ports.ts`)

```typescript
export type CoreCommandPort = {
  // ... existing methods
  updatePlugin(command: UpdatePluginCommand): Promise<UpdatePluginResult>;
};
```

### New service (`packages/core/src/application/services.ts`)

```typescript
export class UpdatePluginService {
  constructor(private readonly port: CoreCommandPort) {}
  execute(command: UpdatePluginCommand): Promise<UpdatePluginResult> {
    return this.port.updatePlugin(command);
  }
}
```

### Platform-node adapter (`packages/platform-node/src/core-port.ts`)

Implement `updatePlugin` by:

1. Resolving which plugins to update (all installed if `plugins` is empty)
2. For each plugin, checking current schema version against latest (via marker file or `PLUGIN_MIGRATIONS`)
3. Running any applicable `PluginMigration` steps in version order
4. In `dryRun` mode, reporting what migrations would run without executing them
5. Returning the full `UpdatePluginResult` set

---

## Implementation Plan

### Phase 1: Core contracts and migration infrastructure

- [ ] Add `PluginMigration` type and `PLUGIN_MIGRATIONS` map to `packages/core/src/runtime/agents.ts` (or a new `plugin-migrations.ts`)
- [ ] Add `UpdatePluginCommand` to `packages/core/src/contracts/commands.ts`
- [ ] Add `UpdatePluginResult` / `PluginUpdateStatus` to `packages/core/src/contracts/results.ts`
- [ ] Add `updatePlugin` to `CoreCommandPort` in `packages/core/src/interfaces/ports.ts`
- [ ] Add `UpdatePluginService` to `packages/core/src/application/services.ts`
- [ ] Implement `updatePlugin` in `packages/platform-node/src/core-port.ts`
- [ ] Export `UpdatePluginService` from `packages/core/src/index.ts`

### Phase 2: CLI command

- [ ] Create `apps/skillspp-plugins-cli/src/commands/update.ts`
  - Parse optional positional `[plugin...]`, `--global`, `--dry-run`, `--non-interactive`
  - Detect all installed plugins when no names are provided
  - In interactive TTY mode, render a multi-select step for which plugins to update
  - Show a summary table of `updated`, `up-to-date`, and `failed` results
  - Respect `--dry-run`: show a diff-like summary without writing
  - Call `UpdatePluginService` via `platform-node` adapter
- [ ] Register the command in `apps/skillspp-plugins-cli/src/cli.ts`

### Phase 3: Tests

See "Test Plan" below.

---

## Test Plan

### Unit tests (`tests/unit/update.test.ts`)

| Scenario | Expected |
|----------|----------|
| No positional args | `plugins` is undefined (means all installed) |
| Named plugins | `plugins` array set correctly |
| `--dry-run` flag | `dryRun: true` in command |
| `--global` flag | `global: true` in command |
| Unknown plugin name | Exits non-zero with "Unknown plugin: <name>" |

### Integration tests (`tests/integration/update.test.ts`)

| Scenario | Expected |
|----------|----------|
| Update already-up-to-date plugin | Reports "up-to-date", exits 0, no changes on disk |
| Update plugin with pending migration (test fixture) | Migration applied, exits 0 |
| `--dry-run` with pending migration | Reports pending changes, no disk writes, exits 0 |
| `--non-interactive` with multiple candidates | Updates all without prompting |
| No plugins installed | Prints "No plugins installed", exits 0 |
| `--global` flag with global install fixture | Targets home-dir path |

### Contract tests

Verify `UpdatePluginService` correctly delegates to `CoreCommandPort.updatePlugin` and returns the result unchanged.

### Migration unit tests (`packages/core/tests/`)

For any `PluginMigration` implementation:

| Scenario | Expected |
|----------|----------|
| Migration `migrate()` succeeds | Target directory modified as expected |
| Migration `migrate()` on wrong `fromVersion` | Not applied |
| Multiple migrations in sequence | All applied in version order |

---

## Acceptance Criteria

- [ ] `skillspp-plugins update` updates all installed plugins that have pending migrations
- [ ] Plugins already up-to-date are reported as such (not as errors)
- [ ] `--dry-run` shows pending migrations without applying them
- [ ] Interactive multi-select lets users pick which plugins to update
- [ ] `--non-interactive` updates all candidates without prompts
- [ ] `--global` targets home-directory installs
- [ ] All unit, integration, and contract tests pass
- [ ] `pnpm run typecheck` passes across the monorepo
- [ ] `scripts/check-boundaries.sh` passes

---

## Labels

`enhancement`, `plugins-cli`
