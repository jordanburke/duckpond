import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api"
import { Either, Left, Right } from "functype"
import { Option } from "functype"
import { Try } from "functype"

import { LRUCache } from "./cache/LRUCache"
import type {
  AsyncDuckPondResult,
  CreateUserOptions,
  DuckPondConfig,
  DuckPondResult,
  ListUsersResult,
  ResolvedConfig,
  Schema,
  UserDatabase,
  UserStats,
} from "./types"
import { ErrorCode } from "./types"
import { Errors, success, toDuckPondError } from "./utils/errors"
import { loggers } from "./utils/logger"

const log = loggers.main

/**
 * DuckPond - Multi-tenant DuckDB manager with R2/S3 storage
 *
 * Manages per-user DuckDB instances with:
 * - LRU caching for active users
 * - R2/S3 object storage integration
 * - Functional error handling with functype Either
 * - Automatic resource cleanup
 *
 * @example
 * ```typescript
 * const pond = new DuckPond({
 *   r2: {
 *     accountId: 'xxx',
 *     accessKeyId: 'yyy',
 *     secretAccessKey: 'zzz',
 *     bucket: 'my-bucket'
 *   }
 * })
 *
 * await pond.init()
 *
 * const result = await pond.query('user123', 'SELECT * FROM orders')
 * result.fold(
 *   error => console.error('Query failed:', error),
 *   rows => console.log('Results:', rows)
 * )
 * ```
 */
export class DuckPond {
  private instance: Option<DuckDBInstance> = Option.none()
  private cache: LRUCache<UserDatabase>
  private config: ResolvedConfig
  private evictionTimer: Option<NodeJS.Timeout> = Option.none()
  private initialized = false

  constructor(config: DuckPondConfig) {
    // Apply defaults
    this.config = {
      memoryLimit: config.memoryLimit || "4GB",
      threads: config.threads || 4,
      tempDir: config.tempDir || "/tmp/duckpond",
      maxActiveUsers: config.maxActiveUsers || 10,
      evictionTimeout: config.evictionTimeout || 300000,
      cacheType: config.cacheType || "disk",
      cacheDir: config.cacheDir || "/tmp/duckpond-cache",
      strategy: config.strategy || "parquet",
      r2: config.r2,
      s3: config.s3,
    }

    this.cache = new LRUCache(this.config.maxActiveUsers)

    log("DuckPond created with config:", {
      memoryLimit: this.config.memoryLimit,
      threads: this.config.threads,
      maxActiveUsers: this.config.maxActiveUsers,
      strategy: this.config.strategy,
    })
  }

  /**
   * Initialize DuckPond
   * Must be called before any other operations
   */
  async init(): AsyncDuckPondResult<void> {
    if (this.initialized) {
      log("Already initialized")
      return success(undefined)
    }

    log("Initializing DuckPond...")

    try {
      // Create DuckDB instance
      const instance = await DuckDBInstance.create(":memory:")
      this.instance = Option(instance)

      // Setup cloud storage
      const setupResult = await this.setupCloudStorage()
      if (setupResult.isLeft()) {
        const error = setupResult.fold(
          (err) => err,
          () => null,
        )
        throw new Error(error?.message || "Cloud storage setup failed")
      }

      // Start eviction timer
      this.startEvictionTimer()

      this.initialized = true
      log("DuckPond initialized successfully")
      return success(undefined)
    } catch (error) {
      return Left(toDuckPondError(error, ErrorCode.CONNECTION_FAILED))
    }
  }

  /**
   * Configure R2/S3 access and DuckDB extensions
   */
  private async setupCloudStorage(): AsyncDuckPondResult<void> {
    if (this.instance.isNone()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Errors.notInitialized() as any
    }

    const instance = this.instance.fold(
      () => {
        throw new Error("Unexpected: instance should be Some")
      },
      (inst) => inst,
    )

    const conn = await instance.connect()

    try {
      // Create secret for R2 or S3
      if (this.config.r2) {
        log("Configuring R2 access")
        await conn.run(`
          CREATE SECRET r2_secret (
            TYPE R2,
            ACCOUNT_ID '${this.config.r2.accountId}',
            ACCESS_KEY_ID '${this.config.r2.accessKeyId}',
            SECRET_ACCESS_KEY '${this.config.r2.secretAccessKey}'
          );
        `)
      } else if (this.config.s3) {
        log("Configuring S3 access")
        const endpoint = this.config.s3.endpoint ? `ENDPOINT '${this.config.s3.endpoint}',` : ""
        await conn.run(`
          CREATE SECRET s3_secret (
            TYPE S3,
            REGION '${this.config.s3.region}',
            ${endpoint}
            ACCESS_KEY_ID '${this.config.s3.accessKeyId}',
            SECRET_ACCESS_KEY '${this.config.s3.secretAccessKey}'
          );
        `)
      }

      // Install extensions only if R2/S3 is configured
      if (this.config.r2 || this.config.s3) {
        await conn.run(`
          INSTALL httpfs;
          LOAD httpfs;
          INSTALL cache_httpfs;
          LOAD cache_httpfs;
        `)

        // Configure cache
        await conn.run(`
          SET cache_httpfs_type='${this.config.cacheType}';
        `)
      }

      // Configure performance settings
      await conn.run(`
        SET memory_limit='${this.config.memoryLimit}';
        SET threads=${this.config.threads};
      `)

      log("Cloud storage configured successfully")
      return success(undefined)
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Errors.r2ConnectionError("Failed to setup cloud storage", error as Error) as any
    }
  }

  /**
   * Get a connection for a user
   * Loads from cache or attaches new database
   */
  async getUserConnection(userId: string): AsyncDuckPondResult<DuckDBConnection> {
    if (!this.initialized) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Errors.notInitialized() as any
    }

    // Check cache
    const cached = this.cache.get(userId)
    if (cached.isSome()) {
      log(`Using cached connection for user: ${userId}`)
      return cached.fold(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (): AsyncDuckPondResult<DuckDBConnection> => Errors.userNotFound(userId) as any,
        (userDb): AsyncDuckPondResult<DuckDBConnection> => Promise.resolve(success(userDb.connection)),
      )
    }

    log(`Loading database for user: ${userId}`)

    // Evict if at capacity
    if (this.cache.size() >= this.config.maxActiveUsers) {
      await this.evictLRU()
    }

    if (this.instance.isNone()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Errors.notInitialized() as any
    }

    const instance = this.instance.fold(
      () => {
        throw new Error("Unexpected: instance should be Some")
      },
      (inst) => inst,
    )

    const conn = await instance.connect()

    // Attach user's database (strategy-dependent)
    const attachResult = await this.attachUserDatabase(conn, userId)
    if (attachResult.isLeft()) {
      // Note: DuckDB connections are managed by the instance, no need to close
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return attachResult as any
    }

    // Add to cache
    this.cache.set(userId, {
      userId,
      connection: conn,
      lastAccess: new Date(),
      attached: true,
    })

    log(`Loaded database for user: ${userId}`)
    return success(conn)
  }

  /**
   * Attach a user's database based on storage strategy
   */
  private async attachUserDatabase(conn: DuckDBConnection, userId: string): AsyncDuckPondResult<void> {
    try {
      const bucket = this.config.r2?.bucket || this.config.s3?.bucket
      const protocol = this.config.r2 ? "r2" : "s3"

      if (this.config.strategy === "duckdb") {
        // Attach .duckdb file (read-only)
        const dbPath = `${protocol}://${bucket}/users/${userId}/database.duckdb`
        await conn.run(`ATTACH '${dbPath}' AS user_${userId} (READ_ONLY);`)
        log(`Attached .duckdb file for user: ${userId}`)
      }
      // For parquet strategy, no explicit attach needed
      return success(undefined)
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Errors.storageError("Failed to attach user database", error as Error) as any
    }
  }

  /**
   * Execute a SQL query for a user
   * Returns Either<Error, results>
   */
  async query<T = unknown>(userId: string, sql: string): AsyncDuckPondResult<T[]> {
    const connResult = await this.getUserConnection(userId)

    if (connResult.isLeft()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return connResult as any
    }

    const conn = connResult.fold(
      () => {
        throw new Error("Unexpected: connection should be Right")
      },
      (c) => c,
    )

    try {
      const resultObj = await conn.run(sql)
      // DuckDB node-api: use getRowObjects() to get rows as objects
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (await (resultObj as any).getRowObjects()) as T[]

      return success(rows)
    } catch (error) {
      return Left(toDuckPondError(error, ErrorCode.QUERY_EXECUTION_ERROR))
    }
  }

  /**
   * Execute SQL without returning results (DDL, DML)
   */
  async execute(userId: string, sql: string): AsyncDuckPondResult<void> {
    const connResult = await this.getUserConnection(userId)

    if (connResult.isLeft()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return connResult as any
    }

    const conn = connResult.fold(
      () => {
        throw new Error("Unexpected: connection should be Right")
      },
      (c) => c,
    )

    try {
      await conn.run(sql)
      return success(undefined)
    } catch (error) {
      return Left(toDuckPondError(error, ErrorCode.QUERY_EXECUTION_ERROR))
    }
  }

  /**
   * Detach a user's database and free resources
   */
  async detachUser(userId: string): AsyncDuckPondResult<void> {
    const cached = this.cache.get(userId)

    if (cached.isNone()) {
      log(`User not attached: ${userId}`)
      return success(undefined)
    }

    log(`Detaching user: ${userId}`)

    const userDb = cached.fold(
      () => {
        throw new Error("Unexpected: cached should be Some")
      },
      (db) => db,
    )

    try {
      if (this.config.strategy === "duckdb") {
        await userDb.connection.run(`DETACH user_${userId}`)
      }
      // Note: DuckDB connections don't have a close() method in node-api
      // They are managed by the instance
      this.cache.delete(userId)
      log(`Detached user: ${userId}`)
      return success(undefined)
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Errors.storageError("Failed to detach user", error as Error) as any
    }
  }

  /**
   * Evict the least recently used user
   */
  private async evictLRU(): Promise<void> {
    this.cache.getLRU().forEach(async (userId) => {
      log(`Evicting LRU user: ${userId}`)
      await this.detachUser(userId)
    })
  }

  /**
   * Start background timer to evict idle users
   */
  private startEvictionTimer(): void {
    const timer = setInterval(async () => {
      const staleUsers = this.cache.getStale(this.config.evictionTimeout)

      staleUsers.forEach(async (userId) => {
        log(`Evicting idle user: ${userId}`)
        await this.detachUser(userId)
      })
    }, 60000) // Check every minute

    // Don't keep process alive
    timer.unref()

    this.evictionTimer = Option(timer)
    log("Eviction timer started")
  }

  /**
   * Check if a user is currently attached
   */
  isAttached(userId: string): boolean {
    return this.cache.has(userId)
  }

  /**
   * Get statistics about a user's database
   */
  async getUserStats(userId: string): AsyncDuckPondResult<UserStats> {
    const cached = this.cache.get(userId)

    return success({
      userId,
      attached: cached.isSome(),
      lastAccess: cached.fold(
        () => new Date(0),
        (u) => u.lastAccess,
      ),
      memoryUsage: cached.fold(
        () => 0,
        (u) => u.memoryUsage || 0,
      ),
      storageUsage: 0, // TODO: Calculate from R2
      queryCount: 0, // TODO: Track queries
    })
  }

  /**
   * Get list of all currently cached users
   * Returns a List of user IDs and cache statistics
   */
  listUsers(): ListUsersResult {
    const stats = this.cache.getStats()
    const keys = this.cache.keys()

    return {
      users: keys, // Already returns List<string>
      count: stats.size,
      maxActiveUsers: stats.maxSize,
      utilizationPercent: stats.utilizationPercent,
    }
  }

  /**
   * Close DuckPond and cleanup all resources
   */
  async close(): AsyncDuckPondResult<void> {
    log("Closing DuckPond...")

    // Stop eviction timer
    this.evictionTimer.forEach((timer) => clearInterval(timer))

    // Detach all users
    const detachPromises = this.cache.keys().map((userId) => this.detachUser(userId.toString()))

    await Promise.all(detachPromises.toArray())

    // Close instance
    this.instance = Option.none()
    this.initialized = false
    log("DuckPond closed")
    return success(undefined)
  }
}
