# DuckPond Monorepo Conversion — Design

**Date:** 2026-06-07
**Status:** Approved (pending spec review)
**Author:** Jordan Burke (with Claude)

## Goal

Convert the `duckpond` repository into a pnpm + Turborepo monorepo and absorb the
sibling `duckpond-mcp-server` repository as a second package. The payoff: the MCP
server consumes the library through a workspace symlink (`workspace:^`) instead of the
publish → version-bump → reinstall loop it uses today, so library and server can be
developed and validated together.

The conventions mirror the existing **functype** monorepo
(`~/IdeaProjects/functype`) so the two repos share one mental model: same `turbo.json`
shape, same `pnpm-workspace.yaml` patterns, same lockstep release tooling.

## Current state

| | `duckpond` (this repo) | `duckpond-mcp-server` (sibling) |
|---|---|---|
| npm name / version | `duckpond` @ 0.5.1 (published) | `duckpond-mcp-server` @ 0.5.1 (published) |
| Role | DuckDB manager library | MCP server (`bin`, Docker) |
| Depends on | `@duckdb/node-api`, `functype`, `lru-cache` | **`duckpond: ^0.5.1`**, fastmcp, hono, express, zod, … |
| Tooling | pnpm 10.29.3, TS 6.0.3, ts-builds 2.8.2, tsdown 0.22.2 | identical |
| Node (`.nvmrc`) | v22 | 22 |
| Publish | OIDC trusted publishing (provenance) | classic `NPM_TOKEN` |
| Git remote | github.com/jordanburke/duckpond | github.com/jordanburke/duckpond-mcp-server |

Both packages are already in lockstep at 0.5.1 with identical toolchains, which makes
the merge low-risk.

## Decisions (from brainstorming)

1. **Layout:** both packages under `packages/`; repo root becomes a private workspace
   root. This repo (`github.com/jordanburke/duckpond`) is the monorepo home.
2. **Git history:** preserve `duckpond-mcp-server`'s full history via `git subtree`
   (built-in; no `git-filter-repo` install needed).
3. **Task runner:** Turborepo + pnpm workspaces, mirroring functype.
4. **Old repo:** leave `github.com/jordanburke/duckpond-mcp-server` as-is for now
   (archiving deferred — see Out of Scope).
5. **Publishing:** mirror functype's lockstep family versioning (single `v*` tag,
   `release.ts` + `check-publish-safety.ts` + `pnpm -r publish`).
6. **Node:** bump `.nvmrc` to 24 (matches functype; required for clean npm OIDC).
7. **Docker:** deferred — files ride along but `docker-build.yml` is not wired into CI.

## Target structure

```
duckpond/                              root: "duckpond-monorepo", private: true
├─ package.json                        turbo scripts; devDeps: turbo, tsx
├─ pnpm-workspace.yaml                 packages/*, publicHoistPattern, allowBuilds
├─ turbo.json                          ported from functype
├─ .nvmrc                              24
├─ .npmrc                              (root-level, from existing)
├─ scripts/
│  ├─ release.ts                       lockstep bump + tag (ported, 2-pkg)
│  └─ check-publish-safety.ts          pre-publish gate (ported, 2-pkg)
├─ .github/workflows/
│  ├─ ci.yml                           install + turbo run validate
│  ├─ publish.yml                      v* tag → validate → safety → pnpm -r publish
│  └─ codeql.yml                       security scan (single, root)
├─ README.md                           new monorepo-level overview
├─ CLAUDE.md                           new monorepo-level guidance
├─ docs/superpowers/specs/             this design doc
└─ packages/
   ├─ duckpond/                        library — name "duckpond" @ x.y.z (published)
   │  ├─ src/  test/
   │  ├─ package.json  tsconfig.json  tsdown.config.ts  eslint.config.mjs
   │  ├─ README.md  CLAUDE.md          (moved from old root)
   │  └─ STANDARDIZATION_GUIDE.md
   └─ duckpond-mcp-server/             server — @ x.y.z (published; Docker deferred)
      ├─ src/  test/
      ├─ package.json  tsconfig.json  tsdown.config.ts  eslint.config.mjs
      ├─ Dockerfile  docker-compose.yml  .mcp.json   (present, not auto-built)
      ├─ README.md  CLAUDE.md
      └─ ts-builds.config.json
```

Per-package files (`package.json`, `tsconfig.json`, `tsdown.config.ts`,
`eslint.config.mjs`, `ts-builds`-driven scripts) stay **inside each package
unchanged** — `ts-builds` continues to run per package; Turbo only orchestrates.

## Merge procedure (history-preserving)

Executed on a `monorepo-conversion` branch off `main`.

1. **Branch:** `git checkout -b monorepo-conversion`.
2. **Move library into a package:** `git mv` `src/`, `test/`, `tsconfig.json`,
   `tsdown.config.ts`, `eslint.config.mjs`, `README.md`, `CLAUDE.md`,
   `STANDARDIZATION_GUIDE.md`, and the existing `package.json` into
   `packages/duckpond/`. Single move commit (git blame follows renames).
   - The library `package.json` keeps `name: "duckpond"`, current version, and its
     `exports`/`files`/`bin` untouched.
3. **Subtree-merge the server:**
   ```
   git remote add mcp-tmp ../duckpond-mcp-server
   git fetch mcp-tmp
   git subtree add --prefix=packages/duckpond-mcp-server mcp-tmp main
   git remote remove mcp-tmp
   ```
   Full server history is grafted under `packages/duckpond-mcp-server/`.
4. **Create root workspace files:** `package.json` (private, turbo scripts),
   `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc` (24), root `README.md` + `CLAUDE.md`.
5. **Workspace dependency:** in `packages/duckpond-mcp-server/package.json`,
   change `"duckpond": "^0.5.1"` → `"duckpond": "workspace:^"`.
6. **Single lockfile:** delete both per-package `pnpm-lock.yaml` files; run
   `pnpm install` at root to produce one root lockfile.
7. **Validate:** `pnpm validate` (→ `turbo run validate`) green for both packages.

## Workspace & Turbo configuration

**`pnpm-workspace.yaml`** (mirrors functype, scoped to our native deps):
```yaml
packages:
  - "packages/*"

publicHoistPattern:
  - "*eslint*"
  - "*prettier*"
  - "*vitest*"
  - "typescript"

# pnpm 10 blocks dependency build scripts by default. DuckDB ships a native
# addon and tsdown/vite pull esbuild — both need their build scripts to run.
allowBuilds:
  "@duckdb/node-bindings": true
  esbuild: true
```
(Exact `allowBuilds`/`onlyBuiltDependencies` key form to be confirmed against the
installed pnpm 10.29.3 during implementation — pnpm has shifted this field name
across versions.)

**`turbo.json`** — ported from functype: `build`, `test`, `typecheck`, `validate`
all `dependsOn: ["^build"]` (library builds before the server); `build` outputs
`dist/**` + `lib/**`; `test` outputs `coverage/**`; `lint`/`format` have no outputs;
`dev` is `cache: false`, `persistent: true`.

**Root `package.json` scripts:** `"build": "turbo run build"`, `"test": "turbo run
test"`, `"validate": "turbo run validate"`, `"lint"`, `"typecheck"`, `"dev"`, plus
`"release": "tsx scripts/release.ts"` and `"check-publish-safety": "tsx
scripts/check-publish-safety.ts"`. Root devDeps: `turbo`, `tsx`.

## Publishing (lockstep, ported from functype)

- **One `v*` tag releases the family.** Both packages always share a version.
- **`scripts/release.ts`** (`pnpm release patch|minor|major`):
  1. Verify clean tree, on `main`, in sync with `origin/main`.
  2. `pnpm validate`.
  3. Compute next version; write it to **both** package.jsons.
  4. `pnpm check-publish-safety`.
  5. `git commit -m "release: vX.Y.Z"`, `git tag vX.Y.Z`.
  6. Print `git push --follow-tags` instructions.
- **`scripts/check-publish-safety.ts`** — adapted to one fixed group
  (`duckpond` + `duckpond-mcp-server`):
  1. No major bump unless `ALLOW_MAJOR` authorizes it.
  2. No downgrade (local < npm `latest`).
  3. Family alignment — both packages must carry the same version.
  - functype's `server.json` and eslint-pair checks are dropped (no such side-files
    here).
- **`publish.yml`** — on `v*` push: checkout (`fetch-depth: 0`), pnpm + Node-from-
  `.nvmrc`, `pnpm install --frozen-lockfile`, `turbo run validate`,
  `check-publish-safety`, `pnpm -r publish --no-git-checks --access public`
  (publishes only packages whose local version differs from npm `latest`), then a
  GitHub release. `permissions: { contents: write, id-token: write }`. Provide both
  `NODE_AUTH_TOKEN`/`NPM_TOKEN` (from `secrets.NPM_TOKEN`) so the token-based package
  works; npm's per-package trusted-publisher settings drive OIDC where configured.
- **No `npm install -g npm@latest` hack** — Node 24 bundles npm 11.x which fixes the
  OIDC PUT-404 bug.

## CI

A single root **`ci.yml`** on push/PR to `main`: `pnpm install --frozen-lockfile` +
`turbo run validate` (covers both packages, cached). The duplicate per-repo CI
workflows (`node.js.yml`, the server's `ci.yml`) collapse into this. One root
`codeql.yml` retained.

## Deferred / out of scope

- **Docker auto-build.** `Dockerfile`, `docker-compose.yml`, `.mcp.json` are merged in
  but `docker-build.yml` is **not** added to CI. The Dockerfile still references the
  published `duckpond`; reworking it for a monorepo-root build context is a later task.
- **Archiving the old repo.** `github.com/jordanburke/duckpond-mcp-server` stays active.
  No immediate npm double-publish risk: tags don't cross git remotes, and a release
  only happens where a `v*` tag is pushed. The standalone repo simply becomes stale
  until a future cleanup (archive + repoint package `homepage`/`repository`).
- **Changesets.** functype references Changesets `fixed` groups historically, but its
  operative path is `release.ts`. We port the scripts only; no Changesets dependency.

## Risks & mitigations

- **Node 22 → 24 bump with a native addon.** `@duckdb/node-api`/`node-bindings` are
  native. Mitigation: explicitly run `pnpm validate` (build + 17 tests) on Node 24
  before merging; treat any native-build failure as a blocker.
- **pnpm `allowBuilds` field name drift.** Confirm the correct field for pnpm
  10.29.3 during implementation; verify the DuckDB addon actually builds post-install.
- **Lockfile reconciliation.** Merging two lockfiles into one can shift transitive
  versions. Mitigation: single root `pnpm install`, then full `validate`; review the
  lockfile diff for unexpected major jumps.
- **Subtree path cosmetics.** Pre-merge server commits show original top-level paths;
  `git blame`/`log --follow` still trace correctly. Accepted.

## Success criteria

From a clean clone of the `monorepo-conversion` branch:
1. `pnpm install` succeeds on Node 24 (DuckDB native addon builds).
2. `pnpm validate` (→ `turbo run validate`) passes for **both** packages — including
   duckpond's 17 tests.
3. `packages/duckpond-mcp-server` resolves `duckpond` via the workspace symlink
   (no npm fetch of the library).
4. `git log packages/duckpond-mcp-server/` shows the preserved server history.
5. `pnpm release patch` (dry, on a scratch branch) bumps both package.jsons to the
   same version and passes `check-publish-safety`.
