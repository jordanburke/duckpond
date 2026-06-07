/**
 * Cross-platform resolution of DUCKPOND_DATA_DIR.
 *
 * Beyond plain `~` expansion, this understands platform "tokens" that let a
 * single config value resolve correctly on macOS, native Windows, and WSL:
 *
 *   $WINHOME             → the Windows home dir (on WSL, discovered under /mnt/c/Users)
 *   $OneDrive            → the OneDrive root (auto-discovered, else the OneDrive* env var)
 *   $OneDriveCommercial  → "
 *   $OneDriveConsumer    → "
 *   $GOOGLE_DRIVE        → the Google Drive root
 *   $DROPBOX             → the Dropbox root
 *
 * These tokens are NOT standard env vars on WSL, so functype-os's plain
 * `expandVars` can't resolve them — we map them to `Platform` discovery here.
 * Tokens survive Claude Code's `.mcp.json` expansion (it only expands `${VAR}`),
 * so `DUCKPOND_DATA_DIR=$OneDrive/Apps/duckdb` reaches the server intact.
 *
 * Mirrors the discovery convention in envpkt (src/core/config.ts).
 */
import { basename } from "node:path"

import { type CloudProvider, Env, Path, Platform } from "functype-os"

import type { DuckPondServerConfig } from "../server-core"

/**
 * Default local data directory, used only when DUCKPOND_DATA_DIR is unset.
 */
export function getDefaultDataDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "."
  return `${home}/.duckpond/data`
}

/** First non-empty value among the given env var names. */
function firstEnv(names: ReadonlyArray<string>): string | undefined {
  for (const name of names) {
    const value = Env.get(name).orElse("")
    if (value !== "") {
      return value
    }
  }
  return undefined
}

/** A commercial/work OneDrive has an org suffix, e.g. "OneDrive - Contoso". */
function isCommercialOneDrive(p: string): boolean {
  return /\bOneDrive\s+-\s+/i.test(basename(p))
}

/**
 * Pick the best discovered dir for a cloud provider. `homeDirs()` is scanned in
 * order (on WSL: Linux home first, then Windows home), so a provider can appear
 * multiple times. We prefer the copy under the Windows home on WSL — that's the
 * real synced location — and otherwise take the first match.
 */
function selectCloud(provider: CloudProvider, filter?: (p: string) => boolean): string | undefined {
  const all = Platform.cloudStorageDirs()
    .toArray()
    .filter((d) => d.provider === provider)
    .map((d) => d.path)
  const matched = filter === undefined ? all : all.filter(filter)
  const pool = matched.length > 0 ? matched : all
  if (pool.length === 0) {
    return undefined
  }
  const winHome = Platform.windowsHomeDir().orUndefined()
  const winPreferred = winHome === undefined ? undefined : pool.find((p) => p.startsWith(winHome))
  return winPreferred ?? pool[0]
}

function oneDrivePersonal(): string | undefined {
  return selectCloud("onedrive", (p) => !isCommercialOneDrive(p)) ?? firstEnv(["OneDrive", "OneDriveConsumer"])
}

function oneDriveCommercial(): string | undefined {
  return selectCloud("onedrive", isCommercialOneDrive) ?? firstEnv(["OneDriveCommercial"])
}

/**
 * Platform tokens, ordered longest-first so a prefix token (e.g. `$OneDrive`)
 * never partially matches a longer one (`$OneDriveCommercial`). Each resolver
 * returns the absolute path, or undefined when it cannot be located.
 */
const PLATFORM_TOKENS: ReadonlyArray<{ token: string; resolve: () => string | undefined }> = [
  { token: "WINHOME", resolve: () => Platform.windowsHomeDir().orElse(Platform.homeDir()) },
  { token: "OneDriveCommercial", resolve: oneDriveCommercial },
  { token: "OneDriveConsumer", resolve: oneDrivePersonal },
  { token: "OneDrive", resolve: oneDrivePersonal },
  { token: "GOOGLE_DRIVE", resolve: () => selectCloud("gdrive") ?? firstEnv(["GOOGLE_DRIVE"]) },
  { token: "DROPBOX", resolve: () => selectCloud("dropbox") ?? firstEnv(["DROPBOX", "DROPBOX_PATH"]) },
]

function hasToken(input: string, token: string): boolean {
  return new RegExp(`\\$\\{?${token}\\b`, "i").test(input)
}

function replaceToken(input: string, token: string, value: string): string {
  return input.replace(new RegExp(`\\$\\{${token}\\}`, "gi"), value).replace(new RegExp(`\\$${token}\\b`, "gi"), value)
}

function describeSearch(): string {
  const homes = Platform.homeDirs().toArray().join(", ")
  const clouds = Platform.cloudStorageDirs()
    .toArray()
    .map((d) => `${d.provider}:${d.path}`)
    .join(", ")
  return `homeDirs=[${homes}] cloudStorageDirs=[${clouds}]`
}

/**
 * Resolve a raw DUCKPOND_DATA_DIR value to an absolute path.
 *
 * Expands `~`, then platform tokens (`$OneDrive`, `$WINHOME`, …), then any
 * remaining real `$VAR`/`${VAR}` env references. Throws with a descriptive
 * message if a platform token is present but cannot be resolved — failing fast
 * is preferable to silently creating a database in the wrong location.
 */
export function resolveDataDir(raw: string): string {
  const tildeExpanded = Path.expandTilde(raw)

  const withTokens = PLATFORM_TOKENS.reduce((acc, { token, resolve }) => {
    if (!hasToken(acc, token)) {
      return acc
    }
    const value = resolve()
    if (value === undefined || value === "") {
      throw new Error(
        `Cannot resolve "$${token}" in DUCKPOND_DATA_DIR="${raw}". Searched ${describeSearch()}. ` +
          `Set the $${token} environment variable or use an explicit absolute path.`,
      )
    }
    return replaceToken(acc, token, value)
  }, tildeExpanded)

  // Expand any remaining real env vars; keep the literal if expansion fails.
  return Path.expandVars(withTokens).fold(
    () => withTokens,
    (expanded) => expanded,
  )
}

/**
 * Parse environment variables into DuckPond configuration.
 */
export function getConfigFromEnv(): DuckPondServerConfig {
  // Default to local disk storage (resolve ~, platform tokens, and env vars)
  const dataDir = resolveDataDir(process.env.DUCKPOND_DATA_DIR ?? getDefaultDataDir())

  const config: DuckPondServerConfig = {
    memoryLimit: process.env.DUCKPOND_MEMORY_LIMIT ?? "4GB",
    threads: parseInt(process.env.DUCKPOND_THREADS ?? "4"),
    maxActiveUsers: parseInt(process.env.DUCKPOND_MAX_ACTIVE_USERS ?? "10"),
    evictionTimeout: parseInt(process.env.DUCKPOND_EVICTION_TIMEOUT ?? "300000"),
    cacheType: (process.env.DUCKPOND_CACHE_TYPE as "disk" | "memory" | "noop") || "disk",
    strategy: (process.env.DUCKPOND_STRATEGY as "parquet" | "duckdb" | "hybrid") || "duckdb",
    tempDir: process.env.DUCKPOND_TEMP_DIR,
    cacheDir: process.env.DUCKPOND_CACHE_DIR ?? dataDir,
    dataDir,
  }

  // R2 configuration
  if (process.env.DUCKPOND_R2_ACCOUNT_ID) {
    config.r2 = {
      accountId: process.env.DUCKPOND_R2_ACCOUNT_ID,
      accessKeyId: process.env.DUCKPOND_R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.DUCKPOND_R2_SECRET_ACCESS_KEY ?? "",
      bucket: process.env.DUCKPOND_R2_BUCKET ?? "",
    }
  }

  // S3 configuration
  if (process.env.DUCKPOND_S3_REGION) {
    config.s3 = {
      region: process.env.DUCKPOND_S3_REGION,
      accessKeyId: process.env.DUCKPOND_S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.DUCKPOND_S3_SECRET_ACCESS_KEY ?? "",
      bucket: process.env.DUCKPOND_S3_BUCKET ?? "",
    }

    if (process.env.DUCKPOND_S3_ENDPOINT) {
      config.s3.endpoint = process.env.DUCKPOND_S3_ENDPOINT
    }
  }

  return config
}
