import type { Either } from "duckpond"
import { DuckPond, type DuckPondConfig, type ErrorCode, type ListUsersResult, type UserStats } from "duckpond"

import { loggers } from "./utils/logger"

const log = loggers.core

/**
 * Result type for MCP tool responses
 */
export type MCPResult<T> =
  | {
      success: true
      data: T
      executionTime?: number
    }
  | {
      success: false
      error: {
        code: string
        message: string
        details?: {
          originalCode?: ErrorCode
          context?: Record<string, unknown>
          cause?: string
        }
      }
    }

/**
 * Configuration for DuckPond MCP Server
 * Extends DuckPondConfig with server-specific options
 */
export type DuckPondServerConfig = DuckPondConfig & {
  /** Directory for persistent database storage (default: ~/.duckpond/data) */
  dataDir?: string
}

/**
 * Core DuckPond MCP Server
 *
 * Wraps DuckPond library with MCP-compatible result types
 */
export class DuckPondServer {
  private pond: DuckPond | null = null
  private initialized = false
  private currentUIUserId: string | null = null
  private uiInternalPort: number = 4213
  private uiKeepaliveTimer: ReturnType<typeof setInterval> | null = null
  private readonly UI_KEEPALIVE_INTERVAL = 30000 // 30 seconds

  constructor(private config: DuckPondServerConfig) {
    log("DuckPondServer created")
  }

  /**
   * Initialize the DuckPond instance
   */
  async init(): Promise<MCPResult<void>> {
    if (this.initialized) {
      log("Already initialized")
      return { success: true, data: undefined }
    }

    log("Initializing DuckPond...")
    const startTime = Date.now()

    this.pond = new DuckPond(this.config)
    const result = await this.pond.init()

    return this.handleEither(result, Date.now() - startTime)
  }

  /**
   * Execute a SQL query for a user
   */
  async query<T = unknown>(userId: string, sql: string): Promise<MCPResult<T[]>> {
    if (!this.pond) {
      return this.notInitializedError()
    }

    log(`Query for user ${userId}: ${sql.substring(0, 100)}...`)
    const startTime = Date.now()

    const result = await this.pond.query<T>(userId, sql)

    return this.handleEither(result, Date.now() - startTime)
  }

  /**
   * Execute DDL/DML without returning results
   */
  async execute(userId: string, sql: string): Promise<MCPResult<void>> {
    if (!this.pond) {
      return this.notInitializedError()
    }

    log(`Execute for user ${userId}: ${sql.substring(0, 100)}...`)
    const startTime = Date.now()

    const result = await this.pond.execute(userId, sql)

    return this.handleEither(result, Date.now() - startTime)
  }

  /**
   * Get statistics about a user's database
   */
  async getUserStats(userId: string): Promise<MCPResult<UserStats>> {
    if (!this.pond) {
      return this.notInitializedError()
    }

    log(`Getting stats for user ${userId}`)
    const startTime = Date.now()

    const result = await this.pond.getUserStats(userId)

    return this.handleEither(result, Date.now() - startTime)
  }

  /**
   * Check if a user is currently cached
   */
  isAttached(userId: string): MCPResult<boolean> {
    if (!this.pond) {
      return this.notInitializedError()
    }

    const attached = this.pond.isAttached(userId)
    log(`User ${userId} attached: ${attached}`)

    return {
      success: true,
      data: attached,
    }
  }

  /**
   * Manually detach a user from the cache
   */
  async detachUser(userId: string): Promise<MCPResult<void>> {
    if (!this.pond) {
      return this.notInitializedError()
    }

    log(`Detaching user ${userId}`)
    const startTime = Date.now()

    const result = await this.pond.detachUser(userId)

    return this.handleEither(result, Date.now() - startTime)
  }

  /**
   * List all currently cached users
   */
  listUsers(): MCPResult<{ users: string[]; count: number; maxActiveUsers: number; utilizationPercent: number }> {
    if (!this.pond) {
      return this.notInitializedError()
    }

    log("Listing cached users")
    const result = this.pond.listUsers()

    return {
      success: true,
      data: {
        users: result.users.toArray(), // Convert List<string> to string[]
        count: result.count,
        maxActiveUsers: result.maxActiveUsers,
        utilizationPercent: result.utilizationPercent,
      },
    }
  }

  /**
   * Close the DuckPond instance
   */
  async close(): Promise<MCPResult<void>> {
    if (!this.pond) {
      return { success: true, data: undefined }
    }

    log("Closing DuckPond...")
    const startTime = Date.now()

    // Stop UI server if running
    if (this.currentUIUserId) {
      await this.stopUI()
    }

    const result = await this.pond.close()
    this.initialized = false
    this.pond = null

    return this.handleEither(result, Date.now() - startTime)
  }

  /**
   * Start DuckDB UI for a specific user
   * Only one user's UI can be active at a time
   */
  async startUI(userId: string): Promise<MCPResult<{ port: number }>> {
    if (!this.pond) {
      return this.notInitializedError()
    }

    log(`Starting UI for user ${userId}`)
    const startTime = Date.now()

    // Stop existing UI if different user
    if (this.currentUIUserId && this.currentUIUserId !== userId) {
      log(`Stopping UI for previous user ${this.currentUIUserId}`)
      await this.stopUI()
    }

    // If already running for this user, just return success
    if (this.currentUIUserId === userId) {
      log(`UI already running for user ${userId}`)
      return {
        success: true,
        data: { port: this.uiInternalPort },
        executionTime: Date.now() - startTime,
      }
    }

    // Install and load UI extension
    const installResult = await this.execute(userId, "INSTALL ui; LOAD ui;")
    if (!installResult.success) {
      log(`Failed to install UI extension: ${installResult.error.message}`)
      return installResult as MCPResult<{ port: number }>
    }

    // Set the UI port
    const portResult = await this.execute(userId, `SET ui_local_port = ${this.uiInternalPort}`)
    if (!portResult.success) {
      log(`Failed to set UI port: ${portResult.error.message}`)
      return portResult as MCPResult<{ port: number }>
    }

    // Start the UI server (without opening browser)
    const startResult = await this.execute(userId, "CALL start_ui_server()")
    if (!startResult.success) {
      log(`Failed to start UI server: ${startResult.error.message}`)
      return startResult as MCPResult<{ port: number }>
    }

    this.currentUIUserId = userId
    this.startUIKeepalive(userId)
    log(`UI started for user ${userId} on port ${this.uiInternalPort}`)

    return {
      success: true,
      data: { port: this.uiInternalPort },
      executionTime: Date.now() - startTime,
    }
  }

  /**
   * Start keepalive timer to prevent UI user from being evicted
   */
  private startUIKeepalive(userId: string): void {
    this.stopUIKeepalive()
    log(`Starting UI keepalive for user ${userId}`)
    this.uiKeepaliveTimer = setInterval(async () => {
      if (this.pond && this.currentUIUserId === userId) {
        log(`UI keepalive ping for user ${userId}`)
        await this.pond.query(userId, "SELECT 1")
      }
    }, this.UI_KEEPALIVE_INTERVAL)
  }

  /**
   * Stop the keepalive timer
   */
  private stopUIKeepalive(): void {
    if (this.uiKeepaliveTimer) {
      log("Stopping UI keepalive")
      clearInterval(this.uiKeepaliveTimer)
      this.uiKeepaliveTimer = null
    }
  }

  /**
   * Stop the currently running DuckDB UI
   */
  async stopUI(): Promise<MCPResult<void>> {
    this.stopUIKeepalive()

    if (!this.currentUIUserId) {
      log("No UI running to stop")
      return { success: true, data: undefined }
    }

    if (!this.pond) {
      this.currentUIUserId = null
      return { success: true, data: undefined }
    }

    log(`Stopping UI for user ${this.currentUIUserId}`)
    const startTime = Date.now()

    const result = await this.execute(this.currentUIUserId, "CALL stop_ui_server()")
    const previousUser = this.currentUIUserId
    this.currentUIUserId = null

    if (result.success) {
      log(`UI stopped for user ${previousUser}`)
      return {
        success: true,
        data: undefined,
        executionTime: Date.now() - startTime,
      }
    }

    log(`Failed to stop UI: ${result.error.message}`)
    return result
  }

  /**
   * Get the user ID for the currently running UI
   */
  getCurrentUIUser(): string | null {
    return this.currentUIUserId
  }

  /**
   * Set the internal port for DuckDB UI
   */
  setUIPort(port: number): void {
    this.uiInternalPort = port
  }

  /**
   * Get the internal port for DuckDB UI
   */
  getUIPort(): number {
    return this.uiInternalPort
  }

  /**
   * Convert Either<Error, T> to MCPResult<T>
   */
  private handleEither<T>(
    result: Either<{ code: ErrorCode; message: string; cause?: Error; context?: Record<string, unknown> }, T>,
    executionTime: number,
  ): MCPResult<T> {
    return result.fold<MCPResult<T>>(
      (error) => ({
        success: false as const,
        error: {
          code: this.mapErrorCode(error.code),
          message: error.message,
          details: {
            originalCode: error.code,
            context: error.context,
            cause: error.cause?.message,
          },
        },
      }),
      (data) => ({
        success: true as const,
        data,
        executionTime,
      }),
    )
  }

  /**
   * Map DuckPond ErrorCode to MCP error code
   */
  private mapErrorCode(code: ErrorCode): string {
    const mapping: Record<ErrorCode, string> = {
      CONNECTION_FAILED: "SERVICE_UNAVAILABLE",
      CONNECTION_TIMEOUT: "TIMEOUT",
      R2_CONNECTION_ERROR: "SERVICE_UNAVAILABLE",
      S3_CONNECTION_ERROR: "SERVICE_UNAVAILABLE",
      USER_NOT_FOUND: "NOT_FOUND",
      USER_ALREADY_EXISTS: "ALREADY_EXISTS",
      USER_NOT_ATTACHED: "NOT_FOUND",
      QUERY_EXECUTION_ERROR: "INVALID_REQUEST",
      QUERY_TIMEOUT: "TIMEOUT",
      INVALID_SQL: "INVALID_REQUEST",
      MEMORY_LIMIT_EXCEEDED: "RESOURCE_EXHAUSTED",
      STORAGE_ERROR: "SERVICE_UNAVAILABLE",
      STORAGE_QUOTA_EXCEEDED: "RESOURCE_EXHAUSTED",
      INVALID_CONFIG: "INVALID_ARGUMENT",
      NOT_INITIALIZED: "FAILED_PRECONDITION",
      UNKNOWN_ERROR: "INTERNAL_ERROR",
    }

    return mapping[code] || "INTERNAL_ERROR"
  }

  /**
   * Helper for not initialized error
   */
  private notInitializedError<T>(): MCPResult<T> {
    return {
      success: false,
      error: {
        code: "FAILED_PRECONDITION",
        message: "DuckPond not initialized. Call init() first.",
      },
    }
  }
}
