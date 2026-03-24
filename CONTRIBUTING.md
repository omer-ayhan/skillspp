# Contributing to Skills++

Thanks for contributing to Skills++.

## Prerequisites

- Node.js 20+
- Corepack enabled (`corepack enable`)
- pnpm 10.18.3 (provided via `packageManager`)

## Local Setup

```bash
git clone https://github.com/omer-ayhan/skillspp.git
cd skillspp
corepack pnpm install --frozen-lockfile
```

## Development Commands

Run from repository root:

```bash
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run test:unit
corepack pnpm run build
```

Optional broader suites when your change touches those areas:

```bash
corepack pnpm run test:integration
corepack pnpm run test:contract
corepack pnpm run test:e2e
corepack pnpm run test:ci
```

## Architecture and Boundaries

- Keep transport concerns in `apps/*`.
- Keep shared business logic in `packages/core`.
- Packages must not import from apps.
- Apps must not import from other apps.
- Boundary checks are enforced by `scripts/check-boundaries.sh` and run as part of lint/test scripts.

## Commit and PR Conventions

Use Conventional Commits:

```text
type(scope)!: subject
```

Local commits are checked by Husky + Commitlint through `.husky/commit-msg`.
If hooks are missing after clone, run:

```bash
corepack pnpm run prepare
```

Allowed types:

- `feat`
- `fix`
- `docs`
- `style`
- `refactor`
- `perf`
- `test`
- `build`
- `ci`
- `chore`
- `revert`

Recommended scopes:

- `cli`
- `mcp`
- `core`
- `platform-node`
- `test-kit`
- `repo`
- `release`
- `docs`

Examples:

```text
feat(cli): add source host allowlist flag
fix(core): preserve lockfile ordering in update flow
ci(release): publish CLI through changesets action
```

## Pull Request Checklist

- PR title follows Conventional Commits.
- Changes are focused and minimal.
- Validation commands pass locally.
- Tests are added/updated when behavior changes.
- Documentation is updated when needed.

## Releases

Release management uses Changesets and GitHub Actions:

- Add a changeset for user-facing changes.
- Versioning is handled by `corepack pnpm run version-packages`.
- Publishing is handled by `corepack pnpm run release`.
- The release workflow requires `NPM_TOKEN` in repository secrets.
