/**
 * Library exports for extending duckpond-mcp-server
 *
 * Use this module to create MCP servers that extend duckpond's capabilities.
 *
 * @example Using startServer with beforeStart hook (recommended)
 * ```typescript
 * import { startServer, getDefaultUserId } from "duckpond-mcp-server/lib"
 *
 * await startServer({
 *   options: {
 *     config: { dataDir: "~/data" },
 *     ui: { enabled: true, port: 4000, autoStartUser: getDefaultUserId() }
 *   },
 *   transport: "stdio",
 *   beforeStart: async ({ server, duckpond }) => {
 *     // Register custom tools before server starts
 *     server.addTool({ name: "my_tool", ... })
 *   }
 * })
 * ```
 *
 * @example Using createFastMCPServer for more control
 * ```typescript
 * import { createFastMCPServer } from "duckpond-mcp-server/lib"
 *
 * const { server, duckpond } = createFastMCPServer({
 *   config: { dataDir: "~/data" },
 *   port: 3000,
 * })
 *
 * // Add your custom tools to the server
 * server.addTool({ name: "my_tool", ... })
 *
 * // Start the server manually
 * await server.start({ transportType: "stdio" })
 * ```
 */

// Server creation and startup
export type { BearerTokenConfig, FastMCPServerOptions, StartServerOptions } from "./server.js"
export { createFastMCPServer, startServer } from "./server.js"

// Core DuckPond server
export type { DuckPondServerConfig } from "./server-core.js"
export { DuckPondServer } from "./server-core.js"

// Utilities
export { getDefaultUserId } from "./tools/index.js"
