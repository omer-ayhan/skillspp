# skillspp CLI

`skillspp` is the published command-line distribution for the Skills++ project.

## Installation

Install from npm:

```bash
npm install -g skillspp
```

## Usage

```bash
skillspp --help
skillspp validate ./path/to/source
```

## Commands

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

## Flags Reference

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

## Development

Run from repository root:

```bash
corepack pnpm run skillspp -- --help
```

Or run from workspace directly:

```bash
corepack pnpm --filter skillspp skillspp --help
```

## Repository

Source lives in:

- https://github.com/omer-ayhan/skillspp
