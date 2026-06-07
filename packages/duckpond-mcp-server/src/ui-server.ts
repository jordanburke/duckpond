import { serve } from "@hono/node-server"
import { Hono } from "hono"

import type { DuckPondServer } from "./server-core"
import { loggers } from "./utils/logger"

const log = loggers.core

export type UIServerOptions = {
  port: number
  duckpond: DuckPondServer
}

/**
 * Start a lightweight HTTP server for UI access in stdio mode
 * This allows starting DuckDB UI even when MCP is running over stdio
 */
export async function startUIServer(options: UIServerOptions): Promise<void> {
  const { port, duckpond } = options
  const uiInternalPort = duckpond.getUIPort()

  const app = new Hono()

  // GET /ui - Info endpoint
  app.get("/ui", (c) => {
    const currentUser = duckpond.getCurrentUIUser()
    const listResult = duckpond.listUsers()
    return c.json({
      message: currentUser
        ? `UI active for user: ${currentUser}. Access directly at http://localhost:${uiInternalPort}`
        : "No UI active. Visit /ui/:userId to start DuckDB UI for a user.",
      currentUser,
      uiUrl: currentUser ? `http://localhost:${uiInternalPort}` : null,
      availableUsers: listResult.success ? listResult.data.users : [],
    })
  })

  // GET /ui/:userId - Start UI for a specific user
  app.get("/ui/:userId", async (c) => {
    const userId = c.req.param("userId")

    log(`[UI Server] Starting UI for user: ${userId}`)
    const result = await duckpond.startUI(userId)

    if (!result.success) {
      return c.json(
        {
          error: "Failed to start UI",
          message: result.error.message,
          details: result.error.details,
        },
        500,
      )
    }

    return c.json({
      success: true,
      message: `UI started for user: ${userId}`,
      uiUrl: `http://localhost:${uiInternalPort}`,
      hint: "Access the DuckDB UI directly at the uiUrl above",
    })
  })

  // Root endpoint with info
  app.get("/", (c) => {
    const currentUser = duckpond.getCurrentUIUser()
    return c.json({
      name: "DuckPond UI Server",
      description: "Lightweight HTTP server for DuckDB UI access in stdio mode",
      currentUIUser: currentUser,
      uiUrl: currentUser ? `http://localhost:${uiInternalPort}` : null,
      endpoints: {
        startUI: `http://localhost:${port}/ui/:userId`,
        status: `http://localhost:${port}/ui`,
      },
    })
  })

  // Start the server
  serve({
    fetch: app.fetch,
    port,
  })

  log(`✓ UI server running at http://localhost:${port}/ui`)
  log(`  Visit http://localhost:${port}/ui/:userId to start DuckDB UI`)
  log(`  Then access DuckDB UI directly at http://localhost:${uiInternalPort}`)
}
