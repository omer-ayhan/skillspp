<h1 align="center">Skills++</h1>

<p align="center">A Skills CLI you always wanted</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-blue?style=flat-square" />
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-10.18.3-orange?style=flat-square" />
  <img alt="Turbo" src="https://img.shields.io/badge/Turbo-monorepo-black?style=flat-square" />
</p>

---

### Installation

```bash
# Clone
git clone https://github.com/omer-ayhan/skillspp.git
cd skillspp

# Install dependencies
corepack enable
corepack pnpm install
```

### Quick Start

```bash
# Show CLI help
corepack pnpm run skillspp -- --help

# Example: validate a local source
corepack pnpm run skillspp -- validate ./path/to/source

# Run all CI-focused checks
corepack pnpm run test:ci
```

### Commands

The CLI is exposed as `skillspp`.

| Command                 | Alias | Summary                                                                | Common Options                                                                        |
| ----------------------- | ----- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `add <source>`          | -     | Install skills from a local path, git source, or registry-like source. | `--skill`, `--agent`, `--list`, `--global`, `--symlink`, `--all`, `--lock-format`     |
| `find <source> [query]` | -     | Discover skills available in a source and optionally filter by query.  | `--allow-host`, `--deny-host`, `--max-download-bytes`                                 |
| `list`                  | `ls`  | List installed skills (project or global scope).                       | `--agent`, `--global`, `--non-interactive`                                            |
| `remove`                | `rm`  | Uninstall selected skills from selected agents.                        | `--skill`, `--agent`, `--all`, `--global`, `--non-interactive`                        |
| `check`                 | -     | Detect drift between installed skills and tracked lockfile state.      | `--skill`, `--global`, `--policy-mode`                                                |
| `update [skill]`        | -     | Update drifted skills and optionally migrate a skill to a new source.  | `--skill`, `--migrate`, `--dry-run`, `--global`, `--lock-format`, `--non-interactive` |
| `validate [source]`     | -     | Validate skill source structure, references, and policy constraints.   | `--ci`, `--root`, `--strict`, `--json`, `--max-lines`, `--policy-mode`                |
| `init [name]`           | -     | Scaffold a new `SKILL.md` and installer config template.               | `--agent`, `--yaml`, `--non-interactive`                                              |

### Flags Reference

Flags are listed once here (not per command) to avoid repetition.

| Flag                      | Value         | What it does                                                               | Appears in                                   |
| ------------------------- | ------------- | -------------------------------------------------------------------------- | -------------------------------------------- |
| `-a, --agent`             | `<agents...>` | Target or filter one or more agents.                                       | `add`, `list`, `remove`, `init`              |
| `-s, --skill`             | `<skills...>` | Target one or more skill names.                                            | `add`, `check`, `remove`, `update`           |
| `-l, --list`              | none          | Preview skills from a source without installing.                           | `add`                                        |
| `-g, --global`            | none          | Use global install scope instead of project scope.                         | `add`, `list`, `remove`, `check`, `update`   |
| `--all`                   | none          | Select all skills/agents relevant to the command.                          | `add`, `remove`                              |
| `--non-interactive`       | none          | Disable interactive prompts.                                               | `add`, `list`, `remove`, `update`, `init`    |
| `--symlink`               | none          | Install by creating symlinks instead of copying files.                     | `add`                                        |
| `--yaml`                  | none          | Use YAML installer scaffold format when creating missing installer config. | `add`, `init`                                |
| `--trust-well-known`      | none          | Allow hook commands for well-known sources.                                | `add`, `update`                              |
| `--allow-host`            | `<hosts...>`  | Allowlist specific hosts for remote source resolution.                     | `add`, `find`, `check`, `update`, `validate` |
| `--deny-host`             | `<hosts...>`  | Block specific hosts for remote source resolution.                         | `add`, `find`, `check`, `update`, `validate` |
| `--max-download-bytes`    | `<n>`         | Cap remote download budget in bytes.                                       | `add`, `find`, `check`, `update`, `validate` |
| `--policy-mode`           | `<mode>`      | Set policy behavior (`enforce` or `warn`).                                 | `add`, `check`, `update`, `validate`         |
| `--lock-format`           | `<format>`    | Choose lockfile output format (`json` or `yaml`).                          | `add`, `update`                              |
| `--migrate`               | `<source>`    | Migrate one selected skill to a new source.                                | `update`                                     |
| `--dry-run`               | none          | Show planned updates without applying changes.                             | `update`                                     |
| `--ci`                    | none          | Enable CI validation mode.                                                 | `validate`                                   |
| `--root`                  | `<paths...>`  | Provide root paths used in CI validation mode.                             | `validate`                                   |
| `--strict`                | none          | Treat warnings as errors.                                                  | `validate`                                   |
| `--json`                  | none          | Emit machine-readable JSON output.                                         | `validate`                                   |
| `--max-lines`             | `<n>`         | Set SKILL.md line-count threshold.                                         | `validate`                                   |
| `--max-description-chars` | `<n>`         | Set skill description length threshold.                                    | `validate`                                   |
| `--telemetry`             | `<sink>`      | Emit lifecycle telemetry events.                                           | global CLI                                   |
| `--experimental`          | none          | Enable experimental features.                                              | global CLI                                   |

### Repository Layout

Skills++ is a pnpm workspace + Turbo monorepo.

- `apps/skillspp-cli`: User-facing CLI transport and command wiring.
- `apps/skillspp-mcp`: MCP stdio server and request handler.
- `packages/core`: Domain contracts and business logic.
- `packages/platform-node`: Node adapter layer for core ports.
- `packages/test-kit`: Shared test utilities.

For a full structure guide, see [docs/structure.md](./docs/structure.md).

### Apps

#### CLI App

Location: `apps/skillspp-cli`

- Entry: `src/cli.ts`
- Registered commands: `add`, `find`, `list`, `init`, `remove`, `check`, `update`, `validate`
- Supports telemetry sink and experimental mode flags.

Run directly:

```bash
corepack pnpm --filter @skillspp/skillspp-cli skillspp --help
```

#### MCP App

Location: `apps/skillspp-mcp`

- Entry: `src/index.ts`
- Request routing: `src/request-handler.ts`
- Exposes MCP tools over stdio.

Run directly:

```bash
corepack pnpm --filter @skillspp/skillspp-mcp exec tsx src/index.ts
```

### Development

Run from repository root:

```bash
corepack pnpm run build
corepack pnpm run typecheck
corepack pnpm run lint
```

### Testing

The root scripts run boundary checks plus package/app test tasks:

```bash
corepack pnpm run test:unit
corepack pnpm run test:integration
corepack pnpm run test:contract
corepack pnpm run test:e2e
corepack pnpm run test:ci
```

Package-scoped example:

```bash
corepack pnpm --filter @skillspp/skillspp-cli run test:unit
```

### Boundaries

Import and export boundaries are enforced with:

```bash
bash ./scripts/check-boundaries.sh
```

Guiding rules:

- Apps must not import from other apps.
- Packages must not import from apps.
- Keep business logic in `packages/core`; keep transport in `apps/*`.

### Documentation

- Project map: [docs/structure.md](./docs/structure.md)
- Agent/coding workflow context: [docs/agent-context.md](./docs/agent-context.md)
- Agent navigation pointer: [AGENTS.md](./AGENTS.md)

### Contributing

Keep changes focused, run relevant checks, and respect workspace boundaries.

Suggested pre-PR command set:

```bash
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run test:unit
```

### FAQ

#### Is this a single package or a monorepo?

It is a monorepo managed by pnpm workspaces and Turbo.

#### Where should new business logic go?

Place domain logic in `packages/core` and keep app folders focused on transport and UX.

#### How do I run the CLI quickly during development?

Use:

```bash
corepack pnpm run skillspp -- --help
```
