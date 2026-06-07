# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the
`duckpond-mcp-server` package.

> **Monorepo package.** This lives at `packages/duckpond-mcp-server/` in the
> [duckpond monorepo](https://github.com/jordanburke/duckpond) (pnpm + Turborepo).
> It depends on the `duckpond` library via **`workspace:^`** (symlinked from
> `packages/duckpond/`; Turbo builds the library before this package). Run commands
> from this package directory, or from the repo root with
> `pnpm --filter duckpond-mcp-server <script>`. See the root `CLAUDE.md` for
> monorepo-wide workflow and the lockstep release process.

## Project Overview

An **MCP (Model Context Protocol) server** that exposes DuckPond's multi-tenant DuckDB
capabilities to AI agents. Agents can manage per-user databases, run SQL, and use
R2/S3 cloud (or local) persistence through standard MCP tools.

- **Transports**: stdio (Claude Desktop) and HTTP (FastMCP, served via Hono).
- **Auth (HTTP)**: OAuth 2.0 (PKCE, JWT), Basic Auth.
- **DuckDB UI**: optional built-in web UI for inspecting a user's database.
- **MCP tools**: `query`, `execute`, `getUserStats`, `isAttached`, `detachUser`.

End-user documentation (install, env vars, endpoints) is in `README.md`. This file is
for working **on** the code. The original design notes are in `docs/PLAN_MCP_SERVER.md`.

### Key Technologies

- **duckpond** (`workspace:^`): the underlying multi-tenant DuckDB library
- **fastmcp** (4.0.2): MCP server framework (HTTP transport)
- **hono** + **@hono/node-server**: HTTP layer (DuckDB UI server, OAuth endpoints)
- **commander**: CLI argument parsing (`src/index.ts`)
- **jsonwebtoken** + **zod**: JWT auth and tool-schema validation
- **TypeScript** (^6.0.3), **Node.js** (24, root `.nvmrc`)
- **ts-builds** (^3.0.1): shared format/lint/typecheck/test/build chain
- **tsdown**: bundler (ESM + type declarations → `dist/`)
- **Vitest**: test runner; **pnpm** (11.5.2) workspace orchestrated by **Turborepo**

## Relationship to the `duckpond` library

`src/server-core.ts` is a thin wrapper over the `duckpond` library. The library returns
`Either<DuckPondError, T>` (functype); the server converts those into an `MCPResult<T>`
discriminated union (`{ success: true, data } | { success: false, error }`) for the MCP
tool layer. Because the dependency is `workspace:^`, edits to `packages/duckpond/` are
picked up immediately (no publish/reinstall) — but the library must be built first, which
Turbo's `^build`/`^validate` ordering handles.

For functype patterns (working with `Either`, `Option`, etc.), use the **functype** skill.

## Development Commands

```bash
pnpm validate       # full chain: format → lint → typecheck → test → build (pre-checkin)
pnpm format         # Prettier write   /  pnpm format:check
pnpm lint           # ESLint fix       /  pnpm lint:check
pnpm typecheck      # tsc type check
pnpm test           # Vitest once      /  pnpm test:watch  /  pnpm test:coverage
pnpm build          # tsdown production build → dist/
pnpm dev            # tsdown watch build
pnpm serve:test     # run the server over stdio (tsx src/index.ts)
pnpm serve:test:http # run the server over HTTP (tsx src/index.ts --transport http)
```

Per-checkin: `pnpm validate`. `prepublishOnly` runs it automatically.

## Architecture / Key Files

- **`src/index.ts`** — CLI entry point (commander); selects stdio vs HTTP transport,
  parses `--ui`/`--port` flags; Web Crypto polyfill. This is the published `bin`.
- **`src/server-core.ts`** — `DuckPondServer`: wraps the `duckpond` library and maps its
  `Either` results to `MCPResult<T>`.
- **`src/server.ts`** — FastMCP-based HTTP server: MCP-over-HTTP, OAuth 2.0 / JWT / Basic
  auth, endpoints.
- **`src/ui-server.ts`** — Hono server bridging to the built-in DuckDB UI (port 4213).
- **`src/tools/index.ts`** — MCP tool schemas (zod) and implementations; `getDefaultUserId()`.
- **`src/lib.ts`** — library exports (`startServer`, `beforeStart` hook) for _extending_
  the server; published as the `duckpond-mcp-server/lib` subpath export.
- **`src/utils/logger.ts`** — `debug`-based loggers (`duckpond:*` namespaces).

### Build & packaging

- **tsdown** (config re-exports `ts-builds/tsdown`) builds `src/` → `dist/` (ESM + `.d.ts`).
  There is **no `tsup`** and no `lib/` output despite the `tsconfig` `outDir` — the bin and
  `exports` resolve to `dist/`.
- Two published entry points: `.` → `dist/index.js` (the CLI/bin) and `./lib` →
  `dist/lib.js` (the extension API).
- Docker: `Dockerfile`/`docker-compose.yml`/`.mcp.json` are present but **not** wired into
  CI (auto-build deferred at the monorepo level).

## Testing

- Vitest via `ts-builds test`. Tests live in `test/` (e.g. `test/server-core.test.ts`),
  which imports `DuckPondServer` and initializes a real in-memory DuckPond.
- Because the test imports the `duckpond` workspace package, the library must be built
  first — handled by Turbo (`validate` depends on `^validate`, so the library's `dist/`
  is stable before this package's tests run; this avoids a cold-cache resolution race).

## CI / Publishing

- CI is centralized at the **monorepo root** (`.github/workflows/ci.yml` runs
  `turbo run validate`). This package has no per-package workflows.
- **Publishing is lockstep** with the `duckpond` library — both release at the same
  version. Do **not** bump or publish this package alone. From the repo root:
  `pnpm release patch|minor|major` then `git push --follow-tags`. The server publishes
  with `NPM_TOKEN`. See the root `CLAUDE.md`.

## Conventions

- TypeScript strict (via `ts-builds/tsconfig`); ESLint 10.x flat config + Prettier +
  simple-import-sort (`ts-builds/eslint-functype`).
- Prefer functional error handling — the library hands you `Either`; convert at the
  `server-core` boundary, don't leak exceptions into the MCP tool layer.
