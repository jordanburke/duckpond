# CLAUDE.md

Guidance for Claude Code when working in the DuckPond **monorepo**.

## What this is

A pnpm + Turborepo monorepo with two published packages:

- `packages/duckpond` — the DuckDB manager library (npm: `duckpond`)
- `packages/duckpond-mcp-server` — the MCP server (npm: `duckpond-mcp-server`)

The server depends on the library via `workspace:^` (symlinked locally; rewritten to
a real range on publish). Tooling: pnpm 11.5.2, Turborepo, Node 24 (`.nvmrc`),
TypeScript 6.0.3, ts-builds 3.x, tsdown, vitest.

## Commands (run from the repo root)

```bash
pnpm install                    # install + link workspace
pnpm validate                   # turbo run validate (all packages)
pnpm build                      # turbo run build (library before server via ^build)
pnpm --filter duckpond test     # one package's tests
pnpm --filter duckpond-mcp-server <script>
```

Each package keeps its own `ts-builds` scripts; Turbo only orchestrates and caches.
`turbo.json` sets `dependsOn: ["^build"]` on build/test/typecheck/validate so the
library is always built before the server consumes it.

## Releasing

```bash
pnpm release patch|minor|major      # bumps BOTH packages in lockstep, validates,
                                    # runs check-publish-safety, commits + tags
git push --follow-tags              # triggers publish.yml
```

- The two packages **must** stay on the same version (`check-publish-safety` enforces
  this). Always bump via `pnpm release`, never edit one package's version alone.
- Major bumps require `ALLOW_MAJOR` (see `scripts/check-publish-safety.ts`).
- `duckpond` publishes via npm OIDC trusted publishing; `duckpond-mcp-server` via
  `NPM_TOKEN`. Node 24 is required for the OIDC handshake (npm 11+).

## Package-specific guidance

Read `packages/duckpond/CLAUDE.md` and `packages/duckpond-mcp-server/CLAUDE.md` for
per-package architecture, functype patterns, and gotchas.

## Deferred

- The MCP server's `Dockerfile`/`docker-compose.yml` are present but **not** wired
  into CI (`docker-build.yml` was intentionally not ported).
- The standalone `github.com/jordanburke/duckpond-mcp-server` repo is not yet
  archived.
