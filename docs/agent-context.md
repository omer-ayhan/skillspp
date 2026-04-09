# Agent Context Reference

This document is a quick operational reference for AI coding agents working in this repository.
Use docs/structure.md for the complete map of where code lives.

## Mission Profile

- Repo type: pnpm + Turbo TypeScript monorepo.
- Primary products:
  - skillspp CLI app (apps/skillspp-cli)
  - pluginspp CLI app (apps/pluginspp-cli)
  - skillspp MCP server app (apps/skillspp-mcp)
- Shared logic: packages/core.
- Shared CLI transport/UI helpers: packages/cli-shared.
- Node adapter implementation: packages/platform-node.

## Architectural Boundaries

- apps must not import from other apps.
- packages must not import from apps.
- apps should not use broad @skillspp/core root barrel imports.
- avoid deep cross-workspace private src imports.
- core exports and platform-node exports are intentionally constrained.
- cross-CLI reuse belongs in packages/cli-shared, not app-to-app imports.

Enforced by:

- scripts/check-boundaries.sh

## Important Entrypoints

- CLI entry: apps/skillspp-cli/src/cli.ts
- Plugins CLI entry: apps/pluginspp-cli/src/cli.ts
- Plugins add flow: apps/pluginspp-cli/src/commands/add.ts
- Plugins update flow: apps/pluginspp-cli/src/commands/update.ts
- Shared CLI runner/UI primitives: packages/cli-shared/src/\*
- MCP entry: apps/skillspp-mcp/src/index.ts
- MCP request routing: apps/skillspp-mcp/src/request-handler.ts
- Node core service composition: packages/platform-node/src/index.ts
- Core service wrappers: packages/core/src/application/services.ts
- Core ports: packages/core/src/interfaces/ports.ts
- Core background task execution: packages/core/src/runtime/background-tasks.ts

## Test And Validation Commands

Run from repo root:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run test:contract
pnpm run test:e2e
pnpm run test:ci
```

Package-scoped example:

```bash
pnpm --filter skillspp run test:unit
```

## Editing Guidelines For Agents

- Prefer minimal diffs and preserve existing style.
- Do not reformat unrelated files.
- Keep transport concerns in apps and business rules in packages/core.
- Keep duplicated CLI-only helpers out of apps; extract them to packages/cli-shared.
- Update tests when behavior changes.
- If touching import/export surfaces, run boundary checks and typecheck.
- `pluginspp-cli` must not import transport/UI/runtime files from `skillspp-cli`; reuse `packages/cli-shared` instead.

## Known Implementation Notes

- platform-node currently has full validate path and partial command-port coverage for other operations.
- skillspp-mcp currently exposes validation-oriented tooling via request-handler.
- `pluginspp` reuses shared CLI transport primitives from `packages/cli-shared`.
- `pluginspp add/remove/update` operate on agent plugin cache directories and plugin lock/state artifacts, not skill directories.

## Read Before Large Changes

1. docs/structure.md
2. scripts/check-boundaries.sh
3. package.json (root scripts)
4. target package/app package.json and tsconfig.json
