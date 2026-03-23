# AGENTS.md

This file is the root navigation guide for coding agents in this repository.
Do not treat this file as the full source of truth for structure details.
It intentionally points to shared documentation instead of duplicating project structure.

## Read First

- docs/structure.md
- docs/agent-context.md

## Repository Snapshot

- Monorepo: pnpm workspaces + Turbo.
- Main applications:
  - apps/skillspp-cli
  - apps/skillspp-mcp
- Core shared packages:
  - packages/core
  - packages/platform-node
  - packages/test-kit

## Working Agreement

- Use docs/structure.md as the source of truth for "where code lives".
- Use docs/agent-context.md for command flow, boundaries, and validation commands.
- Keep edits focused and small.
- Respect import/export boundaries enforced by scripts/check-boundaries.sh.

## Validation Checklist

Run relevant checks from repo root:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test:unit
```

Run broader suites when changes justify it:

```bash
pnpm run test:integration
pnpm run test:contract
pnpm run test:e2e
pnpm run test:ci
```

## Maintenance Rule

If folders, entrypoints, aliases, or boundaries change:

1. Update docs/structure.md.
2. Update docs/agent-context.md if operational guidance changed.
3. Keep AGENTS.md and CLAUDE.md as lightweight pointers.
