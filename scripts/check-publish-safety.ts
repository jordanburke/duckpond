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
