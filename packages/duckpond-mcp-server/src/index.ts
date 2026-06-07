#!/usr/bin/env node

// Polyfill for Web Crypto API in Node.js environments
import { webcrypto } from "crypto"

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as Crypto
}

import { Command } from "commander"
import { createRequire } from "module"

import type { OAuthConfig } from "./server"
import { getDefaultUserId } from "./tools"

const require = createRequire(import.meta.url)
const packageJson = require("../package.json") as { version: string }
import { getConfigFromEnv } from "./config/path-resolver"
import { startServer } from "./server"
import { startUIServer } from "./ui-server"
import { loggers } from "./utils/logger"

const log = loggers.main

/**
 * Main CLI program
 */
const program = new Command()

program
  .name("duckpond-mcp-server")
  .description("MCP server for multi-tenant DuckDB management with R2/S3 storage")
  .version(packageJson.version)
  .option("-t, --transport <type>", "Transport mode: stdio or http", "stdio")
  .option("-p, --port <port>", "HTTP port (when using http transport)", "3000")
  .option("--ui", "Enable DuckDB UI (auto-starts for DUCKPOND_DEFAULT_USER)")
  .option("--ui-port <port>", "UI management server port, only used when no default user (default: 4000)", "4000")
  .option("--ui-internal-port <port>", "DuckDB UI port (default: 4213)", "4213")
  .action(async (options) => {
    try {
      const config = getConfigFromEnv()

      const defaultUser = getDefaultUserId()
      log(`Starting DuckPond MCP Server with ${options.transport} transport`)
      log("Configuration:", {
        memoryLimit: config.memoryLimit,
        threads: config.threads,
        maxActiveUsers: config.maxActiveUsers,
        strategy: config.strategy,
        dataDir: config.dataDir,
        tempDir: config.tempDir,
        cacheDir: config.cacheDir,
        cacheType: config.cacheType,
        hasR2: !!config.r2,
        hasS3: !!config.s3,
        defaultUser: defaultUser || "(not set)",
      })

      // Log storage mode
      if (config.r2) {
        console.error("☁️  Storage: Cloudflare R2")
      } else if (config.s3) {
        console.error("☁️  Storage: AWS S3")
      } else {
        console.error(`💾 Storage: Local disk (${config.dataDir})`)
      }

      if (defaultUser) {
        console.error(`👤 Default user: ${defaultUser}`)
      }

      // Load OAuth configuration from environment variables (for HTTP transport)
      let oauthConfig: OAuthConfig | undefined
      if (process.env.DUCKPOND_OAUTH_ENABLED === "true") {
        const username = process.env.DUCKPOND_OAUTH_USERNAME
        const password = process.env.DUCKPOND_OAUTH_PASSWORD

        if (!username || !password) {
          console.error("❌ OAuth enabled but DUCKPOND_OAUTH_USERNAME and DUCKPOND_OAUTH_PASSWORD are required")
          process.exit(1)
        }

        oauthConfig = {
          enabled: true,
          username,
          password,
          userId: process.env.DUCKPOND_OAUTH_USER_ID || username,
          email: process.env.DUCKPOND_OAUTH_EMAIL,
          issuer: process.env.DUCKPOND_OAUTH_ISSUER || `http://localhost:${parseInt(options.port) || 3000}`,
          resource: process.env.DUCKPOND_OAUTH_RESOURCE,
        }

        console.error("🔐 OAuth enabled with username/password authentication")
        console.error(`   Username: ${oauthConfig.username}`)
        console.error(`   User ID: ${oauthConfig.userId}`)
        console.error("   ✓ Login form will be shown at authorization endpoint")
      }

      // Load Basic Auth configuration from environment variables (for HTTP transport)
      let basicAuthConfig: { username: string; password: string; userId?: string; email?: string } | undefined
      if (process.env.DUCKPOND_BASIC_AUTH_USERNAME && process.env.DUCKPOND_BASIC_AUTH_PASSWORD) {
        basicAuthConfig = {
          username: process.env.DUCKPOND_BASIC_AUTH_USERNAME,
          password: process.env.DUCKPOND_BASIC_AUTH_PASSWORD,
          userId: process.env.DUCKPOND_BASIC_AUTH_USER_ID,
          email: process.env.DUCKPOND_BASIC_AUTH_EMAIL,
        }

        console.error("🔐 Basic authentication enabled")
        console.error(`   Username: ${basicAuthConfig.username}`)
        console.error(`   User ID: ${basicAuthConfig.userId || basicAuthConfig.username}`)
      }

      // Load Bearer Token configuration from environment variables
      let bearerTokenConfig: { token: string; userId?: string } | undefined
      if (process.env.DUCKPOND_BEARER_TOKEN) {
        bearerTokenConfig = {
          token: process.env.DUCKPOND_BEARER_TOKEN,
          userId: process.env.DUCKPOND_BEARER_TOKEN_USER_ID,
        }

        console.error("🔐 Bearer token authentication enabled")
        if (bearerTokenConfig.userId) {
          console.error(`   User ID: ${bearerTokenConfig.userId}`)
        }
      }

      // Parse UI options
      const uiEnabled = options.ui || process.env.DUCKPOND_UI_ENABLED === "true"
      const uiPort = parseInt(options.uiPort) || 4000
      const uiInternalPort = parseInt(options.uiInternalPort) || 4213

      if (uiEnabled && options.transport === "stdio") {
        if (defaultUser) {
          // Will auto-start UI for default user - show where to access it
          console.error(`🖥️  DuckDB UI will start at http://localhost:${uiInternalPort}`)
        } else {
          // No default user - management server needed
          console.error(`🖥️  UI management server at http://localhost:${uiPort}/ui`)
          console.error(`   Visit /ui/:userId to start DuckDB UI for a user`)
        }
      }

      // Start unified FastMCP server with appropriate transport
      if (options.transport === "stdio" || options.transport === "http") {
        await startServer(
          {
            config,
            port: parseInt(options.port) || 3000,
            endpoint: "/mcp",
            oauth: oauthConfig,
            basicAuth: basicAuthConfig,
            bearerToken: bearerTokenConfig,
            ui: uiEnabled
              ? {
                  enabled: true,
                  port: uiPort,
                  internalPort: uiInternalPort,
                  autoStartUser: defaultUser,
                }
              : undefined,
          },
          options.transport === "stdio" ? "stdio" : "http",
        )
      } else {
        log(`Unknown transport: ${options.transport}`)
        process.exit(1)
      }
    } catch (error) {
      log("Fatal error:", error)
      console.error("Fatal error:", error)
      process.exit(1)
    }
  })

program.parse()
