/**
 * DuckPond - Multi-tenant DuckDB manager with R2/S3 storage
 *
 * @example
 * ```typescript
 * import { DuckPond } from 'duckpond'
 *
 * const pond = new DuckPond({
 *   r2: {
 *     accountId: process.env.R2_ACCOUNT_ID!,
 *     accessKeyId: process.env.R2_ACCESS_KEY_ID!,
 *     secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
 *     bucket: 'my-bucket'
 *   },
 *   maxActiveUsers: 10
 * })
 *
 * await pond.init()
 *
 * // Query with functype Either for safe error handling
 * const result = await pond.query('user123', 'SELECT * FROM orders')
 * result.fold(
 *   error => console.error('Failed:', error.message),
 *   rows => console.log('Success:', rows)
 * )
 *
 * await pond.close()
 * ```
 */

// Main class
export { DuckPond } from "./DuckPond"

// Types
export type {
  AsyncDuckPondResult,
  ColumnSchema,
  CreateUserOptions,
  DuckPondConfig,
  DuckPondError,
  DuckPondEvent,
  DuckPondMetrics,
  DuckPondResult,
  FileInfo,
  ListUsersResult,
  QueryResult,
  ResolvedConfig,
  Schema,
  StorageStats,
  TableSchema,
  UserDatabase,
  UserStats,
} from "./types"
export { ErrorCode } from "./types"

// Utilities
export { createError, Errors, formatError, success, toDuckPondError } from "./utils/errors"
export { createLogger, loggers } from "./utils/logger"

// Cache
export { LRUCache } from "./cache/LRUCache"

// Re-export functype for convenience
export { Either, Left, Right } from "functype/either"
export { List } from "functype/list"
export { Option } from "functype/option"
export { Try } from "functype/try"
