import type { DuckDBConnection } from "@duckdb/node-api"
import type { Either } from "functype/either"
import type { Option } from "functype/option"

/**
 * Configuration for DuckPond manager
 */
export interface DuckPondConfig {
  // R2 Configuration (Cloudflare)
  r2?: {
    accountId: string
    accessKeyId: string
    secretAccessKey: string
    bucket: string
  }

  // S3 Configuration (AWS)
  s3?: {
    region: string
    accessKeyId: string
    secretAccessKey: string
    bucket: string
    endpoint?: string // For S3-compatible services
  }

  // DuckDB Settings
  memoryLimit?: string // Default: '4GB'
  threads?: number // Default: 4
  tempDir?: string // Default: '/tmp/duckpond'

  // Cache Settings
  maxActiveUsers?: number // Default: 10
  evictionTimeout?: number // Default: 300000 (5 min in ms)
  cacheType?: "disk" | "memory" | "noop" // Default: 'disk'
  cacheDir?: string // Default: '/tmp/duckpond-cache'

  // Storage Strategy
  strategy?: "parquet" | "duckdb" | "hybrid" // Default: 'parquet'
}

/**
 * Represents an active user database connection
 */
export interface UserDatabase {
  userId: string
  connection: DuckDBConnection
  lastAccess: Date
  attached: boolean
  memoryUsage?: number
}

/**
 * Statistics about a user's database
 */
export interface UserStats {
  userId: string
  attached: boolean
  lastAccess: Date
  memoryUsage: number
  storageUsage: number
  queryCount: number
}

/**
 * Database schema information
 */
export interface Schema {
  tables: TableSchema[]
}

export interface TableSchema {
  name: string
  columns: ColumnSchema[]
  rowCount?: number
}

export interface ColumnSchema {
  name: string
  type: string
  nullable: boolean
}

/**
 * Options for creating a new user
 */
export interface CreateUserOptions {
  template?: string
  initialData?: Record<string, unknown[]>
  metadata?: Record<string, unknown>
}

/**
 * Storage usage statistics
 */
export interface StorageStats {
  totalSize: number
  fileCount: number
  lastModified: Date
  files?: FileInfo[]
}

export interface FileInfo {
  path: string
  size: number
  modified: Date
}

/**
 * Query result with metadata
 */
export interface QueryResult<T = unknown> {
  rows: T[]
  rowCount: number
  executionTime: number
  columns: string[]
}

/**
 * Metrics for monitoring
 */
export interface DuckPondMetrics {
  activeUsers: number
  totalQueries: number
  avgQueryTime: number
  cacheHitRate: number
  memoryUsage: number
  storageUsage: number
}

/**
 * Events emitted by DuckPond
 */
export type DuckPondEvent =
  | { type: "user:attached"; userId: string; timestamp: Date }
  | { type: "user:detached"; userId: string; reason: "eviction" | "manual"; timestamp: Date }
  | { type: "query:executed"; userId: string; duration: number; timestamp: Date }
  | { type: "query:failed"; userId: string; error: string; timestamp: Date }
  | { type: "cache:hit"; userId: string }
  | { type: "cache:miss"; userId: string }
  | { type: "error"; error: Error; timestamp: Date }

/**
 * Type-safe result types using functype Either
 */
export type DuckPondResult<T> = Either<DuckPondError, T>
export type AsyncDuckPondResult<T> = Promise<Either<DuckPondError, T>>

/**
 * Error types
 */
export interface DuckPondError {
  code: ErrorCode
  message: string
  cause?: Error
  context?: Record<string, unknown>
}

export enum ErrorCode {
  // Connection errors
  CONNECTION_FAILED = "CONNECTION_FAILED",
  CONNECTION_TIMEOUT = "CONNECTION_TIMEOUT",
  R2_CONNECTION_ERROR = "R2_CONNECTION_ERROR",
  S3_CONNECTION_ERROR = "S3_CONNECTION_ERROR",

  // User errors
  USER_NOT_FOUND = "USER_NOT_FOUND",
  USER_ALREADY_EXISTS = "USER_ALREADY_EXISTS",
  USER_NOT_ATTACHED = "USER_NOT_ATTACHED",

  // Query errors
  QUERY_EXECUTION_ERROR = "QUERY_EXECUTION_ERROR",
  QUERY_TIMEOUT = "QUERY_TIMEOUT",
  INVALID_SQL = "INVALID_SQL",

  // Resource errors
  MEMORY_LIMIT_EXCEEDED = "MEMORY_LIMIT_EXCEEDED",
  STORAGE_ERROR = "STORAGE_ERROR",
  STORAGE_QUOTA_EXCEEDED = "STORAGE_QUOTA_EXCEEDED",

  // Configuration errors
  INVALID_CONFIG = "INVALID_CONFIG",
  NOT_INITIALIZED = "NOT_INITIALIZED",

  // Unknown
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

/**
 * Configuration with defaults applied
 */
export type ResolvedConfig = Required<
  Omit<DuckPondConfig, "r2" | "s3"> & {
    r2: DuckPondConfig["r2"]
    s3: DuckPondConfig["s3"]
  }
>
