import debug from "debug"

/**
 * Debug loggers for different modules
 */
export const loggers = {
  core: debug("duckpond-mcp:core"),
  stdio: debug("duckpond-mcp:stdio"),
  fastmcp: debug("duckpond-mcp:fastmcp"),
  tools: debug("duckpond-mcp:tools"),
  main: debug("duckpond-mcp:main"),
}

/**
 * Create a custom logger
 */
export function createLogger(namespace: string) {
  return debug(`duckpond-mcp:${namespace}`)
}
