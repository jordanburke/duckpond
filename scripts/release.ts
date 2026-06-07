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
