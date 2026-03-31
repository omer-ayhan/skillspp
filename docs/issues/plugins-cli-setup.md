# [Issue] Plugins CLI: App Setup

## Summary

Bootstrap a new `apps/skillspp-plugins-cli` application in the monorepo. This CLI will let users add, remove, and update AI-agent plugins (codex, claude-code, gemini-cli, cursor, etc.) by delegating to the core package's existing service layer. The setup issue covers scaffolding, wiring, and baseline infrastructure only — command implementations are tracked in separate issues.

---

## Background

The monorepo already contains:

- `apps/skillspp-cli` — skill management CLI  
- `apps/skillspp-mcp` — MCP transport over stdio  
- `packages/core` — contracts, services, ports (no transport concerns)  
- `packages/platform-node` — Node.js adapter for core ports  
- `packages/test-kit` — shared test utilities  

The new `apps/skillspp-plugins-cli` must follow the same transport-layer pattern: it owns command parsing, UX, and wiring; business logic lives in `packages/core`.

---

## Scope

This issue covers only the **app skeleton**:

- Monorepo registration (pnpm workspace, Turbo task graph, `tsconfig.json` project references)
- `package.json` with name `skillspp-plugins`, binary entry, and workspace dependencies
- TypeScript configuration (`tsconfig.json`) aligned with `tsconfig.base.json`
- Entry point `src/cli.ts` that creates a Commander program and registers placeholder subcommands
- `command-builder.ts` (context/telemetry wiring, matching the pattern in `apps/skillspp-cli`)
- Vitest config and test directory stubs (`tests/unit/`, `tests/integration/`, `tests/e2e/`)
- ESLint config (extend workspace root config)
- Build/bundle script (`tsup` or `esbuild` matching the rest of the monorepo)

---

## Implementation Plan

### 1. Create the package

```
apps/skillspp-plugins-cli/
├── src/
│   ├── cli.ts               # entry point, Commander program
│   ├── command-builder.ts   # context, telemetry wiring
│   └── commands/            # empty stubs for add / remove / update
│       ├── add.ts
│       ├── remove.ts
│       └── update.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### 2. `package.json`

- `name`: `skillspp-plugins`
- `bin`: points to compiled `dist/cli.js`
- Workspace dependencies: `@skillspp/core`, `@skillspp/platform-node`
- Dev dependencies: `typescript`, `vitest`, `tsup` (or matching build tool)
- Scripts: `build`, `typecheck`, `lint`, `test:unit`, `test:integration`, `test:e2e`

### 3. Register in monorepo

- Add `apps/skillspp-plugins-cli` to `tsconfig.json` project references at the root
- Verify `pnpm-workspace.yaml` already picks up `apps/*`
- Add Turbo pipeline entries in `turbo.json` if any non-standard tasks are needed

### 4. Entry point (`src/cli.ts`)

Mirror the structure of `apps/skillspp-cli/src/cli.ts`:

- Create Commander program named `skillspp-plugins`
- Register `--version`, `--help` flags
- Register (initially empty) `add`, `remove`, `update` commands
- Wire telemetry emitter and `createCliCommandContext`
- Handle `commander.helpDisplayed` and prompt-cancel errors

### 5. `src/command-builder.ts`

Copy the `CliCommandContext` / `wrapAction` pattern from `apps/skillspp-cli`. The context should accept a `TelemetryEmitter` from `@skillspp/core/telemetry`.

### 6. Boundary check

Run `scripts/check-boundaries.sh` to verify no app-to-app imports exist.

---

## Test Plan

| Test type | What to verify |
|-----------|---------------|
| Unit | `cli.ts` correctly registers all three subcommands |
| Unit | `command-builder.ts` `wrapAction` forwards errors and calls telemetry emitter |
| Integration | `skillspp-plugins --help` exits 0 and prints subcommand list |
| Integration | `skillspp-plugins --version` prints package version |
| E2E | Binary resolves and returns help output in a clean temp directory |

---

## Acceptance Criteria

- [ ] `pnpm --filter skillspp-plugins run build` succeeds
- [ ] `pnpm --filter skillspp-plugins run typecheck` succeeds with zero errors
- [ ] `pnpm --filter skillspp-plugins run lint` passes
- [ ] `pnpm --filter skillspp-plugins run test:unit` passes
- [ ] `scripts/check-boundaries.sh` passes
- [ ] `skillspp-plugins --help` lists `add`, `remove`, `update`
- [ ] `skillspp-plugins --version` prints version
- [ ] No business logic in `apps/` — all delegated to `packages/core` or `packages/platform-node`

---

## Labels

`enhancement`, `plugins-cli`
