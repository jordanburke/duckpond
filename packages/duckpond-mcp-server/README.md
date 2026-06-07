# DuckPond MCP Server

[![Node.js CI](https://github.com/jordanburke/duckpond-mcp-server/actions/workflows/node.js.yml/badge.svg)](https://github.com/jordanburke/duckpond-mcp-server/actions/workflows/node.js.yml)
[![CodeQL](https://github.com/jordanburke/duckpond-mcp-server/actions/workflows/codeql.yml/badge.svg)](https://github.com/jordanburke/duckpond-mcp-server/actions/workflows/codeql.yml)

**Model Context Protocol (MCP) server for multi-tenant DuckDB management with R2/S3 cloud storage.**

Built on top of the [duckpond](https://github.com/jordanburke/duckpond) library, this MCP server enables AI agents to manage per-user DuckDB databases with automatic cloud persistence.

## Features

- 🦆 **Multi-Tenant DuckDB** - Isolated databases per user with LRU caching
- ☁️ **Cloud Storage** - Seamless R2/S3 integration for persistence
- 🔌 **Dual Transport** - stdio (Claude Desktop) and HTTP (server deployments)
- 🔐 **Authentication** - OAuth 2.0 and Basic Auth support for HTTP
- 🎯 **MCP Tools** - Query, execute, stats, cache management
- 🖥️ **DuckDB UI** - Built-in web UI for database inspection and debugging
- 📊 **Type Safe** - Full TypeScript with functype error handling

## Quick Start

### Installation

```bash
# Global installation
npm install -g duckpond-mcp-server

# Or use directly with npx
npx duckpond-mcp-server
```

### Claude Desktop Setup (stdio)

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "duckpond": {
      "command": "npx",
      "args": ["-y", "duckpond-mcp-server"],
      "env": {
        "DUCKPOND_R2_ACCOUNT_ID": "your-account-id",
        "DUCKPOND_R2_ACCESS_KEY_ID": "your-access-key",
        "DUCKPOND_R2_SECRET_ACCESS_KEY": "your-secret-key",
        "DUCKPOND_R2_BUCKET": "your-bucket"
      }
    }
  }
}
```

### HTTP Server

```bash
# Start HTTP server on port 3000
npx duckpond-mcp-server --transport http

# With custom port
npx duckpond-mcp-server --transport http --port 8080
```

## Available MCP Tools

### `query`

Execute a SQL query for a specific user and return results.

**Input:**

```typescript
{
  userId: string // User identifier
  sql: string // SQL query to execute
}
```

**Output:**

```typescript
{
  rows: T[]              // Query results
  rowCount: number       // Number of rows
  executionTime: number  // Execution time in ms
}
```

### `execute`

Execute DDL/DML statements (CREATE, INSERT, UPDATE, DELETE) without returning results.

**Input:**

```typescript
{
  userId: string // User identifier
  sql: string // SQL statement to execute
}
```

**Output:**

```typescript
{
  success: boolean
  message: string
  executionTime: number
}
```

### `getUserStats`

Get statistics about a user's database.

**Input:**

```typescript
{
  userId: string // User identifier
}
```

**Output:**

```typescript
{
  userId: string
  attached: boolean // Is user currently cached?
  lastAccess: string // ISO 8601 timestamp
  memoryUsage: number // Bytes
  storageUsage: number // Bytes
  queryCount: number
}
```

### `isAttached`

Check if a user's database is currently cached in memory.

**Input:**

```typescript
{
  userId: string // User identifier
}
```

**Output:**

```typescript
{
  attached: boolean
  userId: string
}
```

### `detachUser`

Manually detach a user's database from the cache to free resources.

**Input:**

```typescript
{
  userId: string // User identifier
}
```

**Output:**

```typescript
{
  success: boolean
  message: string
}
```

## Configuration

### Environment Variables

#### DuckDB Settings

- `DUCKPOND_MEMORY_LIMIT` - Memory limit (default: `4GB`)
- `DUCKPOND_THREADS` - Number of threads (default: `4`)
- `DUCKPOND_CACHE_TYPE` - Cache type: `disk`, `memory`, `noop` (default: `disk`)

#### Storage Configuration

By default, DuckPond stores databases locally. For cloud deployments, configure R2 or S3.

**Local Storage (Default)**

```bash
# Databases stored in ~/.duckpond/data by default
# Customize with:
export DUCKPOND_DATA_DIR=/path/to/data

npx duckpond-mcp-server
```

**Cloudflare R2**

```bash
export DUCKPOND_R2_ACCOUNT_ID=your-account-id
export DUCKPOND_R2_ACCESS_KEY_ID=your-access-key
export DUCKPOND_R2_SECRET_ACCESS_KEY=your-secret-key
export DUCKPOND_R2_BUCKET=your-bucket

npx duckpond-mcp-server
```

**AWS S3**

```bash
export DUCKPOND_S3_REGION=us-east-1
export DUCKPOND_S3_ACCESS_KEY_ID=your-access-key
export DUCKPOND_S3_SECRET_ACCESS_KEY=your-secret-key
export DUCKPOND_S3_BUCKET=your-bucket

npx duckpond-mcp-server
```

**S3-Compatible (MinIO, etc.)**

```bash
export DUCKPOND_S3_REGION=us-east-1
export DUCKPOND_S3_ACCESS_KEY_ID=minioadmin
export DUCKPOND_S3_SECRET_ACCESS_KEY=minioadmin
export DUCKPOND_S3_BUCKET=duckpond
export DUCKPOND_S3_ENDPOINT=http://localhost:9000

npx duckpond-mcp-server
```

#### Multi-Tenant Settings

- `DUCKPOND_MAX_ACTIVE_USERS` - LRU cache size (default: `10`)
- `DUCKPOND_EVICTION_TIMEOUT` - Idle timeout in ms (default: `300000`)
- `DUCKPOND_STRATEGY` - Storage strategy: `parquet`, `duckdb`, `hybrid` (default: `duckdb`)
- `DUCKPOND_DATA_DIR` - Local data directory (default: `~/.duckpond/data`)

#### Cloudflare R2 Configuration

- `DUCKPOND_R2_ACCOUNT_ID` - R2 account ID
- `DUCKPOND_R2_ACCESS_KEY_ID` - R2 access key
- `DUCKPOND_R2_SECRET_ACCESS_KEY` - R2 secret key
- `DUCKPOND_R2_BUCKET` - R2 bucket name

#### AWS S3 Configuration

- `DUCKPOND_S3_REGION` - S3 region (e.g., `us-east-1`)
- `DUCKPOND_S3_ACCESS_KEY_ID` - S3 access key
- `DUCKPOND_S3_SECRET_ACCESS_KEY` - S3 secret key
- `DUCKPOND_S3_BUCKET` - S3 bucket name
- `DUCKPOND_S3_ENDPOINT` - Custom S3 endpoint (for MinIO, etc.)

### HTTP Transport Authentication

#### OAuth 2.0

```bash
export DUCKPOND_OAUTH_ENABLED=true
export DUCKPOND_OAUTH_USERNAME=admin
export DUCKPOND_OAUTH_PASSWORD=secret123
export DUCKPOND_OAUTH_USER_ID=admin-user
export DUCKPOND_OAUTH_EMAIL=admin@example.com

npx duckpond-mcp-server --transport http
```

**OAuth Endpoints:**

- `/oauth/authorize` - Authorization endpoint (login form)
- `/oauth/token` - Token endpoint (authorization_code & refresh_token)
- `/oauth/jwks` - JSON Web Key Set
- `/oauth/register` - Dynamic client registration

**Features:**

- Authorization code flow with PKCE (S256 & plain)
- Refresh token rotation
- JWT access tokens (configurable expiration)

#### Basic Authentication

```bash
export DUCKPOND_BASIC_AUTH_USERNAME=admin
export DUCKPOND_BASIC_AUTH_PASSWORD=secret123
export DUCKPOND_BASIC_AUTH_USER_ID=admin-user
export DUCKPOND_BASIC_AUTH_EMAIL=admin@example.com

npx duckpond-mcp-server --transport http
```

#### JWT Configuration

- `DUCKPOND_JWT_SECRET` - Secret for signing JWTs (auto-generated if not set)
- `DUCKPOND_JWT_EXPIRES_IN` - Token expiration in seconds (default: `31536000` = 1 year)

## HTTP Endpoints

### MCP Protocol

- `POST /mcp` - MCP protocol endpoint (Server-Sent Events)
  - Requires: `Accept: application/json, text/event-stream`
  - Initialize session, then call tools

### Server Information

- `GET /` - Server info and capabilities
- `GET /health` - Health check

### OAuth (when enabled)

- `GET /oauth/authorize` - Authorization endpoint
- `POST /oauth/token` - Token endpoint
- `GET /oauth/jwks` - JSON Web Key Set
- `POST /oauth/register` - Client registration

### DuckDB UI

- `GET /ui` - UI status and available users
- `GET /ui/:userId` - Start UI for specific user (returns URL for direct access)

## DuckDB UI

The MCP server includes built-in support for [DuckDB UI](https://duckdb.org/docs/stable/core_extensions/ui.html), allowing you to visually inspect and debug your database through a web browser.

### How It Works

With `DUCKPOND_DEFAULT_USER` set, the UI **auto-starts** when the server starts. Just open `http://localhost:4213` in your browser.

The UI runs on port 4213 because DuckDB UI requires specific browser features (SharedArrayBuffer) that work best with direct access.

### Claude Desktop Config (Recommended)

```json
{
  "mcpServers": {
    "duckpond": {
      "command": "npx",
      "args": ["-y", "duckpond-mcp-server", "--ui"],
      "env": {
        "DUCKPOND_DEFAULT_USER": "claude",
        "DUCKPOND_DATA_DIR": "${HOME}/.duckpond/data"
      }
    }
  }
}
```

The UI automatically starts for the default user. Open `http://localhost:4213` in your browser.

### HTTP Mode

```bash
# Start server
npx duckpond-mcp-server --transport http --port 3000

# Start UI for user "claude"
curl http://localhost:3000/ui/claude

# Access UI directly
# Browser: http://localhost:4213
```

### stdio Mode without Default User

If no `DUCKPOND_DEFAULT_USER` is set, a management server starts for manual user selection:

```bash
# Start with UI management server
npx duckpond-mcp-server --ui --ui-port 4000

# Start UI for a user
curl http://localhost:4000/ui/claude

# Access UI directly
# Browser: http://localhost:4213
```

### Docker

```bash
# Using docker-compose (recommended)
docker compose up -d

# Start UI for a user
curl http://localhost:3000/ui/claude

# Access UI directly
# Browser: http://localhost:4213
```

```bash
# Simple docker run
docker run -p 3000:3000 -p 4213:4213 duckpond-mcp-server

# Start UI for a user, then access directly
curl http://localhost:3000/ui/claude
# Browser: http://localhost:4213
```

**Why direct port access?** DuckDB UI uses SharedArrayBuffer which requires specific CORS headers. Direct access to port 4213 ensures full compatibility with the UI's WebAssembly requirements.

### UI Features

- **Database Explorer** - Browse schemas, tables, and columns
- **SQL Notebooks** - Execute queries with syntax highlighting
- **Table Summaries** - Row counts, data profiles, previews
- **Column Explorer** - Detailed column statistics and insights

### Switching Users (HTTP Mode)

In HTTP mode, navigate to `/ui/:differentUserId` to switch between users. Only one user's UI is active at a time - switching automatically stops the previous UI and starts for the new user.

### Environment Variables

- `DUCKPOND_DEFAULT_USER` - Default user ID; when set, UI auto-starts for this user
- `DUCKPOND_UI_ENABLED` - Enable UI (default: `false`, or use `--ui` flag)

### CLI Flags

- `--ui` - Enable DuckDB UI (auto-starts for `DUCKPOND_DEFAULT_USER`)
- `--ui-port <port>` - Management server port, only used when no default user (default: `4000`)
- `--ui-internal-port <port>` - DuckDB UI port (default: `4213`)

## Development

### Local Development

```bash
# Clone repository
git clone https://github.com/jordanburke/duckpond-mcp-server.git
cd duckpond-mcp-server

# Install dependencies
pnpm install

# Development mode (watch)
pnpm dev

# Run tests
pnpm test

# Format and lint
pnpm validate
```

### Testing the Server

```bash
# Test stdio transport
pnpm serve:test

# Test HTTP transport
pnpm serve:test:http

# Test with OAuth
DUCKPOND_OAUTH_ENABLED=true \
DUCKPOND_OAUTH_USERNAME=admin \
DUCKPOND_OAUTH_PASSWORD=secret \
pnpm serve:test:http

# Test with Basic Auth
DUCKPOND_BASIC_AUTH_USERNAME=admin \
DUCKPOND_BASIC_AUTH_PASSWORD=secret \
pnpm serve:test:http
```

### Development Commands

```bash
# Pre-checkin validation
pnpm validate      # format + lint + test + build

# Individual commands
pnpm format        # Format with Prettier
pnpm lint          # Fix ESLint issues
pnpm test          # Run tests
pnpm test:watch    # Run tests in watch mode
pnpm test:coverage # Run tests with coverage
pnpm build         # Production build
pnpm ts-types      # Check TypeScript types
```

## Architecture

### Library-First Design

The MCP server is a **thin transport layer** over the [duckpond](https://github.com/jordanburke/duckpond) library:

```
┌─────────────┐     ┌──────────────┐
│ stdio Mode  │     │  HTTP Mode   │
│ (index.ts)  │     │(FastMCP/3000)│
└──────┬──────┘     └──────┬───────┘
       │                   │
       └───────┬───────────┘
               │
       ┌───────▼────────┐
       │ MCP Tool Layer │  (server-core.ts)
       │ - Error mapping│
       │ - Result format│
       └───────┬────────┘
               │
       ┌───────▼────────┐
       │    DuckPond    │  npm: duckpond@^0.1.0
       │ - Multi-tenant │
       │ - LRU Cache    │
       │ - R2/S3        │
       │ - Either<E,T>  │
       └───────┬────────┘
               │
       ┌───────▼────────┐
       │ DuckDB + Cloud │
       └────────────────┘
```

### Key Components

- **`src/index.ts`** - CLI entry point, transport selection
- **`src/server-core.ts`** - DuckPond wrapper with MCP result types
- **`src/server-stdio.ts`** - stdio transport for Claude Desktop
- **`src/server-fastmcp.ts`** - HTTP transport with FastMCP
- **`src/tools/index.ts`** - MCP tool schemas and implementations

### Error Handling

Uses [functype](https://github.com/jordanburke/functype) for functional error handling:

```typescript
// DuckPond returns Either<Error, T>
const result = await pond.query(userId, sql)

// MCP server converts to MCPResult<T>
result.fold(
  (error) => ({ success: false, error: formatError(error) }),
  (data) => ({ success: true, data }),
)
```

## Use Cases

### Personal Analytics

Store per-user analytics data with automatic cloud backup:

```typescript
// User creates their own tables
await execute({
  userId: "user123",
  sql: "CREATE TABLE orders (id INT, total DECIMAL, date DATE)",
})

// Query their data
const result = await query({
  userId: "user123",
  sql: "SELECT SUM(total) FROM orders WHERE date > '2024-01-01'",
})
```

### Multi-User Applications

- Each user gets isolated DuckDB instance
- Automatic LRU eviction manages memory
- Cloud storage persists user data
- Fast queries with DuckDB's columnar engine

### Data Science Workflows

- Parquet file management
- Cloud data lake integration
- Complex analytical queries
- Per-user sandboxed environments

## Troubleshooting

### Server Won't Start

**Check DuckDB installation:**

```bash
npm list duckdb
```

**Verify environment variables:**

```bash
printenv | grep DUCKPOND
```

### Authentication Issues

**OAuth not working:**

- Verify `DUCKPOND_OAUTH_USERNAME` and `DUCKPOND_OAUTH_PASSWORD` are set
- Check browser console for errors
- Ensure redirect URIs match

**Basic Auth failing:**

- Verify credentials are set correctly
- Check `Authorization: Basic <base64>` header format
- Ensure username/password match environment variables

### Memory Issues

**Adjust memory limits:**

```bash
export DUCKPOND_MEMORY_LIMIT=8GB
export DUCKPOND_MAX_ACTIVE_USERS=5
```

**Monitor cache usage:**

```typescript
const stats = await getUserStats({ userId: "user123" })
console.log(`Memory: ${stats.memoryUsage} bytes`)
```

### Storage Issues

**R2/S3 connection errors:**

- Verify credentials are correct
- Check bucket exists and is accessible
- Test with AWS CLI: `aws s3 ls s3://your-bucket`

**Parquet file issues:**

- Ensure DuckDB parquet extension is loaded
- Check file permissions in storage bucket

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT

## Related Projects

- **[duckpond](https://github.com/jordanburke/duckpond)** - Core multi-tenant DuckDB library
- **[functype](https://github.com/jordanburke/functype)** - Functional programming utilities for TypeScript
- **[Model Context Protocol](https://modelcontextprotocol.io)** - MCP specification

## Support

- **Issues**: [GitHub Issues](https://github.com/jordanburke/duckpond-mcp-server/issues)
- **Discussions**: [GitHub Discussions](https://github.com/jordanburke/duckpond-mcp-server/discussions)
- **Documentation**: [docs/](./docs/)
