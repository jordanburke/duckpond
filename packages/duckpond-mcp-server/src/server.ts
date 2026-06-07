// Polyfill for Web Crypto API in Node.js environments
import { webcrypto } from "crypto"

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as Crypto
}

import { createHash, randomBytes } from "crypto"
import { FastMCP } from "fastmcp"
import { createRequire } from "module"

const require = createRequire(import.meta.url)
const packageJson = require("../package.json") as { version: string }
import * as jwt from "jsonwebtoken"
import { URL } from "url"
import { z } from "zod"

import { DuckPondServer, type DuckPondServerConfig } from "./server-core"
import {
  detachUserSchema,
  executeSchema,
  getDefaultUserId,
  getUserStatsSchema,
  isAttachedSchema,
  listUsersSchema,
  querySchema,
  resolveUserId,
} from "./tools"
import { startUIServer } from "./ui-server"
import { loggers } from "./utils/logger"

const log = loggers.fastmcp

export type OAuthConfig = {
  enabled: boolean
  username: string
  password: string
  userId: string
  email?: string
  issuer?: string
  resource?: string
}

export type BearerTokenConfig = {
  token: string
  userId?: string
}

export type FastMCPServerOptions = {
  config: DuckPondServerConfig
  port?: number
  endpoint?: string
  oauth?: OAuthConfig
  basicAuth?: {
    username: string
    password: string
    userId?: string
    email?: string
  }
  bearerToken?: BearerTokenConfig
  ui?: {
    enabled: boolean
    port: number
    internalPort?: number
    autoStartUser?: string
  }
}

// JWT secret for token signing/validation
const JWT_SECRET = process.env.DUCKPOND_JWT_SECRET || randomBytes(32).toString("hex")

// JWT token expiration configuration (default: 1 year)
const JWT_EXPIRES_IN = process.env.DUCKPOND_JWT_EXPIRES_IN
  ? parseInt(process.env.DUCKPOND_JWT_EXPIRES_IN, 10)
  : 365 * 24 * 60 * 60 // 1 year in seconds

// In-memory stores for OAuth flow
const authorizationCodes = new Map<
  string,
  {
    createdAt: number
    redirectUri?: string
    codeChallenge?: string
    codeChallengeMethod?: string
    userId: string
  }
>()

const refreshTokens = new Map<
  string,
  {
    createdAt: number
    userId: string
    email?: string
  }
>()

// AuthSession type for FastMCP authentication
type AuthSession = {
  userId: string
  email: string
  scope: string
  [key: string]: unknown // Allow additional properties
}

type OAuthClientRegistrationRequest = {
  grant_types?: string[]
  response_types?: string[]
  redirect_uris?: string[]
  token_endpoint_auth_method?: string
  client_name?: string
  scope?: string
}

type OAuthClientRegistrationResponse = {
  client_id: string
  client_secret: string
  client_id_issued_at: number
  client_secret_expires_at: number
  grant_types: string[]
  response_types: string[]
  redirect_uris: string[]
  token_endpoint_auth_method: string
  client_name?: string
  scope?: string
}

export function createFastMCPServer(options: FastMCPServerOptions): {
  server: FastMCP
  duckpond: DuckPondServer
} {
  log("🚀 Initializing FastMCP server...")

  // Create DuckPond server instance
  const duckpond = new DuckPondServer(options.config)

  // Build server configuration
  const baseConfig = {
    name: "duckpond",
    version: packageJson.version as `${number}.${number}.${number}`,
    health: {
      enabled: true,
      path: "/health",
      status: 200,
      message: JSON.stringify({
        status: "healthy",
        service: "duckpond-mcp-server",
        version: packageJson.version,
        timestamp: new Date().toISOString(),
      }),
    },
  }

  // Create server with authentication (OAuth, Basic Auth, Bearer Token, or none)
  const server =
    options.oauth?.enabled || options.basicAuth || options.bearerToken
      ? new FastMCP<AuthSession>({
          ...baseConfig,
          oauth: {
            enabled: true,
            authorizationServer: {
              issuer: options.oauth?.issuer || `http://localhost:${options.port || 3000}`,
              authorizationEndpoint: `${options.oauth?.issuer || `http://localhost:${options.port || 3000}`}/oauth/authorize`,
              tokenEndpoint: `${options.oauth?.issuer || `http://localhost:${options.port || 3000}`}/oauth/token`,
              jwksUri: `${options.oauth?.issuer || `http://localhost:${options.port || 3000}`}/oauth/jwks`,
              registrationEndpoint: `${options.oauth?.issuer || `http://localhost:${options.port || 3000}`}/oauth/register`,
              responseTypesSupported: ["code"],
              grantTypesSupported: ["authorization_code"],
              tokenEndpointAuthMethodsSupported: ["client_secret_post", "client_secret_basic"],
              codeChallengeMethodsSupported: ["S256", "plain"],
            },
            protectedResource: {
              resource:
                process.env.DUCKPOND_OAUTH_RESOURCE ||
                options.oauth?.resource ||
                `${options.oauth?.issuer || `http://localhost:${options.port || 3000}`}/mcp`,
              authorizationServers: [options.oauth?.issuer || `http://localhost:${options.port || 3000}`],
            },
          },
          authenticate: (request) => {
            const authHeader = request.headers?.authorization
            const baseUrl = options.oauth?.issuer || `http://localhost:${options.port || 3000}`

            // For OAuth-enabled servers, require authentication
            if (!authHeader) {
              if (options.oauth?.enabled) {
                // Return HTTP 401 with WWW-Authenticate header for proper OAuth discovery
                throw new Response(
                  JSON.stringify({
                    error: "unauthorized",
                    error_description: "Authorization required. Please authenticate via OAuth.",
                  }),
                  {
                    status: 401,
                    statusText: "Unauthorized",
                    headers: {
                      "Content-Type": "application/json",
                      "WWW-Authenticate": `Bearer realm="MCP", authorization_uri="${baseUrl}/oauth/authorize", resource="${baseUrl}/.well-known/oauth-protected-resource"`,
                    },
                  },
                )
              }

              // For non-OAuth servers, also require some form of auth
              throw new Response(
                JSON.stringify({
                  error: "unauthorized",
                  error_description: "Authorization required.",
                }),
                {
                  status: 401,
                  statusText: "Unauthorized",
                  headers: {
                    "Content-Type": "application/json",
                  },
                },
              )
            }

            // Handle Basic Authentication
            if (options.basicAuth && authHeader.startsWith("Basic ")) {
              const credentials = Buffer.from(authHeader.slice(6), "base64").toString("utf-8")
              const [username, password] = credentials.split(":")

              if (username === options.basicAuth.username && password === options.basicAuth.password) {
                return Promise.resolve({
                  userId: options.basicAuth.userId || username,
                  email: options.basicAuth.email || `${username}@example.com`,
                  scope: "read write",
                })
              } else {
                throw new Response(
                  JSON.stringify({
                    error: "unauthorized",
                    error_description: "Invalid username or password",
                  }),
                  {
                    status: 401,
                    statusText: "Unauthorized",
                    headers: {
                      "Content-Type": "application/json",
                      "WWW-Authenticate": `Basic realm="MCP"`,
                    },
                  },
                )
              }
            }

            // Handle static Bearer Token authentication
            if (options.bearerToken && authHeader.startsWith("Bearer ")) {
              const token = authHeader.slice(7)

              if (token === options.bearerToken.token) {
                return Promise.resolve({
                  userId: options.bearerToken.userId || "bearer-user",
                  email: "",
                  scope: "read write",
                })
              }

              // If bearer token is configured but doesn't match, and OAuth is not enabled, reject
              if (!options.oauth?.enabled) {
                throw new Response(
                  JSON.stringify({
                    error: "invalid_token",
                    error_description: "Invalid bearer token",
                  }),
                  {
                    status: 401,
                    statusText: "Unauthorized",
                    headers: {
                      "Content-Type": "application/json",
                      "WWW-Authenticate": `Bearer realm="MCP", error="invalid_token"`,
                    },
                  },
                )
              }

              // Fall through to OAuth JWT validation if OAuth is also enabled
            }

            // Handle Bearer Token (OAuth) - Validate JWT
            if (options.oauth?.enabled && authHeader.startsWith("Bearer ")) {
              const token = authHeader.slice(7) // Remove 'Bearer ' prefix

              try {
                // Verify JWT token
                const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload

                if (!decoded.sub || !decoded.iat || !decoded.exp) {
                  throw new Response(
                    JSON.stringify({
                      error: "invalid_token",
                      error_description: "Invalid token structure",
                    }),
                    {
                      status: 401,
                      statusText: "Unauthorized",
                      headers: {
                        "Content-Type": "application/json",
                        "WWW-Authenticate": `Bearer realm="MCP", error="invalid_token", error_description="Invalid token structure"`,
                      },
                    },
                  )
                }

                // Validate audience
                const expectedAudience = options.oauth?.resource || `${baseUrl}/mcp`
                if (decoded.aud && decoded.aud !== expectedAudience) {
                  throw new Response(
                    JSON.stringify({
                      error: "invalid_token",
                      error_description: "Token audience mismatch",
                    }),
                    {
                      status: 401,
                      statusText: "Unauthorized",
                      headers: {
                        "Content-Type": "application/json",
                        "WWW-Authenticate": `Bearer realm="MCP", error="invalid_token", error_description="Token audience mismatch"`,
                      },
                    },
                  )
                }

                // Return user info from JWT claims
                return Promise.resolve({
                  userId: decoded.sub,
                  email: (decoded.email as string) || "",
                  scope: (decoded.scope as string) || "read write",
                })
              } catch (error) {
                if (error instanceof Response) {
                  throw error // Re-throw our custom Response errors
                }

                throw new Response(
                  JSON.stringify({
                    error: "invalid_token",
                    error_description: "Invalid or expired token",
                  }),
                  {
                    status: 401,
                    statusText: "Unauthorized",
                    headers: {
                      "Content-Type": "application/json",
                      "WWW-Authenticate": `Bearer realm="MCP", error="invalid_token", error_description="Invalid or expired token"`,
                    },
                  },
                )
              }
            }

            throw new Response(
              JSON.stringify({
                error: "unauthorized",
                error_description: "Invalid authorization header format",
              }),
              {
                status: 401,
                statusText: "Unauthorized",
                headers: {
                  "Content-Type": "application/json",
                  "WWW-Authenticate": `Bearer realm="MCP", authorization_uri="${baseUrl}/oauth/authorize", resource="${baseUrl}/.well-known/oauth-protected-resource"`,
                },
              },
            )
          },
        })
      : new FastMCP(baseConfig)

  // DuckDB type-safe JSON serializer (handles BigInt and timestamp objects)
  const duckDBReplacer = (_key: string, value: unknown): unknown => {
    if (typeof value === "bigint") {
      // Convert to number if safe, otherwise string
      return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()
    }
    // Handle DuckDB timestamp objects {micros: bigint}
    if (value && typeof value === "object" && "micros" in value) {
      const micros = (value as { micros: bigint }).micros
      const ms = typeof micros === "bigint" ? Number(micros / 1000n) : Number(micros) / 1000
      return new Date(ms).toISOString()
    }
    return value
  }

  // Add query tool
  server.addTool({
    name: "query",
    description: "Execute a SQL query for a specific user and return results",
    parameters: querySchema,
    execute: async (args) => {
      try {
        const userId = resolveUserId(args.userId)
        const result = await duckpond.query(userId, args.sql)

        if (!result.success) {
          return `ERROR: ${result.error.message}`
        }

        return JSON.stringify(
          {
            rows: result.data,
            rowCount: result.data.length,
            executionTime: result.executionTime,
          },
          duckDBReplacer,
          2,
        )
      } catch (error) {
        log("Error in query tool:", error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        return `ERROR: ${JSON.stringify({ error: errorMessage }, null, 2)}`
      }
    },
  })

  // Add execute tool
  server.addTool({
    name: "execute",
    description: "Execute SQL statement (DDL/DML) for a specific user without returning results",
    parameters: executeSchema,
    execute: async (args) => {
      try {
        const userId = resolveUserId(args.userId)
        const result = await duckpond.execute(userId, args.sql)

        if (!result.success) {
          return `ERROR: ${result.error.message}`
        }

        return JSON.stringify(
          {
            success: true,
            message: "Statement executed successfully",
            executionTime: result.executionTime,
          },
          null,
          2,
        )
      } catch (error) {
        log("Error in execute tool:", error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        return `ERROR: ${JSON.stringify({ error: errorMessage }, null, 2)}`
      }
    },
  })

  // Add getUserStats tool
  server.addTool({
    name: "getUserStats",
    description: "Get statistics about a user's database (memory usage, query count, etc.)",
    parameters: getUserStatsSchema,
    execute: async (args) => {
      try {
        const userId = resolveUserId(args.userId)
        const result = await duckpond.getUserStats(userId)

        if (!result.success) {
          return `ERROR: ${result.error.message}`
        }

        return JSON.stringify(
          {
            ...result.data,
            lastAccess: result.data.lastAccess.toISOString(),
          },
          null,
          2,
        )
      } catch (error) {
        log("Error in getUserStats tool:", error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        return `ERROR: ${JSON.stringify({ error: errorMessage }, null, 2)}`
      }
    },
  })

  // Add isAttached tool
  server.addTool({
    name: "isAttached",
    description: "Check if a user's database is currently cached in memory",
    parameters: isAttachedSchema,
    execute: async (args) => {
      try {
        const userId = resolveUserId(args.userId)
        const result = duckpond.isAttached(userId)

        if (!result.success) {
          return `ERROR: ${result.error.message}`
        }

        return JSON.stringify(
          {
            attached: result.data,
            userId,
          },
          null,
          2,
        )
      } catch (error) {
        log("Error in isAttached tool:", error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        return `ERROR: ${JSON.stringify({ error: errorMessage }, null, 2)}`
      }
    },
  })

  // Add detachUser tool
  server.addTool({
    name: "detachUser",
    description: "Manually detach a user's database from the cache to free resources",
    parameters: detachUserSchema,
    execute: async (args) => {
      try {
        const userId = resolveUserId(args.userId)
        const result = await duckpond.detachUser(userId)

        if (!result.success) {
          return `ERROR: ${result.error.message}`
        }

        return JSON.stringify(
          {
            success: true,
            message: `User ${userId} detached successfully`,
          },
          null,
          2,
        )
      } catch (error) {
        log("Error in detachUser tool:", error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        return `ERROR: ${JSON.stringify({ error: errorMessage }, null, 2)}`
      }
    },
  })

  // Add listUsers tool
  server.addTool({
    name: "listUsers",
    description: "List all currently cached users and cache statistics",
    parameters: listUsersSchema,
    execute: async () => {
      try {
        const result = duckpond.listUsers()

        if (!result.success) {
          return `ERROR: ${result.error.message}`
        }

        return JSON.stringify(result.data, null, 2)
      } catch (error) {
        log("Error in listUsers tool:", error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        return `ERROR: ${JSON.stringify({ error: errorMessage }, null, 2)}`
      }
    },
  })

  // Add OAuth flow endpoints if OAuth is enabled
  if (options.oauth?.enabled) {
    setupOAuthEndpoints(server, options)
  }

  // Add root info endpoint using Hono
  const app = server.getApp()
  app.get("/", (c) => {
    const baseUrl = options.oauth?.issuer || `http://localhost:${options.port || 3000}`

    const serverInfo = {
      name: "DuckPond MCP Server",
      version: packageJson.version,
      description: "Model Context Protocol server for multi-tenant DuckDB with R2/S3 storage",
      service: "duckpond-mcp-server",
      capabilities: {
        tools: ["query", "execute", "getUserStats", "isAttached", "detachUser", "listUsers"],
        transports: ["stdio", "http"],
        authentication: {
          oauth: options.oauth?.enabled || false,
          basicAuth: !!options.basicAuth,
          bearerToken: !!options.bearerToken,
        },
      },
      endpoints: {
        mcp: `${baseUrl}${options.endpoint || "/mcp"}`,
        health: `${baseUrl}/health`,
        ui: `${baseUrl}/ui/:userId`,
        ...(options.oauth?.enabled && {
          oauth: {
            authorization: `${baseUrl}/oauth/authorize`,
            token: `${baseUrl}/oauth/token`,
            jwks: `${baseUrl}/oauth/jwks`,
            register: `${baseUrl}/oauth/register`,
          },
        }),
      },
      timestamp: new Date().toISOString(),
    }

    return c.json(serverInfo)
  })

  // Add UI endpoints for DuckDB UI access
  setupUIEndpoints(app, duckpond, options)

  log("✓ FastMCP server created")

  return { server, duckpond }
}

function setupOAuthEndpoints(server: FastMCP, options: FastMCPServerOptions): void {
  const app = server.getApp()

  // Clean up old codes and refresh tokens every minute
  setInterval(() => {
    const now = Date.now()
    // Clean authorization codes (10 minutes)
    for (const [code, data] of authorizationCodes.entries()) {
      if (now - data.createdAt > 600000) {
        authorizationCodes.delete(code)
      }
    }
    // Clean refresh tokens (30 days)
    for (const [token, data] of refreshTokens.entries()) {
      if (now - data.createdAt > 2592000000) {
        refreshTokens.delete(token)
      }
    }
  }, 60000)

  // OAuth Authorization Endpoint - Login Form
  app.get("/oauth/authorize", (c) => {
    const params = c.req.query()
    const responseType = params.response_type
    const redirectUri = params.redirect_uri
    const state = params.state
    const codeChallenge = params.code_challenge
    const codeChallengeMethod = params.code_challenge_method
    const clientId = params.client_id

    if (responseType !== "code") {
      return c.json(
        {
          error: "unsupported_response_type",
          error_description: "Only 'code' response type is supported",
        },
        400,
      )
    }

    if (!redirectUri) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "redirect_uri is required",
        },
        400,
      )
    }

    // Validate PKCE parameters if present
    if (codeChallenge) {
      if (!codeChallengeMethod || !["S256", "plain"].includes(codeChallengeMethod)) {
        return c.json(
          {
            error: "invalid_request",
            error_description: "Invalid code_challenge_method. Only 'S256' and 'plain' are supported",
          },
          400,
        )
      }
    }

    // Serve login form
    const loginForm = `
<!DOCTYPE html>
<html>
<head>
    <title>OAuth Login - DuckPond MCP Server</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 400px; margin: 100px auto; padding: 20px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input[type="text"], input[type="password"] { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; }
        button { width: 100%; padding: 12px; background: #007cba; color: white; border: none; border-radius: 4px; font-size: 16px; cursor: pointer; }
        button:hover { background: #005a87; }
        .app-info { background: #f5f5f5; padding: 15px; border-radius: 4px; margin-bottom: 20px; }
    </style>
</head>
<body>
    <div class="app-info">
        <h3>🔐 OAuth Authorization</h3>
        <p><strong>Application:</strong> ${clientId || "MCP Client"}</p>
        <p><strong>Permissions:</strong> Read and write access to DuckDB databases</p>
    </div>

    <form method="POST" action="/oauth/authorize">
        <input type="hidden" name="response_type" value="${responseType}">
        <input type="hidden" name="redirect_uri" value="${redirectUri}">
        <input type="hidden" name="state" value="${state || ""}">
        <input type="hidden" name="code_challenge" value="${codeChallenge || ""}">
        <input type="hidden" name="code_challenge_method" value="${codeChallengeMethod || ""}">
        <input type="hidden" name="client_id" value="${clientId || ""}">

        <div class="form-group">
            <label for="username">Username:</label>
            <input type="text" id="username" name="username" required>
        </div>

        <div class="form-group">
            <label for="password">Password:</label>
            <input type="password" id="password" name="password" required>
        </div>

        <button type="submit">Authorize Application</button>
    </form>
</body>
</html>`

    return c.html(loginForm)
  })

  // OAuth Authorization POST - Process Login
  app.post("/oauth/authorize", async (c) => {
    try {
      const body = await c.req.text()
      const params = new URLSearchParams(body)

      const username = params.get("username")
      const password = params.get("password")
      const redirectUri = params.get("redirect_uri")
      const state = params.get("state")
      const codeChallenge = params.get("code_challenge")
      const codeChallengeMethod = params.get("code_challenge_method")

      // Validate credentials
      if (username !== options.oauth?.username || password !== options.oauth?.password) {
        const errorForm = `
<!DOCTYPE html>
<html><head><title>Login Failed</title><style>body{font-family:Arial;max-width:400px;margin:100px auto;padding:20px;}.error{color:red;background:#fee;padding:10px;border-radius:4px;margin-bottom:15px;}</style></head>
<body><div class="error">❌ Invalid username or password</div><a href="javascript:history.back()">← Try Again</a></body></html>`
        return c.html(errorForm, 401)
      }

      // Generate authorization code
      const code = randomBytes(16).toString("hex")
      authorizationCodes.set(code, {
        createdAt: Date.now(),
        redirectUri: redirectUri || "",
        codeChallenge: codeChallenge || undefined,
        codeChallengeMethod: codeChallengeMethod || undefined,
        userId: options.oauth?.userId || username || "oauth-user",
      })

      // Redirect with authorization code
      const redirectUrl = new URL(redirectUri || "")
      redirectUrl.searchParams.set("code", code)
      if (state) {
        redirectUrl.searchParams.set("state", state)
      }

      return c.redirect(redirectUrl.toString(), 302)
    } catch {
      return c.json(
        {
          error: "invalid_request",
          error_description: "Failed to process authorization request",
        },
        400,
      )
    }
  })

  // OAuth Token Endpoint
  app.post("/oauth/token", async (c) => {
    const body = await c.req.text()
    const params = new URLSearchParams(body)
    const grantType = params.get("grant_type")
    const code = params.get("code")
    const redirectUri = params.get("redirect_uri")
    const codeVerifier = params.get("code_verifier")
    const refreshTokenParam = params.get("refresh_token")

    if (grantType === "refresh_token") {
      // Handle refresh token flow
      if (!refreshTokenParam) {
        return c.json(
          {
            error: "invalid_request",
            error_description: "refresh_token is required for refresh_token grant type",
          },
          400,
        )
      }

      const tokenData = refreshTokens.get(refreshTokenParam)
      if (!tokenData) {
        return c.json(
          {
            error: "invalid_grant",
            error_description: "Invalid or expired refresh token",
          },
          400,
        )
      }

      // Remove old refresh token (token rotation)
      refreshTokens.delete(refreshTokenParam)

      // Generate new JWT access token
      const accessTokenPayload = {
        sub: tokenData.userId,
        email: tokenData.email || "",
        scope: "read write",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + JWT_EXPIRES_IN,
        iss: options.oauth?.issuer || `http://localhost:${options.port || 3000}`,
        aud: options.oauth?.resource || `${options.oauth?.issuer || `http://localhost:${options.port || 3000}`}/mcp`,
      }

      // Generate new refresh token
      const newRefreshToken = randomBytes(32).toString("hex")
      refreshTokens.set(newRefreshToken, {
        createdAt: Date.now(),
        userId: tokenData.userId,
        email: tokenData.email,
      })

      const accessToken = jwt.sign(accessTokenPayload, JWT_SECRET)

      return c.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: JWT_EXPIRES_IN,
        scope: "read write",
        refresh_token: newRefreshToken,
      })
    }

    if (grantType !== "authorization_code") {
      return c.json(
        {
          error: "unsupported_grant_type",
          error_description: "Only 'authorization_code' and 'refresh_token' grant types are supported",
        },
        400,
      )
    }

    const codeData = authorizationCodes.get(code || "")
    if (!codeData) {
      return c.json(
        {
          error: "invalid_grant",
          error_description: "Invalid or expired authorization code",
        },
        400,
      )
    }

    // Validate redirect_uri matches
    if (codeData.redirectUri && codeData.redirectUri !== redirectUri) {
      return c.json(
        {
          error: "invalid_grant",
          error_description: "redirect_uri mismatch",
        },
        400,
      )
    }

    // Validate PKCE if code_challenge was provided
    if (codeData.codeChallenge) {
      if (!codeVerifier) {
        return c.json(
          {
            error: "invalid_grant",
            error_description: "code_verifier is required when code_challenge was used",
          },
          400,
        )
      }

      let expectedChallenge: string
      if (codeData.codeChallengeMethod === "S256") {
        expectedChallenge = createHash("sha256").update(codeVerifier).digest().toString("base64url")
      } else {
        // 'plain' method
        expectedChallenge = codeVerifier
      }

      if (expectedChallenge !== codeData.codeChallenge) {
        return c.json(
          {
            error: "invalid_grant",
            error_description: "Invalid code_verifier",
          },
          400,
        )
      }
    }

    // Remove used code
    authorizationCodes.delete(code!)

    // Generate JWT access token
    const accessTokenPayload = {
      sub: codeData.userId,
      email: options.oauth?.email || "",
      scope: "read write",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + JWT_EXPIRES_IN,
      iss: options.oauth?.issuer || `http://localhost:${options.port || 3000}`,
      aud: options.oauth?.resource || `${options.oauth?.issuer || `http://localhost:${options.port || 3000}`}/mcp`,
    }

    // Generate refresh token
    const refreshToken = randomBytes(32).toString("hex")
    refreshTokens.set(refreshToken, {
      createdAt: Date.now(),
      userId: codeData.userId,
      email: options.oauth?.email,
    })

    const accessToken = jwt.sign(accessTokenPayload, JWT_SECRET)

    return c.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: JWT_EXPIRES_IN,
      scope: "read write",
      refresh_token: refreshToken,
    })
  })

  // JWKS Endpoint
  app.get("/oauth/jwks", (c) => {
    return c.json({
      keys: [
        {
          kty: "oct", // Octet sequence for symmetric keys
          use: "sig",
          kid: "duckpond-hmac-key",
          alg: "HS256",
        },
      ],
    })
  })

  // Dynamic Client Registration
  app.post("/oauth/register", async (c) => {
    try {
      let registrationRequest: OAuthClientRegistrationRequest = {}

      try {
        const body = await c.req.text()
        if (body && body !== "[object Object]") {
          try {
            registrationRequest = JSON.parse(body) as OAuthClientRegistrationRequest
          } catch {
            const formData = Object.fromEntries(new URLSearchParams(body))
            registrationRequest = formData as OAuthClientRegistrationRequest
          }
        }
      } catch (parseError) {
        log("Error parsing request body:", parseError)
      }

      const clientId = `client-${randomBytes(8).toString("hex")}`
      const clientSecret = randomBytes(16).toString("hex")

      const response: OAuthClientRegistrationResponse = {
        client_id: clientId,
        client_secret: clientSecret,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_secret_expires_at: 0, // Never expires
        grant_types: registrationRequest.grant_types || ["authorization_code"],
        response_types: registrationRequest.response_types || ["code"],
        redirect_uris: registrationRequest.redirect_uris || [],
        token_endpoint_auth_method: registrationRequest.token_endpoint_auth_method || "client_secret_post",
      }

      if (registrationRequest.client_name) {
        response.client_name = registrationRequest.client_name
      }
      if (registrationRequest.scope) {
        response.scope = registrationRequest.scope
      }

      return c.json(response, 201)
    } catch (error) {
      return c.json(
        {
          error: "invalid_client_metadata",
          error_description:
            "Invalid client registration request: " + (error instanceof Error ? error.message : String(error)),
        },
        400,
      )
    }
  })

  log("✓ OAuth flow endpoints added")
}

function setupUIEndpoints(
  app: ReturnType<FastMCP["getApp"]>,
  duckpond: DuckPondServer,
  options: FastMCPServerOptions,
): void {
  const baseUrl = options.oauth?.issuer || `http://localhost:${options.port || 3000}`
  const uiInternalPort = duckpond.getUIPort()

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
      endpoints: {
        startUI: `${baseUrl}/ui/:userId`,
      },
    })
  })

  // GET /ui/:userId - Start UI for a specific user
  app.get("/ui/:userId", async (c) => {
    const userId = c.req.param("userId")

    log(`Starting UI for user: ${userId}`)
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

  log("✓ UI endpoints added")
}

export type StartServerOptions = {
  options: FastMCPServerOptions
  transport: "stdio" | "http"
  /** Hook called after DuckPond init but before server start - use to register custom tools */
  beforeStart?: (ctx: { server: FastMCP; duckpond: DuckPondServer }) => void | Promise<void>
}

/**
 * Start the DuckPond MCP server with full configuration
 *
 * @example
 * ```typescript
 * import { startServer, getDefaultUserId } from "duckpond-mcp-server/lib"
 *
 * await startServer({
 *   options: { config: { dataDir: "~/data" }, ui: { enabled: true, port: 4000, autoStartUser: "claude" } },
 *   transport: "stdio",
 *   beforeStart: async ({ server, duckpond }) => {
 *     // Register custom tools before server starts
 *     server.addTool({ name: "my_tool", ... })
 *   }
 * })
 * ```
 */
export async function startServer(opts: StartServerOptions): Promise<void>
/** @deprecated Use object form: startServer({ options, transport, beforeStart }) */
export async function startServer(options: FastMCPServerOptions, transport: "stdio" | "http"): Promise<void>
export async function startServer(
  optsOrOptions: StartServerOptions | FastMCPServerOptions,
  transportArg?: "stdio" | "http",
): Promise<void> {
  // Handle both old and new signatures
  const isNewSignature = "options" in optsOrOptions && "transport" in optsOrOptions
  const options = isNewSignature ? optsOrOptions.options : optsOrOptions
  const transport = isNewSignature ? optsOrOptions.transport : transportArg!
  const beforeStart = isNewSignature ? optsOrOptions.beforeStart : undefined

  const { server, duckpond } = createFastMCPServer(options)

  // Initialize DuckPond
  const initResult = await duckpond.init()
  if (!initResult.success) {
    throw new Error(`Failed to initialize DuckPond: ${initResult.error.message}`)
  }

  log("DuckPond initialized successfully")

  // Call beforeStart hook if provided (allows registering custom tools)
  if (beforeStart) {
    await beforeStart({ server, duckpond })
  }

  // Set UI internal port if configured
  if (options.ui?.internalPort) {
    duckpond.setUIPort(options.ui.internalPort)
  }

  // Start the server with appropriate transport
  if (transport === "stdio") {
    await server.start({
      transportType: "stdio",
    })
    log("✓ FastMCP server running with stdio transport")

    // Start UI if enabled in stdio mode
    if (options.ui?.enabled) {
      if (options.ui.autoStartUser) {
        // Auto-start UI directly for default user (no management server needed)
        log(`Auto-starting UI for user: ${options.ui.autoStartUser}`)
        const uiResult = await duckpond.startUI(options.ui.autoStartUser)
        if (uiResult.success) {
          console.error(`🖥️  DuckDB UI running at http://localhost:${duckpond.getUIPort()}`)
        } else {
          log(`Failed to auto-start UI: ${uiResult.error.message}`)
        }
      } else {
        // No default user - start management server for manual user selection
        await startUIServer({
          port: options.ui.port,
          duckpond,
        })
      }
    }
  } else {
    await server.start({
      transportType: "httpStream",
      httpStream: {
        port: options.port || 3000,
        endpoint: (options.endpoint || "/mcp") as `/${string}`,
      },
    })
    log(`✓ FastMCP server running on http://0.0.0.0:${options.port || 3000}${options.endpoint || "/mcp"}`)
    log("🔌 Connect with StreamableHTTPClientTransport")
  }

  // Handle cleanup on exit
  process.on("SIGINT", async () => {
    log("Received SIGINT, closing server...")
    await duckpond.close()
    process.exit(0)
  })

  process.on("SIGTERM", async () => {
    log("Received SIGTERM, closing server...")
    await duckpond.close()
    process.exit(0)
  })
}
