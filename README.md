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

#### Is this a single package or a monorepo?

It is a monorepo managed by pnpm workspaces and Turbo.

#### Where should new business logic go?

Place domain logic in `packages/core` and keep app folders focused on transport and UX.

#### How do I run the CLI quickly during development?

Use:

```bash
corepack pnpm run skillspp -- --help
```
