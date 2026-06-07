import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { DuckPondServer } from "../src/server-core"

describe("DuckPondServer", () => {
  let server: DuckPondServer

  beforeAll(async () => {
    server = new DuckPondServer({
      memoryLimit: "1GB",
      threads: 2,
      maxActiveUsers: 5,
      evictionTimeout: 60000,
      cacheType: "memory",
      strategy: "parquet",
    })

    const initResult = await server.init()
    expect(initResult.success).toBe(true)
  })

  afterAll(async () => {
    await server.close()
  })

  test("should initialize successfully", async () => {
    const freshServer = new DuckPondServer({
      memoryLimit: "1GB",
      maxActiveUsers: 5,
    })

    const result = await freshServer.init()
    expect(result.success).toBe(true)

    await freshServer.close()
  })

  test("should execute DDL statement", async () => {
    const result = await server.execute("test-user", "CREATE TABLE test (id INT, name VARCHAR)")

    expect(result.success).toBe(true)
    expect(result.executionTime).toBeGreaterThanOrEqual(0)
  })

  test("should query data", async () => {
    // Create and insert data
    await server.execute("test-user-2", "CREATE TABLE users (id INT, name VARCHAR)")
    await server.execute("test-user-2", "INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob')")

    // Query data
    const result = await server.query<{ id: number; name: string }>("test-user-2", "SELECT * FROM users")

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(2)
      expect(result.data[0]).toEqual({ id: 1, name: "Alice" })
    }
  })

  test("should check user attachment status", async () => {
    // Execute a query to ensure user is attached
    await server.execute("test-user-3", "CREATE TABLE temp (id INT)")

    const result = server.isAttached("test-user-3")

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe(true)
    }
  })

  test("should get user stats", async () => {
    // Ensure user is attached
    await server.execute("test-user-4", "CREATE TABLE stats_test (id INT)")

    const result = await server.getUserStats("test-user-4")

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.userId).toBe("test-user-4")
      expect(result.data.attached).toBe(true)
    }
  })

  test("should detach user", async () => {
    // Attach user first
    await server.execute("test-user-5", "CREATE TABLE detach_test (id INT)")

    // Verify attached
    const attachedResult = server.isAttached("test-user-5")
    expect(attachedResult.success && attachedResult.data).toBe(true)

    // Detach
    const detachResult = await server.detachUser("test-user-5")
    expect(detachResult.success).toBe(true)

    // Verify detached
    const detachedResult = server.isAttached("test-user-5")
    expect(detachedResult.success && detachedResult.data).toBe(false)
  })

  test("should handle query errors", async () => {
    const result = await server.query("test-user-6", "SELECT * FROM nonexistent_table")

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_REQUEST")
      expect(result.error.message).toContain("nonexistent_table")
    }
  })

  test("should return error when not initialized", async () => {
    const uninitializedServer = new DuckPondServer({
      memoryLimit: "1GB",
      maxActiveUsers: 5,
    })

    const result = await uninitializedServer.query("test-user", "SELECT 1")

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe("FAILED_PRECONDITION")
    }
  })
})
