import debug from "debug"

/**
 * Create a namespaced logger for DuckPond
 *
 * Usage:
 *   const log = createLogger('DuckPond')
 *   log('Initializing...')
 *
 * Enable with: DEBUG=duckpond:* node app.js
 */
export function createLogger(namespace: string): debug.Debugger {
  return debug(`duckpond:${namespace}`)
}

/**
 * Pre-configured loggers for different modules
 */
export const loggers = {
  main: createLogger("main"),
  cache: createLogger("cache"),
  connection: createLogger("connection"),
  query: createLogger("query"),
  storage: createLogger("storage"),
  metrics: createLogger("metrics"),
}
