<h1 align="center">Skills++</h1>

<p align="center">A package-manager-style CLI for managing AI agent skill files — add external Markdown dependencies, run pre/post-install hooks, and install skills globally or per-project through an easy TUI.</p>

<p align="center">
  <a href="https://npmjs.org/package/skillspp">
    <img alt="NPM version" src="https://img.shields.io/npm/v/skillspp.svg?style=flat-square" />
  </a>
  <a href="https://github.com/omer-ayhan/skillspp/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/npm/l/skillspp.svg?style=flat-square" />
  </a>
  <a href="https://www.npmjs.com/package/skillspp">
    <img alt="Node Version" src="https://img.shields.io/node/v/skillspp.svg" />
  </a>
  <a href="https://www.npmjs.com/package/skillspp">
    <img alt="NPM version" src="https://img.shields.io/npm/v/skillspp.svg" />
  </a>
  <a href="https://bun.sh">
    <img alt="Bun compatible" src="https://img.shields.io/badge/bun-%3E%3D1.0.0-black?logo=bun" />
  </a>
</p>

---

### What is Skills++?

Most skills CLI tools are either too basic or missing key fundamentals. Skills++ is a CLI that works like a package manager — but for AI agent skill files. Instead of cramming everything into a single skills folder, you declare external Markdown files as dependencies and let Skills++ handle the rest.

With Skills++ you can:

- **Declare external Markdown files as dependencies** — add remote or local `.md` skill files to your `skillspp` config and the CLI fetches and installs them for you.
- **Run hooks before and after installation** — execute setup or cleanup commands at any point in the install lifecycle.
- **Use an intuitive TUI** — navigate, select, and manage your skills without memorising every flag.
- **Install skills globally or per-project** — choose the right scope for every skill, just like any modern package manager.

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

### CLI Documentation

For full CLI command and flag details, see:

- [apps/skillspp-cli/README.md](./apps/skillspp-cli/README.md)

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
- Detailed command docs: [apps/skillspp-cli/README.md](./apps/skillspp-cli/README.md)

Run directly:

```bash
corepack pnpm --filter skillspp skillspp --help
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
corepack pnpm --filter skillspp run test:unit
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

#### What is Skills++ for?

Skills++ is a package-manager-style CLI for AI agent skill files. It lets you declare external Markdown files as dependencies, run pre/post-install hooks, and manage your skills with an interactive TUI — either globally or scoped to a single project.

#### Is this a single package or a monorepo?

It is a monorepo managed by pnpm workspaces and Turbo.

#### Where should new business logic go?

Place domain logic in `packages/core` and keep app folders focused on transport and UX.

#### How do I run the CLI quickly during development?

Use:

```bash
corepack pnpm run skillspp -- --help
```
