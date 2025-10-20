import { type Either, Left, Right } from "functype"

import { DuckPondError, ErrorCode } from "../types"

/**
 * Create a DuckPondError as a Left Either
 */
export function createError(
  code: ErrorCode,
  message: string,
  cause?: Error,
  context?: Record<string, unknown>,
): Either<DuckPondError, never> {
  return Left({
    code,
    message,
    cause,
    context,
  })
}

/**
 * Wrap a value in a Right Either
 */
export function success<T = void>(value?: T): Either<DuckPondError, T extends void ? void : T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Right(value) as any
}

/**
 * Convert an unknown error to a DuckPondError
 */
export function toDuckPondError(error: unknown, defaultCode: ErrorCode = ErrorCode.UNKNOWN_ERROR): DuckPondError {
  if (error instanceof Error) {
    return {
      code: defaultCode,
      message: error.message,
      cause: error,
    }
  }

  return {
    code: defaultCode,
    message: String(error),
  }
}

/**
 * Error factory functions for common errors
 */
export const Errors = {
  connectionFailed: (message: string, cause?: Error) => createError(ErrorCode.CONNECTION_FAILED, message, cause),

  r2ConnectionError: (message: string, cause?: Error) => createError(ErrorCode.R2_CONNECTION_ERROR, message, cause),

  s3ConnectionError: (message: string, cause?: Error) => createError(ErrorCode.S3_CONNECTION_ERROR, message, cause),

  userNotFound: (userId: string) =>
    createError(ErrorCode.USER_NOT_FOUND, `User not found: ${userId}`, undefined, { userId }),

  userAlreadyExists: (userId: string) =>
    createError(ErrorCode.USER_ALREADY_EXISTS, `User already exists: ${userId}`, undefined, {
      userId,
    }),

  userNotAttached: (userId: string) =>
    createError(ErrorCode.USER_NOT_ATTACHED, `User not attached: ${userId}`, undefined, {
      userId,
    }),

  queryExecutionError: (message: string, sql?: string, cause?: Error) =>
    createError(ErrorCode.QUERY_EXECUTION_ERROR, message, cause, { sql }),

  queryTimeout: (timeoutMs: number) =>
    createError(ErrorCode.QUERY_TIMEOUT, `Query timeout after ${timeoutMs}ms`, undefined, {
      timeoutMs,
    }),

  memoryLimitExceeded: (limit: string) =>
    createError(ErrorCode.MEMORY_LIMIT_EXCEEDED, `Memory limit exceeded: ${limit}`, undefined, {
      limit,
    }),

  storageError: (message: string, cause?: Error) => createError(ErrorCode.STORAGE_ERROR, message, cause),

  invalidConfig: (message: string) => createError(ErrorCode.INVALID_CONFIG, message),

  notInitialized: () => createError(ErrorCode.NOT_INITIALIZED, "DuckPond not initialized. Call init() first."),
}

/**
 * Format an error for logging
 */
export function formatError(error: DuckPondError): string {
  const parts = [`[${error.code}] ${error.message}`]

  if (error.cause) {
    parts.push(`  Caused by: ${error.cause.message}`)
  }

  if (error.context) {
    parts.push(`  Context: ${JSON.stringify(error.context)}`)
  }

  return parts.join("\n")
}
