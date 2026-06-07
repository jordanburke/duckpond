# DuckPond Monorepo Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the `duckpond` repo into a pnpm + Turborepo monorepo and absorb `duckpond-mcp-server` as `packages/duckpond-mcp-server`, linked to the library via `workspace:^`.

**Architecture:** Private workspace root orchestrates two packages (`packages/duckpond`, `packages/duckpond-mcp-server`) with Turborepo. Per-package `ts-builds` tooling is unchanged; Turbo only sequences tasks (`^build` ensures the library builds before the server). Release tooling (lockstep family versioning on a single `v*` tag) is ported from the functype monorepo.

**Tech Stack:** pnpm 10.29.3 workspaces, Turborepo 2.9.x, Node 24, TypeScript 6.0.3, ts-builds 2.8.2, tsdown, vitest, tsx.

**Reference repos (read-only, local):**
- functype monorepo: `/home/jordanburke/IdeaProjects/functype` (the pattern we mirror)
- server source: `/home/jordanburke/IdeaProjects/duckpond-mcp-server` (sibling, merged via subtree)

**Spec:** `docs/superpowers/specs/2026-06-07-duckpond-monorepo-design.md`

---

## File structure (end state)

```
duckpond/                                 root: "duckpond-monorepo", private
├─ package.json                           NEW — turbo scripts, devDeps turbo+tsx, pnpm.onlyBuiltDependencies
├─ pnpm-workspace.yaml                    NEW — packages/*
├─ turbo.json                             NEW — ported from functype
├─ .nvmrc                                 MODIFIED — 22 → 24
├─ .npmrc                                 unchanged (root-wide hoist patterns)
├─ .gitignore                             unchanged
├─ LICENSE                                unchanged (monorepo license)
├─ scripts/
│  ├─ release.ts                          NEW — lockstep bump + tag (2-pkg port)
│  └─ check-publish-safety.ts             NEW — pre-publish gate (2-pkg port)
├─ .github/workflows/
│  ├─ ci.yml                              NEW — install + turbo run validate
│  ├─ publish.yml                         REPLACED — v* tag → validate → safety → pnpm -r publish
│  └─ codeql.yml                          unchanged
├─ README.md                              REPLACED — monorepo overview
├─ CLAUDE.md                              REPLACED — monorepo guidance
├─ docs/superpowers/{specs,plans}/        spec + this plan
└─ packages/
   ├─ duckpond/                           library (moved from root)
   │  ├─ src/ test/ package.json tsconfig.json tsdown.config.ts
   │  ├─ eslint.config.mjs .prettierignore
   │  ├─ README.md CLAUDE.md STANDARDIZATION_GUIDE.md
   └─ duckpond-mcp-server/                server (subtree-merged, history preserved)
      ├─ src/ test/ package.json tsconfig.json tsdown.config.ts
      ├─ eslint.config.mjs .prettierignore ts-builds.config.json
      ├─ Dockerfile docker-compose.yml .mcp.json   (present; NOT auto-built)
      ├─ README.md CLAUDE.md
      └─ (nested .github/, .nvmrc, .npmrc, pnpm-lock.yaml removed during merge)
```

**Note on verification commands:** "validate" everywhere means the full `ts-builds`
chain (format:check → lint:check → typecheck → test → build). The library's 17 vitest
tests are the substantive automated gate; most tasks here are structural, so the
"test" for each is that `validate` stays green and the specific invariant
(symlink resolves, history present, scripts run) holds.

---

## Task 1: Branch and de-risk the Node 24 bump on the current layout

Validate the riskiest change (Node 22→24 with the native DuckDB addon) **before**
restructuring, while the repo is still a simple single package and easy to reason about.

**Files:**
- Modify: `.nvmrc`

- [ ] **Step 1: Create the working branch**

```bash
cd /home/jordanburke/IdeaProjects/duckpond
git checkout main && git pull --ff-only
git checkout -b monorepo-conversion
```

- [ ] **Step 2: Install and select Node 24**

```bash
# nvm (or fnm equivalent: fnm install 24 && fnm use 24)
nvm install 24
nvm use 24
node -v        # Expected: v24.x
corepack enable
pnpm -v        # Expected: 10.29.3 (pinned by packageManager)
```

- [ ] **Step 3: Bump `.nvmrc` to 24**

Replace the entire contents of `.nvmrc` with:

```
24
```

- [ ] **Step 4: Reinstall and validate on Node 24**

```bash
pnpm install
pnpm validate
```

Expected: install completes (DuckDB native addon resolves — `@duckdb/node-api`
uses ABI-stable N-API, so the prebuilt binary loads on Node 24 without a rebuild),
and `validate` passes with **17 tests passing**.

> **DECISION POINT:** If `pnpm install` or the tests fail on Node 24 due to the
> native addon, STOP. The monorepo conversion does **not** require Node 24 — it is
> only for clean npm OIDC publishing. Fall back: keep `.nvmrc` at `22`, proceed with
> the rest of the plan, and defer the Node bump (note it in the final summary). Do
> not force the bump past a native-addon failure.

- [ ] **Step 5: Commit**

```bash
git add .nvmrc
git commit -m "chore: bump Node to 24 for npm OIDC trusted publishing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Move the library into `packages/duckpond/` and scaffold the workspace root

After this task the repo is a working 1-package monorepo.

**Files:**
- Move: `src/`, `test/`, `package.json`, `tsconfig.json`, `tsdown.config.ts`, `eslint.config.mjs`, `.prettierignore`, `README.md`, `CLAUDE.md`, `STANDARDIZATION_GUIDE.md` → `packages/duckpond/`
- Delete: `pnpm-lock.yaml` (regenerated at root)
- Create: `packages/` dir, root `package.json`, `pnpm-workspace.yaml`, `turbo.json`

- [ ] **Step 1: Move the library files into the package directory**

```bash
cd /home/jordanburke/IdeaProjects/duckpond
mkdir -p packages/duckpond
git mv src test package.json tsconfig.json tsdown.config.ts eslint.config.mjs \
       .prettierignore README.md CLAUDE.md STANDARDIZATION_GUIDE.md packages/duckpond/
git rm pnpm-lock.yaml
```

Expected: `git status` shows the renames staged and the lockfile deleted. The
library `package.json` (name `duckpond`, its `version`, `exports`, `files`,
`prepublishOnly`) is unchanged — only its location moved.

- [ ] **Step 2: Create the root `pnpm-workspace.yaml`**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
```

(Hoist patterns stay in the existing root `.npmrc`, which now applies workspace-wide.)

- [ ] **Step 3: Create the root `turbo.json` (ported from functype)**

Create `turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "stream",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "lib/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "lint": {
      "outputs": []
    },
    "lint:check": {
      "outputs": []
    },
    "format": {
      "outputs": []
    },
    "format:check": {
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "validate": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "lib/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- [ ] **Step 4: Create the root `package.json`**

Create `package.json`:

```json
{
  "name": "duckpond-monorepo",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.29.3+sha512.498e1fb4cca5aa06c1dcf2611e6fafc50972ffe7189998c409e90de74566444298ffe43e6cd2acdc775ba1aa7cc5e092a8b7054c811ba8c5770f84693d33d2dc",
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "lint:check": "turbo run lint:check",
    "format": "turbo run format",
    "format:check": "turbo run format:check",
    "typecheck": "turbo run typecheck",
    "validate": "turbo run validate",
    "dev": "turbo run dev",
    "release": "tsx scripts/release.ts",
    "check-publish-safety": "tsx scripts/check-publish-safety.ts"
  },
  "devDependencies": {
    "tsx": "^4.22.4",
    "turbo": "^2.9.16"
  },
  "pnpm": {
    "onlyBuiltDependencies": ["@duckdb/node-bindings", "@duckdb/node-api", "esbuild"]
  }
}
```

> The `pnpm.onlyBuiltDependencies` list pre-authorizes build scripts for the native
> DuckDB packages and esbuild, so the workspace install can't silently skip a needed
> native build. It is harmless for any listed package that ships prebuilt binaries.

- [ ] **Step 5: Install and validate the single-package workspace**

```bash
pnpm install
pnpm validate
```

Expected: a fresh root `pnpm-lock.yaml` is created; `turbo run validate` runs
`duckpond`'s chain and passes with **17 tests**. If pnpm prints
`Ignored build scripts: ...`, run `pnpm approve-builds` and confirm the listed
package matches the `onlyBuiltDependencies` entries, then re-run `pnpm install`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: move duckpond library into packages/duckpond and add workspace root

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Subtree-merge `duckpond-mcp-server` (history preserved)

**Files:**
- Create (via subtree): `packages/duckpond-mcp-server/**`
- Delete (post-merge cleanup): `packages/duckpond-mcp-server/.github/`, `packages/duckpond-mcp-server/.nvmrc`, `packages/duckpond-mcp-server/.npmrc`, `packages/duckpond-mcp-server/pnpm-lock.yaml`

- [ ] **Step 1: Confirm the sibling repo is clean and on `main`**

```bash
git -C ../duckpond-mcp-server status --porcelain   # Expected: empty
git -C ../duckpond-mcp-server symbolic-ref --short HEAD   # Expected: main
```

If the sibling has uncommitted changes, stop and commit/stash them there first
(subtree only brings tracked, committed files).

- [ ] **Step 2: Subtree-add the server under the package prefix**

```bash
cd /home/jordanburke/IdeaProjects/duckpond
git remote add mcp-tmp ../duckpond-mcp-server
git fetch mcp-tmp
git subtree add --prefix=packages/duckpond-mcp-server mcp-tmp main
git remote remove mcp-tmp
```

Expected: a merge commit grafts the server's full history under
`packages/duckpond-mcp-server/`.

- [ ] **Step 3: Verify the history came across**

```bash
git log --oneline -5 -- packages/duckpond-mcp-server/
```

Expected: shows the server's recent commits (e.g. `feat: add bearer token
authentication support`, fastmcp bumps), not a single import commit.

- [ ] **Step 4: Remove nested/duplicate config that the workspace root now owns**

```bash
git rm -r packages/duckpond-mcp-server/.github
git rm packages/duckpond-mcp-server/.nvmrc \
       packages/duckpond-mcp-server/.npmrc \
       packages/duckpond-mcp-server/pnpm-lock.yaml
```

Expected: nested GitHub workflows (inert at a sub-path, but removed for clarity),
the redundant per-package `.nvmrc`/`.npmrc` (root governs Node + hoisting), and the
stale per-package lockfile are deleted. Leave `Dockerfile`, `docker-compose.yml`,
`.mcp.json`, `ts-builds.config.json`, `.prettierrc`, and `jest.config.ts` in place.

- [ ] **Step 5: Reinstall and validate both packages (server still on the npm `duckpond`)**

```bash
pnpm install
pnpm validate
```

Expected: install resolves the server's deps (it still declares `"duckpond":
"^0.5.1"`, fetched from npm at this stage). `turbo run validate` runs both packages'
chains and passes. (Turbo builds `duckpond` before the server's validate via
`^build`.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: merge duckpond-mcp-server into packages/duckpond-mcp-server (history preserved)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Link the server to the library via `workspace:^`

This is the core payoff — the server consumes the local library, not the npm copy.

**Files:**
- Modify: `packages/duckpond-mcp-server/package.json` (dependencies)

- [ ] **Step 1: Change the dependency to the workspace protocol**

In `packages/duckpond-mcp-server/package.json`, under `"dependencies"`, change:

```json
    "duckpond": "^0.5.1",
```

to:

```json
    "duckpond": "workspace:^",
```

- [ ] **Step 2: Reinstall so pnpm symlinks the local package**

```bash
pnpm install
```

- [ ] **Step 3: Verify the symlink resolves to the local package**

```bash
ls -l node_modules/duckpond
readlink -f packages/duckpond-mcp-server/node_modules/duckpond 2>/dev/null \
  || ls -l packages/duckpond-mcp-server/node_modules/duckpond
```

Expected: `duckpond` resolves to a symlink pointing at
`.../packages/duckpond` (not a real copy under `.pnpm` from the registry).

- [ ] **Step 4: Validate the full workspace against the local library**

```bash
pnpm validate
```

Expected: both packages pass. The server now typechecks/builds against
`packages/duckpond/dist` produced by Turbo's `^build`.

- [ ] **Step 5: Commit**

```bash
git add packages/duckpond-mcp-server/package.json pnpm-lock.yaml
git commit -m "feat: link duckpond-mcp-server to the library via workspace:^

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Port functype's release tooling (2-package family)

**Files:**
- Create: `scripts/release.ts`
- Create: `scripts/check-publish-safety.ts`

(Root `package.json` already wires `release` and `check-publish-safety` scripts and
`tsx` from Task 2.)

- [ ] **Step 1: Create `scripts/release.ts`**

Create `scripts/release.ts`:

```typescript
#!/usr/bin/env tsx
/**
 * Local release script — bumps the duckpond family (duckpond +
 * duckpond-mcp-server) at the requested semver level in lockstep, validates,
 * commits, and creates an annotated git tag. Push the tag to trigger CI publish
 * (`.github/workflows/publish.yml`).
 *
 * Usage:
 *   pnpm release patch
 *   pnpm release minor
 *   pnpm release major   # requires ALLOW_MAJOR env (see check-publish-safety)
 *
 * Ported from the functype monorepo's scripts/release.ts, reduced to the two
 * duckpond packages (no eslint mirror, no server.json registry, no CHANGELOG).
 */

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

const FAMILY_PACKAGE_DIRS = ["packages/duckpond", "packages/duckpond-mcp-server"] as const

type BumpLevel = "patch" | "minor" | "major"

const bumpLevel = process.argv[2] as BumpLevel | undefined
if (!bumpLevel || !["patch", "minor", "major"].includes(bumpLevel)) {
  console.error("Usage: pnpm release patch|minor|major")
  process.exit(1)
}

const run = (cmd: string, args: readonly string[] = []): void => {
  console.log(`\n▶ ${cmd}${args.length ? " " + args.join(" ") : ""}`)
  const result = spawnSync(cmd, args, { cwd: repoRoot, stdio: "inherit" })
  if (result.status !== 0) {
    console.error(`✗ Command failed: ${cmd} ${args.join(" ")}`)
    process.exit(result.status ?? 1)
  }
}

const capture = (cmd: string, args: readonly string[] = []): string => {
  const result = spawnSync(cmd, args, { cwd: repoRoot, encoding: "utf8" })
  if (result.status !== 0) {
    console.error(`✗ Command failed: ${cmd} ${args.join(" ")}\n${result.stderr ?? ""}`)
    process.exit(result.status ?? 1)
  }
  return result.stdout.toString().trim()
}

const readPkg = (dir: string): { name: string; version: string; [k: string]: unknown } => {
  const path = join(repoRoot, dir, "package.json")
  return JSON.parse(readFileSync(path, "utf8")) as { name: string; version: string; [k: string]: unknown }
}

const writePkg = (dir: string, pkg: object): void => {
  writeFileSync(join(repoRoot, dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n")
}

// 1. Preflight
const dirty = capture("git", ["status", "--porcelain"])
if (dirty) {
  console.error("✗ Working tree is not clean. Commit or stash changes first.\n" + dirty)
  process.exit(1)
}
const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"])
if (branch !== "main") {
  console.error(`✗ Not on main (currently on ${branch}). Release from main.`)
  process.exit(1)
}
run("git", ["fetch", "origin", "main", "--quiet"])
const local = capture("git", ["rev-parse", "HEAD"])
const remote = capture("git", ["rev-parse", "origin/main"])
if (local !== remote) {
  console.error(`✗ Local main is not in sync with origin/main.\n  local=${local}\n  remote=${remote}`)
  process.exit(1)
}

// 2. Validate
run("pnpm", ["validate"])

// 3. Compute new version (base = duckpond's current version)
const current = readPkg("packages/duckpond").version
const parts = current.split(".").map(Number)
if (parts.length !== 3 || parts.some(Number.isNaN)) {
  console.error(`✗ Cannot parse current duckpond version: ${current}`)
  process.exit(1)
}
const [major, minor, patch] = parts as [number, number, number]
const next =
  bumpLevel === "major"
    ? `${major + 1}.0.0`
    : bumpLevel === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`

if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`✗ Computed version ${next} doesn't look like semver.`)
  process.exit(1)
}

console.log(`\nReleasing duckpond family: ${current} → ${next} (${bumpLevel})`)

// 4. Bump both family packages in lockstep
for (const dir of FAMILY_PACKAGE_DIRS) {
  const pkg = readPkg(dir)
  pkg.version = next
  writePkg(dir, pkg)
  console.log(`  ${(pkg.name as string).padEnd(22)} ${current} → ${next}`)
}

// 5. Final safety gate
run("pnpm", ["check-publish-safety"])

// 6. Commit + tag (arg-array form avoids shell interpolation of `next`)
run("git", ["add", "-A"])
run("git", ["commit", "-m", `release: v${next}`])
run("git", ["tag", "-a", `v${next}`, "-m", `Release v${next}`])

// 7. Instructions
console.log(`\n✓ Released v${next} locally (commit + tag).`)
console.log(`\nNext steps:`)
console.log(`  git push --follow-tags`)
console.log(`\nCI on tag push will:`)
console.log(`  1. Re-run validate + check-publish-safety`)
console.log(`  2. pnpm -r publish --no-git-checks (publishes packages whose version differs from npm latest)`)
console.log(`  3. Create a GitHub release for the tag`)
```

- [ ] **Step 2: Create `scripts/check-publish-safety.ts`**

Create `scripts/check-publish-safety.ts`:

```typescript
#!/usr/bin/env tsx
/**
 * Pre-publish safety gate (ported from functype, reduced to the duckpond family).
 *
 * Refuses to proceed if any of the following holds, unless explicitly authorized:
 *   1. Major version bump — set `ALLOW_MAJOR=<pkg>,<pkg>` to authorize.
 *   2. Downgrade (local < npm) — never auto-authorized.
 *   3. Alignment drift — duckpond and duckpond-mcp-server must share a version.
 *
 * Runs in `publish.yml` before `pnpm -r publish` and locally via
 * `pnpm check-publish-safety`.
 */

import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

const PACKAGE_DIRS = ["packages/duckpond", "packages/duckpond-mcp-server"] as const

/**
 * Packages that must publish in lockstep — both members must carry the same
 * version at publish time.
 */
const ALIGNMENT_GROUPS: ReadonlyArray<{ readonly label: string; readonly members: ReadonlySet<string> }> = [
  {
    label: "duckpond family",
    members: new Set<string>(["duckpond", "duckpond-mcp-server"]),
  },
]

const allowMajor = new Set(
  (process.env.ALLOW_MAJOR ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
)

type BumpKind = "patch" | "minor" | "major" | "downgrade" | "same" | "new"

interface Plan {
  name: string
  local: string
  npm: string | null
  bump: BumpKind
}

const readPkg = (dir: string): { name: string; version: string } => {
  const raw = readFileSync(join(repoRoot, dir, "package.json"), "utf8")
  return JSON.parse(raw) as { name: string; version: string }
}

const getNpmVersion = (name: string): string | null => {
  const result = spawnSync("npm", ["view", name, "version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status !== 0) return null
  const out = result.stdout.trim()
  return out.length > 0 ? out : null
}

const classify = (local: string, npm: string | null): BumpKind => {
  if (!npm) return "new"
  if (local === npm) return "same"
  const [lMaj = 0, lMin = 0, lPat = 0] = local.split(".").map(Number)
  const [nMaj = 0, nMin = 0, nPat = 0] = npm.split(".").map(Number)
  if (lMaj > nMaj) return "major"
  if (lMaj < nMaj) return "downgrade"
  if (lMin > nMin) return "minor"
  if (lMin < nMin) return "downgrade"
  if (lPat > nPat) return "patch"
  return "downgrade"
}

const plans: Plan[] = PACKAGE_DIRS.map((dir) => {
  const { name, version } = readPkg(dir)
  const npm = getNpmVersion(name)
  return { name, local: version, npm, bump: classify(version, npm) }
})

console.log("\nPublish plan (npm → local):")
const colName = Math.max(...plans.map((p) => p.name.length))
for (const p of plans) {
  const npmStr = p.npm ?? "(new)"
  const arrow = p.bump === "same" ? "=" : p.bump === "downgrade" ? "↓" : "→"
  console.log(`  ${p.name.padEnd(colName)}  ${npmStr.padStart(10)} ${arrow} ${p.local.padEnd(10)}  [${p.bump}]`)
}

const downgrades = plans.filter((p) => p.bump === "downgrade")
const surpriseMajors = plans.filter((p) => p.bump === "major" && !allowMajor.has(p.name))
const allowedMajors = plans.filter((p) => p.bump === "major" && allowMajor.has(p.name))

if (allowedMajors.length > 0) {
  console.log(`\nℹ️  Authorized major bumps via ALLOW_MAJOR: ${allowedMajors.map((p) => p.name).join(", ")}`)
}

if (downgrades.length > 0) {
  console.error(`\n✗ check-publish-safety: ${downgrades.length} downgrade(s) detected (local < npm)`)
  for (const p of downgrades) {
    console.error(`    ${p.name}: ${p.local} < ${p.npm}`)
  }
  console.error(`\n  Downgrades are never auto-approved. Revert the version field and republish if intentional.`)
  process.exit(1)
}

if (surpriseMajors.length > 0) {
  console.error(`\n✗ check-publish-safety: ${surpriseMajors.length} unauthorized major bump(s)`)
  for (const p of surpriseMajors) {
    console.error(`    ${p.name}: ${p.npm} → ${p.local} (major)`)
  }
  console.error(`\n  If intentional, set ALLOW_MAJOR=${surpriseMajors.map((p) => p.name).join(",")} and retry.`)
  process.exit(1)
}

const driftedGroups = ALIGNMENT_GROUPS.flatMap((group) => {
  const members = plans.filter((p) => group.members.has(p.name))
  const versions = new Set(members.map((p) => p.local))
  return versions.size > 1 ? [{ group, members }] : []
})
if (driftedGroups.length > 0) {
  for (const { group, members } of driftedGroups) {
    console.error(`\n✗ check-publish-safety: ${group.label} (${members.length} packages) is out of alignment.`)
    for (const p of members) {
      console.error(`    ${p.name.padEnd(colName)}  ${p.local}`)
    }
  }
  console.error(`\n  Aligned packages must publish at the same version. Use \`pnpm release\` to bump them together.`)
  process.exit(1)
}

console.log(`\n✓ check-publish-safety: no surprise majors or downgrades; family in sync — safe to publish`)
```

- [ ] **Step 3: Run the safety gate to verify it executes and reports correctly**

```bash
pnpm check-publish-safety
```

Expected: prints a "Publish plan" table for `duckpond` and `duckpond-mcp-server`,
both showing `=` `[same]` (local 0.5.1 == npm 0.5.1), and exits `0` with
`✓ ... family in sync — safe to publish`.

- [ ] **Step 4: Smoke-test the release script's preflight (without releasing)**

```bash
pnpm release patch
```

Expected: it FAILS fast at preflight with
`✗ Not on main (currently on monorepo-conversion). Release from main.` — confirming
the guard works. (Do **not** run an actual release from this branch.)

- [ ] **Step 5: Commit**

```bash
git add scripts/release.ts scripts/check-publish-safety.ts
git commit -m "feat: add lockstep release + publish-safety scripts (ported from functype)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Consolidate CI and publishing workflows

**Files:**
- Create: `.github/workflows/ci.yml`
- Replace: `.github/workflows/publish.yml`
- Delete: `.github/workflows/node.js.yml`
- Keep: `.github/workflows/codeql.yml`

- [ ] **Step 1: Replace the old single-package CI with a workspace CI**

Delete the old per-package CI workflow:

```bash
git rm .github/workflows/node.js.yml
```

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: ".nvmrc"
          cache: "pnpm"

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Validate (all packages)
        run: pnpm turbo run validate
```

- [ ] **Step 2: Replace `publish.yml` with the lockstep workspace publisher (ported from functype)**

Overwrite `.github/workflows/publish.yml` with:

```yaml
name: Publish

# Tag-triggered release. Run `pnpm release patch|minor|major` locally to bump
# both packages in lockstep, validate, run check-publish-safety, commit, and tag.
# `git push --follow-tags` triggers this workflow.
#
# `duckpond` publishes via npm OIDC trusted publishing (provenance).
# `duckpond-mcp-server` publishes with NPM_TOKEN. Both env vars are provided;
# npm's per-package trusted-publisher settings select OIDC where configured.

on:
  push:
    tags:
      - "v*"

concurrency:
  group: publish-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: false

jobs:
  publish:
    name: Publish to npm
    runs-on: ubuntu-latest
    permissions:
      contents: write # for GitHub releases
      id-token: write # for npm OIDC trusted publishing
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          run_install: false

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: ".nvmrc"
          registry-url: "https://registry.npmjs.org"
          cache: "pnpm"

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Validate
        run: pnpm turbo run validate

      - name: Check publish safety
        run: pnpm check-publish-safety
        env:
          ALLOW_MAJOR: ""

      - name: Publish to npm
        run: pnpm -r publish --no-git-checks --access public
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Create GitHub release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          generate_release_notes: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 3: Validate workflow YAML is well-formed**

```bash
python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in ['.github/workflows/ci.yml','.github/workflows/publish.yml','.github/workflows/codeql.yml']]; print('YAML OK')"
```

Expected: `YAML OK`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "ci: consolidate workspace CI and lockstep publish workflow

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Monorepo-level docs

**Files:**
- Replace: `README.md` (root)
- Replace: `CLAUDE.md` (root)
- Modify: `packages/duckpond/README.md` (CI badge URL only)

- [ ] **Step 1: Write the root `README.md`**

Overwrite `README.md`:

````markdown
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
pnpm install          # Node 24 (see .nvmrc), pnpm 10.29.3
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
````

- [ ] **Step 2: Write the root `CLAUDE.md`**

Overwrite `CLAUDE.md`:

````markdown
# CLAUDE.md

Guidance for Claude Code when working in the DuckPond **monorepo**.

## What this is

A pnpm + Turborepo monorepo with two published packages:

- `packages/duckpond` — the DuckDB manager library (npm: `duckpond`)
- `packages/duckpond-mcp-server` — the MCP server (npm: `duckpond-mcp-server`)

The server depends on the library via `workspace:^` (symlinked locally; rewritten to
a real range on publish). Tooling: pnpm 10.29.3, Turborepo, Node 24 (`.nvmrc`),
TypeScript 6.0.3, ts-builds, tsdown, vitest.

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
````

- [ ] **Step 3: Fix the CI badge in the moved library README**

In `packages/duckpond/README.md`, the Node CI badge points at the deleted
`node.js.yml`. Replace the badge line:

```markdown
[![Node.js CI](https://github.com/jordanburke/duckpond/actions/workflows/node.js.yml/badge.svg)](https://github.com/jordanburke/duckpond/actions/workflows/node.js.yml)
```

with:

```markdown
[![CI](https://github.com/jordanburke/duckpond/actions/workflows/ci.yml/badge.svg)](https://github.com/jordanburke/duckpond/actions/workflows/ci.yml)
```

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md packages/duckpond/README.md
git commit -m "docs: add monorepo-level README and CLAUDE.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Final end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Clean reinstall from the lockfile**

```bash
cd /home/jordanburke/IdeaProjects/duckpond
rm -rf node_modules packages/*/node_modules .turbo
pnpm install --frozen-lockfile
```

Expected: install succeeds with no lockfile changes (`--frozen-lockfile` would fail
if the lockfile were stale).

- [ ] **Step 2: Full validate, twice (second run should hit Turbo cache)**

```bash
pnpm validate
pnpm validate
```

Expected: first run passes both packages (including duckpond's 17 tests); second run
reports Turbo cache hits (`>>> FULL TURBO` / cached tasks).

- [ ] **Step 3: Verify the workspace symlink (not an npm copy)**

```bash
node -e "console.log(require('node:fs').realpathSync('node_modules/duckpond'))"
```

Expected: a path ending in `/packages/duckpond`.

- [ ] **Step 4: Verify preserved server history**

```bash
git log --oneline -- packages/duckpond-mcp-server/ | tail -5
```

Expected: the server's oldest commits are present (history goes back beyond the
subtree merge), not a single import commit.

- [ ] **Step 5: Verify no stray nested workspace/config files**

```bash
ls packages/duckpond-mcp-server/.github 2>/dev/null && echo "STRAY .github — remove it" || echo "ok: no nested .github"
ls packages/*/pnpm-lock.yaml 2>/dev/null && echo "STRAY per-package lockfile" || echo "ok: single root lockfile"
```

Expected: both lines report `ok:`.

- [ ] **Step 6: Confirm the success criteria, then hand off**

Confirm against the spec's success criteria:
1. `pnpm install` on Node 24 succeeds (native addon builds/loads).
2. `pnpm validate` passes both packages incl. duckpond's 17 tests.
3. The server resolves `duckpond` via the workspace symlink.
4. `git log packages/duckpond-mcp-server/` shows preserved history.
5. `pnpm release patch` preflight guard fires correctly (Task 5, Step 4).

Do **not** merge or push automatically. Stop here and use the
`superpowers:finishing-a-development-branch` skill to decide how to integrate
`monorepo-conversion` (PR vs. merge to `main`), and surface the deferred items
(Docker auto-build, archiving the old repo) for a follow-up.

---

## Notes / deferred (from the spec)

- **Docker auto-build** is out of scope: the `Dockerfile`, `docker-compose.yml`, and
  `.mcp.json` ride along under `packages/duckpond-mcp-server/` but no
  `docker-build.yml` is added. The Dockerfile still installs the published `duckpond`;
  reworking it for a monorepo-root build context is a separate task.
- **Archiving** `github.com/jordanburke/duckpond-mcp-server` is deferred. No npm
  double-publish risk in the interim (tags don't cross git remotes).
- **Node 24 fallback:** if Task 1 fails on the native addon, the whole conversion can
  proceed on Node 22; only OIDC-publish cleanliness is affected.
