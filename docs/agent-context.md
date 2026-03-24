# Agent Context Reference

This document is a quick operational reference for AI coding agents working in this repository.
Use docs/structure.md for the complete map of where code lives.

## Mission Profile

- Repo type: pnpm + Turbo TypeScript monorepo.
- Primary products:
  - skillspp CLI app (apps/skillspp-cli)
  - skillspp MCP server app (apps/skillspp-mcp)
- Shared logic: packages/core.
- Node adapter implementation: packages/platform-node.

## Architectural Boundaries

- apps must not import from other apps.
- packages must not import from apps.
- apps should not use broad @skillspp/core root barrel imports.
- avoid deep cross-workspace private src imports.
- core exports and platform-node exports are intentionally constrained.

Enforced by:

- scripts/check-boundaries.sh

## Important Entrypoints

- CLI entry: apps/skillspp-cli/src/cli.ts
- MCP entry: apps/skillspp-mcp/src/index.ts
- MCP request routing: apps/skillspp-mcp/src/request-handler.ts
- Node core service composition: packages/platform-node/src/index.ts
- Core service wrappers: packages/core/src/application/services.ts
- Core ports: packages/core/src/interfaces/ports.ts

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
- Update tests when behavior changes.
- If touching import/export surfaces, run boundary checks and typecheck.

## Known Implementation Notes

- platform-node currently has full validate path and partial command-port coverage for other operations.
- skillspp-mcp currently exposes validation-oriented tooling via request-handler.

## Read Before Large Changes

1. docs/structure.md
2. scripts/check-boundaries.sh
3. package.json (root scripts)
4. target package/app package.json and tsconfig.json
