import { z } from "zod"

import type { DuckPondServer } from "../server-core"
import { loggers } from "../utils/logger"

const log = loggers.tools

/**
 * Get the default user ID from environment variable
 */
export function getDefaultUserId(): string | undefined {
  return process.env.DUCKPOND_DEFAULT_USER
}

/**
 * Resolve user ID from input or default
 * @throws Error if no user ID is available
 */
export function resolveUserId(inputUserId?: string): string {
  const userId = inputUserId || getDefaultUserId()
  if (!userId) {
    throw new Error(
      "userId is required. Either provide it in the request or set DUCKPOND_DEFAULT_USER environment variable.",
    )
  }
  return userId
}

/**
 * Zod schema for query tool
 */
export const querySchema = z.object({
  userId: z.string().min(1).optional().describe("User identifier (optional if DUCKPOND_DEFAULT_USER is set)"),
  sql: z.string().min(1).describe("SQL query to execute"),
})

/**
 * Zod schema for execute tool
 */
export const executeSchema = z.object({
  userId: z.string().min(1).optional().describe("User identifier (optional if DUCKPOND_DEFAULT_USER is set)"),
  sql: z.string().min(1).describe("SQL statement to execute (DDL/DML)"),
})

/**
 * Zod schema for getUserStats tool
 */
export const getUserStatsSchema = z.object({
  userId: z.string().min(1).optional().describe("User identifier (optional if DUCKPOND_DEFAULT_USER is set)"),
})

/**
 * Zod schema for isAttached tool
 */
export const isAttachedSchema = z.object({
  userId: z.string().min(1).optional().describe("User identifier (optional if DUCKPOND_DEFAULT_USER is set)"),
})

/**
 * Zod schema for detachUser tool
 */
export const detachUserSchema = z.object({
  userId: z.string().min(1).optional().describe("User identifier (optional if DUCKPOND_DEFAULT_USER is set)"),
})

/**
 * Zod schema for listUsers tool
 */
export const listUsersSchema = z.object({})

/**
 * Tool implementations for MCP server
 */
export const tools = {
  /**
   * Execute a SQL query for a user
   */
  async query(server: DuckPondServer, input: z.infer<typeof querySchema>) {
    const userId = resolveUserId(input.userId)
    log(`Tool: query for user ${userId}`)
    const result = await server.query(userId, input.sql)

    if (!result.success) {
      throw new Error(result.error.message)
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              rows: result.data,
              rowCount: result.data.length,
              executionTime: result.executionTime,
            },
            null,
            2,
          ),
        },
      ],
    }
  },

  /**
   * Execute DDL/DML statement
   */
  async execute(server: DuckPondServer, input: z.infer<typeof executeSchema>) {
    const userId = resolveUserId(input.userId)
    log(`Tool: execute for user ${userId}`)
    const result = await server.execute(userId, input.sql)

    if (!result.success) {
      throw new Error(result.error.message)
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              message: "Statement executed successfully",
              executionTime: result.executionTime,
            },
            null,
            2,
          ),
        },
      ],
    }
  },

  /**
   * Get user database statistics
   */
  async getUserStats(server: DuckPondServer, input: z.infer<typeof getUserStatsSchema>) {
    const userId = resolveUserId(input.userId)
    log(`Tool: getUserStats for user ${userId}`)
    const result = await server.getUserStats(userId)

    if (!result.success) {
      throw new Error(result.error.message)
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              ...result.data,
              lastAccess: result.data.lastAccess.toISOString(),
            },
            null,
            2,
          ),
        },
      ],
    }
  },

  /**
   * Check if user is attached
   */
  isAttached(server: DuckPondServer, input: z.infer<typeof isAttachedSchema>) {
    const userId = resolveUserId(input.userId)
    log(`Tool: isAttached for user ${userId}`)
    const result = server.isAttached(userId)

    if (!result.success) {
      throw new Error(result.error.message)
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              attached: result.data,
              userId,
            },
            null,
            2,
          ),
        },
      ],
    }
  },

  /**
   * Detach a user from cache
   */
  async detachUser(server: DuckPondServer, input: z.infer<typeof detachUserSchema>) {
    const userId = resolveUserId(input.userId)
    log(`Tool: detachUser for user ${userId}`)
    const result = await server.detachUser(userId)

    if (!result.success) {
      throw new Error(result.error.message)
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              message: `User ${userId} detached successfully`,
            },
            null,
            2,
          ),
        },
      ],
    }
  },

  /**
   * List all currently cached users
   */
  listUsers(server: DuckPondServer, _input: z.infer<typeof listUsersSchema>) {
    log("Tool: listUsers")
    const result = server.listUsers()

    if (!result.success) {
      throw new Error(result.error.message)
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result.data, null, 2),
        },
      ],
    }
  },
}
