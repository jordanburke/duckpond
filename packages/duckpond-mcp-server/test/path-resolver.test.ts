import { Env, Platform } from "functype-os"
import { afterEach, describe, expect, test } from "vitest"

import { getDefaultDataDir, resolveDataDir } from "../src/config/path-resolver"

// Whether a real OneDrive root is discoverable on this machine (cloud dir or env var).
const oneDriveAvailable =
  Platform.cloudStorageDirs()
    .toArray()
    .some((d) => d.provider === "onedrive") ||
  ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"].some((n) => Env.has(n))

describe("resolveDataDir", () => {
  const original = process.env.DUCKPOND_PATH_TEST

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DUCKPOND_PATH_TEST
    } else {
      process.env.DUCKPOND_PATH_TEST = original
    }
  })

  test("expands a leading ~", () => {
    const resolved = resolveDataDir("~/some/dir")
    expect(resolved).not.toContain("~")
    expect(resolved.endsWith("/some/dir")).toBe(true)
  })

  test("passes an absolute path through unchanged", () => {
    expect(resolveDataDir("/var/lib/duckpond")).toBe("/var/lib/duckpond")
  })

  test("expands a real environment variable ($VAR and ${VAR})", () => {
    process.env.DUCKPOND_PATH_TEST = "/tmp/secrets"
    expect(resolveDataDir("$DUCKPOND_PATH_TEST/db")).toBe("/tmp/secrets/db")
    expect(resolveDataDir("${DUCKPOND_PATH_TEST}/db")).toBe("/tmp/secrets/db")
  })

  test("getDefaultDataDir ends with .duckpond/data", () => {
    expect(getDefaultDataDir().endsWith("/.duckpond/data")).toBe(true)
  })

  // Throws only when the token genuinely cannot be resolved on this machine.
  describe.skipIf(oneDriveAvailable)("when OneDrive is not present", () => {
    test("throws a descriptive error for an unresolvable $OneDrive token", () => {
      expect(() => resolveDataDir("$OneDrive/Apps/duckdb")).toThrowError(/Cannot resolve "\$OneDrive"/)
    })
  })

  // Real cross-platform resolution — only meaningful under WSL.
  describe.skipIf(!Platform.isWSL())("on WSL", () => {
    test("$WINHOME resolves to the Windows home under /mnt", () => {
      const resolved = resolveDataDir("$WINHOME/Apps/duckdb")
      expect(resolved).not.toContain("$WINHOME")
      expect(resolved.endsWith("/Apps/duckdb")).toBe(true)
    })

    test.skipIf(!oneDriveAvailable)("$OneDrive resolves to a real OneDrive path", () => {
      const resolved = resolveDataDir("$OneDrive/Apps/duckdb")
      expect(resolved).not.toContain("$OneDrive")
      expect(resolved.endsWith("/Apps/duckdb")).toBe(true)
    })
  })
})
