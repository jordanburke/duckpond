import { describe, test, expect, beforeAll, afterAll } from "vitest"
import { DuckPond } from "../src/DuckPond"
import { ErrorCode } from "../src/types"

describe("DuckPond", () => {
  describe("Initialization", () => {
    test("should create instance with default config", () => {
      const pond = new DuckPond({
        memoryLimit: "1GB",
        threads: 2,
      })

      expect(pond).toBeDefined()
      expect(pond).toBeInstanceOf(DuckPond)
    })

    test("should fail queries before initialization", async () => {
      const pond = new DuckPond({ memoryLimit: "1GB" })

      const result = await pond.query("test-user", "SELECT 1")

      expect(result.isLeft()).toBe(true)
      const error = result.fold(
        (err) => err,
        () => null,
      )
      expect(error).toBeTruthy()
      expect(error?.code).toBe(ErrorCode.NOT_INITIALIZED)
    })

    test("should initialize successfully", async () => {
      const pond = new DuckPond({
        memoryLimit: "1GB",
        threads: 2,
      })

      const result = await pond.init()

      expect(result.isRight()).toBe(true)

      await pond.close()
    })

    test("should handle multiple init calls gracefully", async () => {
      const pond = new DuckPond({ memoryLimit: "1GB" })

      const result1 = await pond.init()
      const result2 = await pond.init()

      expect(result1.isRight()).toBe(true)
      expect(result2.isRight()).toBe(true)

      await pond.close()
    })
  })

  describe("User Management", () => {
    let pond: DuckPond

    beforeAll(async () => {
      pond = new DuckPond({
        memoryLimit: "1GB",
        maxActiveUsers: 3,
      })
      await pond.init()
    })

    afterAll(async () => {
      await pond.close()
    })

    test("should check if user is attached", () => {
      expect(pond.isAttached("user1")).toBe(false)
    })

    test("should get user stats", async () => {
      const result = await pond.getUserStats("user1")

      expect(result.isRight()).toBe(true)
      const stats = result.fold(
        () => null,
        (s) => s,
      )
      expect(stats).toBeTruthy()
      expect(stats?.userId).toBe("user1")
      expect(stats?.attached).toBe(false)
    })

    test("should list no users when cache is empty", () => {
      const result = pond.listUsers()

      expect(result.users.toArray()).toEqual([])
      expect(result.count).toBe(0)
      expect(result.maxActiveUsers).toBe(3)
      expect(result.utilizationPercent).toBe(0)
    })

    test("should list cached users", async () => {
      // Attach some users
      await pond.query("user1", "SELECT 1")
      await pond.query("user2", "SELECT 1")

      const result = pond.listUsers()

      expect(result.count).toBe(2)
      expect(result.maxActiveUsers).toBe(3)
      expect(result.utilizationPercent).toBeCloseTo(66.67, 1)

      // Verify users list contains both user IDs
      const userIds = result.users.toArray()
      expect(userIds).toContain("user1")
      expect(userIds).toContain("user2")
    })

    test("should reflect cache utilization correctly", async () => {
      // Detach all users first
      await pond.detachUser("user1")
      await pond.detachUser("user2")

      // Attach 3 users (at capacity)
      await pond.query("user1", "SELECT 1")
      await pond.query("user2", "SELECT 1")
      await pond.query("user3", "SELECT 1")

      const result = pond.listUsers()

      expect(result.count).toBe(3)
      expect(result.maxActiveUsers).toBe(3)
      expect(result.utilizationPercent).toBe(100)

      const userIds = result.users.toArray()
      expect(userIds).toHaveLength(3)
      expect(userIds).toContain("user1")
      expect(userIds).toContain("user2")
      expect(userIds).toContain("user3")
    })
  })

  describe("Query Execution", () => {
    let pond: DuckPond

    beforeAll(async () => {
      pond = new DuckPond({ memoryLimit: "1GB" })
      const result = await pond.init()
      if (result.isLeft()) {
        const error = result.fold(
          (err) => err,
          () => null,
        )
        console.error("Init failed:", error)
        throw new Error(`Init failed: ${error?.message}`)
      }
    })

    afterAll(async () => {
      await pond.close()
    })

    test("should execute simple query with Either", async () => {
      // Debug: check if pond is initialized
      console.log("Pond initialized?", pond["initialized"])

      const result = await pond.query<{ num: number }>("user1", "SELECT 42 as num")

      if (result.isLeft()) {
        const error = result.fold(
          (err) => err,
          () => null,
        )
        console.error("Query error:", error)
      }

      expect(result.isRight()).toBe(true)
      const rows = result.fold(
        () => [],
        (r) => r,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].num).toBe(42)
    })

    test("should handle query errors with Either", async () => {
      const result = await pond.query("user1", "SELECT * FROM nonexistent_table")

      expect(result.isLeft()).toBe(true)
      const error = result.fold(
        (err) => err,
        () => null,
      )
      expect(error).toBeTruthy()
      expect(error?.code).toBe(ErrorCode.QUERY_EXECUTION_ERROR)
      expect(error?.message).toBeTruthy()
    })

    test("should execute DDL statements", async () => {
      const result = await pond.execute("user1", "CREATE TEMP TABLE test (id INT, name VARCHAR)")

      expect(result.isRight()).toBe(true)
    })

    test("should support functype fold for error handling", async () => {
      const result = await pond.query<{ num: number }>("user1", "SELECT 1 as num")

      const value = result.fold(
        (error) => `Error: ${error.message}`,
        (rows) => `Success: ${rows[0].num}`,
      )

      expect(value).toBe("Success: 1")
    })
  })

  describe("Resource Management", () => {
    test("should detach users", async () => {
      const pond = new DuckPond({ memoryLimit: "1GB" })
      await pond.init()

      // Attach user
      await pond.query("user1", "SELECT 1")
      expect(pond.isAttached("user1")).toBe(true)

      // Detach user
      const result = await pond.detachUser("user1")
      expect(result.isRight()).toBe(true)
      expect(pond.isAttached("user1")).toBe(false)

      await pond.close()
    })

    test("should handle LRU eviction", async () => {
      const pond = new DuckPond({
        memoryLimit: "1GB",
        maxActiveUsers: 2,
      })
      await pond.init()

      // Attach 3 users (exceeds capacity of 2)
      await pond.query("user1", "SELECT 1")
      await pond.query("user2", "SELECT 1")
      await pond.query("user3", "SELECT 1")

      // user1 should have been evicted
      expect(pond.isAttached("user1")).toBe(false)
      expect(pond.isAttached("user2")).toBe(true)
      expect(pond.isAttached("user3")).toBe(true)

      await pond.close()
    })
  })

  describe("Functype Integration", () => {
    let pond: DuckPond

    beforeAll(async () => {
      pond = new DuckPond({ memoryLimit: "1GB" })
      await pond.init()
    })

    afterAll(async () => {
      await pond.close()
    })

    test("should use Option for safe null handling", async () => {
      const result = await pond.query<{ value: number | null }>(
        "user1",
        "SELECT NULL as value UNION ALL SELECT 42 as value",
      )

      expect(result.isRight()).toBe(true)
      const rows = result.fold(
        () => [],
        (r) => r,
      )
      expect(rows).toHaveLength(2)

      // First row has null
      expect(rows[0].value).toBeNull()

      // Second row has value
      expect(rows[1].value).toBe(42)
    })

    test("should chain Either operations", async () => {
      const result = await pond
        .query<{ num: number }>("user1", "SELECT 10 as num")
        .then((either) =>
          either.map((rows) => rows.map((row) => row.num * 2)).map((nums) => nums.reduce((a, b) => a + b, 0)),
        )

      expect(result.isRight()).toBe(true)
      const value = result.fold(
        () => 0,
        (v) => v,
      )
      expect(value).toBe(20)
    })
  })
})
