# Repository Structure

This document explains where things live in the Skills++ monorepo.
Companion doc: see docs/agent-context.md for coding-agent focused guidance.

## Root

```text
.
├── apps/
│   ├── skillspp-cli/
│   ├── pluginspp-cli/
│   └── skillspp-mcp/
├── assets/
├── packages/
│   ├── cli-shared/
│   ├── core/
│   ├── platform-node/
│   └── test-kit/
├── scripts/
├── skills/
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
└── tsconfig.json
```

## Tooling And Build Control

- package.json: root scripts for build, lint, typecheck, and test orchestration.
- pnpm-workspace.yaml: workspace package boundaries (apps/_, packages/_).
- turbo.json: task graph for build, typecheck, lint, and test suites.
- tsconfig.base.json: shared TypeScript defaults.
- tsconfig.json: project references for all apps and packages.
- eslint.config.mjs: shared lint setup.
- vitest.config.base.ts: base test settings.
- scripts/check-boundaries.sh: import and export surface boundary enforcement.

## Apps

### apps/skillspp-cli

```text
apps/skillspp-cli/
├── src/
│   ├── cli.ts
│   ├── commands/
│   │   ├── add.ts
│   │   ├── check.ts
│   │   ├── find.ts
│   │   ├── init.ts
│   │   ├── list.ts
│   │   ├── remove.ts
│   │   ├── update.ts
│   │   └── validate.ts
│   ├── telemetry.ts
│   ├── runtime/
│   ├── ui/
│   └── ...
└── tests/
    ├── e2e/
    ├── fixtures/
    └── integration/
```

Purpose:

- User-facing CLI transport layer.
- Command parsing, interactive UX, telemetry forwarding, and command wiring.
- Reuses shared transport/UI primitives from `packages/cli-shared`.

Entry:

- src/cli.ts

### apps/pluginspp-cli

```text
apps/pluginspp-cli/
├── assets/
│   └── ascii/
│       └── logo/
├── src/
│   ├── cli.ts
│   ├── command-builder.ts
│   ├── interactive.ts
│   ├── policy-mode.ts
│   ├── commands/
│   │   ├── add.ts
│   │   ├── remove.ts
│   │   └── update.ts
│   ├── runtime/
│   │   ├── background-executor.ts
│   │   ├── background-runner.ts
│   │   └── background-task-types.ts
│   └── ui/
│       ├── screens.tsx
│       ├── selection-step.tsx
│       └── ...
└── tests/
    ├── e2e/
    ├── integration/
    └── unit/
```

Purpose:

- User-facing CLI for plugin installation and lifecycle workflows.
- Reuses shared transport/UI primitives from `packages/cli-shared`.
- Routes plugin lifecycle flows to agent plugin cache directories instead of skill directories.

Entry:

- src/cli.ts

### apps/pluginspp-cli

```text
apps/pluginspp-cli/
├── assets/
│   └── ascii/
│       └── logo/
├── src/
│   ├── cli.ts
│   ├── command-builder.ts
│   ├── interactive.ts
│   ├── policy-mode.ts
│   ├── commands/
│   │   ├── add.ts
│   │   ├── remove.ts
│   │   └── update.ts
│   ├── runtime/
│   │   ├── background-executor.ts
│   │   ├── background-runner.ts
│   │   └── background-task-types.ts
│   └── ui/
│       ├── screens.tsx
│       ├── selection-step.tsx
│       └── ...
└── tests/
    ├── e2e/
    ├── integration/
    └── unit/
```

Purpose:

- User-facing CLI for plugin installation and lifecycle workflows.
- Mirrors the `skillspp add` transport/UI flow while routing installs to agent plugin cache directories.

Entry:

- src/cli.ts

### apps/skillspp-mcp

```text
apps/skillspp-mcp/
├── src/
│   ├── index.ts
│   ├── request-handler.ts
│   └── ...
└── tests/
```

Purpose:

- MCP transport over stdio.
- JSON-RPC request handling and tool exposure.

Entry:

- src/index.ts

## Packages

### packages/cli-shared

```text
packages/cli-shared/
├── src/
│   ├── command-builder.ts
│   ├── interactive.ts
│   ├── runtime/
│   │   └── background-runner.ts
│   └── ui/
│       ├── colors.ts
│       ├── format.ts
│       ├── logo.ts
│       ├── screens.tsx
│       └── selection-step.tsx
└── tests/
```

Purpose:

- Shared CLI transport helpers used by both `skillspp-cli` and `pluginspp-cli`.
- Houses command context wrapping, interactive helpers, background-task runner adapter, and shared Ink UI primitives.

### packages/core

```text
packages/core/
├── src/
│   ├── application/
│   │   ├── services.ts
│   │   └── experimental.ts
│   ├── contracts/
│   │   ├── commands.ts
│   │   ├── results.ts
│   │   ├── runtime-types.ts
│   │   ├── source-types.ts
│   │   ├── errors/
│   │   └── events/
│   ├── interfaces/
│   │   └── ports.ts
│   ├── runtime/
│   │   ├── agents.ts
│   │   ├── installer.ts
│   │   ├── lockfile.ts
│   │   ├── policy.ts
│   │   ├── telemetry.ts
│   │   └── ...
│   ├── sources/
│   │   ├── source-parser.ts
│   │   ├── source-resolution.ts
│   │   ├── scanner.ts
│   │   └── skills.ts
│   └── index.ts
└── tests/
```

Purpose:

- Core contracts and business services.
- No app-level transport concerns.

### packages/platform-node

```text
packages/platform-node/
├── src/
│   ├── index.ts
│   ├── core-port.ts
│   ├── background-runner.ts
│   └── background-worker.ts
└── tests/
```

Purpose:

- Node-specific adapter layer for core ports.
- Background worker execution support.

### packages/test-kit

```text
packages/test-kit/
├── src/
└── tests/
```

Purpose:

- Shared test helpers/utilities.

## Entry And Bootstrap Flow

1. CLI path:
   - apps/skillspp-cli/src/cli.ts creates a Commander program.
   - Commands are registered from apps/skillspp-cli/src/commands/\*.
   - Command actions are wrapped via `packages/cli-shared` command-builder context for telemetry.
   - Runtime calls route into @skillspp/platform-node services, which delegate to @skillspp/core contracts/services.

2. Plugins CLI path:
   - apps/pluginspp-cli/src/cli.ts creates a Commander program.
   - Commands are registered from apps/pluginspp-cli/src/commands/\*.
   - Shared interactive/runtime helpers are consumed from `packages/cli-shared`.
   - Background work routes through apps/pluginspp-cli/src/runtime/\* into @skillspp/core runtime task handlers.

3. MCP path:
   - apps/skillspp-mcp/src/index.ts reads stdio JSON-RPC messages.
   - apps/skillspp-mcp/src/request-handler.ts handles tools/list and tools/call.
   - Calls delegate to platform-node services backed by core contracts.

## Path Aliases

Configured primarily in:

- apps/skillspp-cli/tsconfig.json
- apps/pluginspp-cli/tsconfig.json
- packages/cli-shared/tsconfig.json
- packages/platform-node/tsconfig.json

Common aliases:

- @skillspp/cli-shared
- @skillspp/cli-shared/\* subpaths
- @skillspp/core
- @skillspp/core/\* subpaths (contracts, sources, runtime, and specific modules)
- @skillspp/platform-node

## Conventions

- Keep apps as transport layers; business logic belongs in packages/core.
- Keep shared CLI transport/UI helpers in packages/cli-shared rather than copying them between apps.
- Prefer explicit @skillspp/core subpath imports in apps.
- Run scripts/check-boundaries.sh before lint/test-sensitive changes.
- Keep package public APIs aligned with package.json exports.
- Keep generated artifacts in dist/, not in src/.
