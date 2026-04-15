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
ci(release): publish CLI through semantic-release automation
```

## Pull Request Checklist

- PR title follows Conventional Commits.
- Changes are focused and minimal.
- Validation commands pass locally.
- Tests are added/updated when behavior changes.
- Documentation is updated when needed.

## Branch and Release Flow

Use this branch strategy:

- Open working branches using one of these prefixes:
  - `feature/*` or `feat/*` for new features (for example, `feature/add-login-page`, `feat/add-login-page`).
  - `bugfix/*` or `fix/*` for bug fixes (for example, `bugfix/fix-header-bug`, `fix/header-bug`).
  - `hotfix/*` for urgent fixes (for example, `hotfix/security-patch`).
  - `chore/*` for maintenance/non-feature work (for example, dependency or docs updates).
- Target `development` for regular work.
- Promote to `main` through a dedicated PR from `development`.

CI expectations:

- PRs to `development` and `main` run required checks: `CI`, `PR Title`, and `Commitlint`.
- PRs to `main` must come from `development` to keep promotion as the deployment gate.

## Releases

Release management uses semantic-release and GitHub Actions:

- Merge `development` into `main` via promotion PR.
- On merge to `main`, the release workflow runs semantic-release.
- semantic-release publishes `skillspp` to npm and creates tag/GitHub release metadata from `main` without committing changelog/version files back to the branch.
- npm publishing uses npm trusted publishing from GitHub Actions, so `NPM_TOKEN` is not required for releases.
- The npm trusted publisher must match this repository (`omer-ayhan/skillspp`) and the workflow filename (`release.yml`) exactly.
