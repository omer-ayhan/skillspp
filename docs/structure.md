# Repository Structure

This document explains where things live in the Skills++ monorepo.
Companion doc: see docs/agent-context.md for coding-agent focused guidance.

## Root

```text
.
├── apps/
│   ├── skillspp-cli/
│   └── skillspp-mcp/
├── assets/
├── packages/
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
│   ├── command-builder.ts
│   ├── commands/
│   │   ├── add.ts
│   │   ├── check.ts
│   │   ├── find.ts
│   │   ├── init.ts
│   │   ├── list.ts
│   │   ├── remove.ts
│   │   ├── update.ts
│   │   └── validate.ts
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
   - Command actions are wrapped via command-builder context for telemetry.
   - Runtime calls route into @skillspp/platform-node services, which delegate to @skillspp/core contracts/services.

2. MCP path:
   - apps/skillspp-mcp/src/index.ts reads stdio JSON-RPC messages.
   - apps/skillspp-mcp/src/request-handler.ts handles tools/list and tools/call.
   - Calls delegate to platform-node services backed by core contracts.

## Path Aliases

Configured primarily in:

- apps/skillspp-cli/tsconfig.json
- packages/platform-node/tsconfig.json

Common aliases:

- @skillspp/core
- @skillspp/core/\* subpaths (contracts, sources, runtime, and specific modules)
- @skillspp/platform-node

## Conventions

- Keep apps as transport layers; business logic belongs in packages/core.
- Prefer explicit @skillspp/core subpath imports in apps.
- Run scripts/check-boundaries.sh before lint/test-sensitive changes.
- Keep package public APIs aligned with package.json exports.
- Keep generated artifacts in dist/, not in src/.
