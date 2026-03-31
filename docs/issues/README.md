# Plugins CLI — GitHub Issue Drafts

This directory contains ready-to-paste drafts for the four GitHub issues needed to track the **Plugins CLI** feature. The issues are written to be created in order (each depends on the previous), but the `add`, `remove`, and `update` command issues can be implemented in parallel once the setup issue is complete.

## Issues to Create

Create these four issues in the GitHub repository in the order listed below:

| # | File | Issue Title | Depends on |
|---|------|-------------|-----------|
| 1 | [plugins-cli-setup.md](./plugins-cli-setup.md) | `[Plugins CLI] App Setup` | — |
| 2 | [plugins-cli-add-command.md](./plugins-cli-add-command.md) | `[Plugins CLI] add Command Implementation` | #1 |
| 3 | [plugins-cli-remove-command.md](./plugins-cli-remove-command.md) | `[Plugins CLI] remove Command Implementation` | #1, #2 |
| 4 | [plugins-cli-update-command.md](./plugins-cli-update-command.md) | `[Plugins CLI] update Command Implementation` | #1, #2 |

## How to Create the Issues

### Via GitHub Web UI

1. Go to https://github.com/omer-ayhan/skillspp/issues/new
2. Paste the **title** and **body** from each issue file
3. Add the labels: `enhancement`, `plugins-cli`
4. Optionally create and assign a milestone for the feature

### Via GitHub CLI

```bash
# Create the setup issue
gh issue create \
  --title "[Plugins CLI] App Setup" \
  --body-file docs/issues/plugins-cli-setup.md \
  --label "enhancement,plugins-cli"

# Create the add command issue
gh issue create \
  --title "[Plugins CLI] add Command Implementation" \
  --body-file docs/issues/plugins-cli-add-command.md \
  --label "enhancement,plugins-cli"

# Create the remove command issue
gh issue create \
  --title "[Plugins CLI] remove Command Implementation" \
  --body-file docs/issues/plugins-cli-remove-command.md \
  --label "enhancement,plugins-cli"

# Create the update command issue
gh issue create \
  --title "[Plugins CLI] update Command Implementation" \
  --body-file docs/issues/plugins-cli-update-command.md \
  --label "enhancement,plugins-cli"
```

## Architecture Summary

The Plugins CLI follows the same monorepo transport-layer pattern as `apps/skillspp-cli`:

- **Transport layer** (CLI parsing, UX, telemetry): lives in `apps/skillspp-plugins-cli`
- **Business logic** (plugin install/remove/update): lives in `packages/core`
- **Node adapter** (filesystem, process): lives in `packages/platform-node`

If `packages/core` lacks the plugin management contracts/services when implementation begins, they must be added as part of the relevant command issue before the CLI layer is built.
