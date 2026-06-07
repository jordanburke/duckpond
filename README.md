# DuckPond Monorepo

pnpm + Turborepo monorepo for the DuckPond multi-tenant DuckDB toolkit.

## Packages

| Package | Path | npm | Description |
|---|---|---|---|
| `duckpond` | [`packages/duckpond`](packages/duckpond) | [`duckpond`](https://www.npmjs.com/package/duckpond) | Multi-tenant DuckDB manager with R2/S3 storage and functional-programming patterns |
| `duckpond-mcp-server` | [`packages/duckpond-mcp-server`](packages/duckpond-mcp-server) | [`duckpond-mcp-server`](https://www.npmjs.com/package/duckpond-mcp-server) | MCP server exposing DuckPond over the Model Context Protocol |

The server depends on the library via `workspace:^`, so changes to `duckpond` are
picked up immediately without publishing.

## Quick start

```bash
pnpm install          # Node 24 (see .nvmrc), pnpm 11.5.2
pnpm validate         # turbo run validate across all packages
pnpm build            # build all packages (library first)
pnpm dev              # watch mode
```

Per-package commands use pnpm filters:

```bash
pnpm --filter duckpond test
pnpm --filter duckpond-mcp-server build
```

## Releasing

Both packages version in lockstep on a single `v*` tag:

```bash
pnpm release patch    # or minor | major (major needs ALLOW_MAJOR)
git push --follow-tags
```

This bumps both `package.json` versions, validates, runs `check-publish-safety`,
commits `release: vX.Y.Z`, and tags. The tag push triggers
`.github/workflows/publish.yml`, which re-validates and runs `pnpm -r publish`.

## Layout

```
packages/
  duckpond/             library
  duckpond-mcp-server/  MCP server (Docker files present; auto-build deferred)
scripts/
  release.ts            lockstep version bump + tag
  check-publish-safety.ts  pre-publish gate
```

See each package's own `README.md` and `CLAUDE.md` for package-specific detail.
