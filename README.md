# DuckPond

[![Node.js CI](https://github.com/jordanburke/duckpond/actions/workflows/node.js.yml/badge.svg)](https://github.com/jordanburke/duckpond/actions/workflows/node.js.yml)
[![CodeQL](https://github.com/jordanburke/duckpond/actions/workflows/codeql.yml/badge.svg)](https://github.com/jordanburke/duckpond/actions/workflows/codeql.yml)

Multi-tenant DuckDB manager with R2/S3 storage and functional programming patterns.

## Features

- 🏢 **Multi-Tenant Isolation** - Per-user database instances with automatic resource management
- ☁️ **Cloud Storage** - Native Cloudflare R2 and AWS S3 integration
- 🛡️ **Type-Safe Functional Programming** - Built with [functype](https://github.com/jordanburke/functype) for robust error handling
- 🚀 **LRU Caching** - Intelligent caching with automatic eviction of idle users
- 📊 **Storage Strategies** - Flexible parquet, duckdb, or hybrid storage options
- 🔧 **TypeScript-First** - Full type safety with comprehensive TypeScript declarations

## Installation

```bash
npm install duckpond
# or
pnpm add duckpond
```

## Quick Start

```typescript
import { DuckPond } from "duckpond"

// Configure with Cloudflare R2
const pond = new DuckPond({
  r2: {
    accountId: process.env.R2_ACCOUNT_ID!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucket: "my-bucket",
  },
  maxActiveUsers: 10,
})

// Initialize
await pond.init()

// Query with functional error handling
const result = await pond.query("user123", "SELECT * FROM orders")
result.fold(
  (error) => console.error("Query failed:", error.message),
  (rows) => console.log("Results:", rows),
)

// Cleanup
await pond.close()
```

## Core Concepts

### Functional Error Handling

DuckPond uses [functype](https://github.com/jordanburke/functype) for type-safe error handling without exceptions:

```typescript
import { Either } from "duckpond"

// All operations return Either<Error, Success>
const result = await pond.query<{ id: number; name: string }>("user123", "SELECT * FROM users")

// Pattern match on success/failure
result.fold(
  (error) => {
    // Handle error case
    console.error(`[${error.code}] ${error.message}`)
    if (error.cause) console.error("Caused by:", error.cause)
  },
  (rows) => {
    // Handle success case
    rows.forEach((user) => console.log(`${user.id}: ${user.name}`))
  },
)

// Or check explicitly
if (result.isLeft()) {
  const error = result.fold(
    (err) => err,
    () => null,
  )
  // Handle error
} else {
  const rows = result.fold(
    () => [],
    (data) => data,
  )
  // Process rows
}
```

### Multi-Tenant Isolation

Each user gets an isolated database instance:

```typescript
// User A's queries don't affect User B
await pond.query("userA", "CREATE TABLE orders (id INT)")
await pond.query("userB", "SELECT * FROM orders") // Error: table doesn't exist

// Check user status
const isActive = pond.isAttached("userA") // true if cached

// Get user statistics
const stats = await pond.getUserStats("userA")
stats.fold(
  (error) => console.error(error.message),
  (info) => console.log(`User: ${info.userId}, Last access: ${info.lastAccess}`),
)
```

### Storage Strategies

DuckPond supports multiple storage strategies:

```typescript
// Parquet files (default) - best for analytics
const pond = new DuckPond({
  r2: {
    /* ... */
  },
  strategy: "parquet",
})

// DuckDB files - full database persistence
const pond = new DuckPond({
  r2: {
    /* ... */
  },
  strategy: "duckdb",
})

// Hybrid - mix both approaches
const pond = new DuckPond({
  r2: {
    /* ... */
  },
  strategy: "hybrid",
})
```

## API Reference

### DuckPond Class

#### `constructor(config: DuckPondConfig)`

Creates a new DuckPond instance.

```typescript
const pond = new DuckPond({
  // R2 Configuration (Cloudflare)
  r2: {
    accountId: string
    accessKeyId: string
    secretAccessKey: string
    bucket: string
  },

  // OR S3 Configuration (AWS)
  s3: {
    region: string
    accessKeyId: string
    secretAccessKey: string
    bucket: string
    endpoint?: string  // For S3-compatible services
  },

  // Optional settings
  memoryLimit: '4GB',        // DuckDB memory limit
  threads: 4,                // Number of threads
  maxActiveUsers: 10,        // LRU cache size
  evictionTimeout: 300000,   // Idle timeout (5 min)
  cacheType: 'disk',         // 'disk' | 'memory' | 'noop'
  strategy: 'parquet'        // 'parquet' | 'duckdb' | 'hybrid'
})
```

#### `async init(): AsyncDuckPondResult<void>`

Initialize DuckPond. Must be called before any operations.

```typescript
const result = await pond.init()
result.fold(
  (error) => console.error("Initialization failed:", error.message),
  () => console.log("Ready!"),
)
```

#### `async query<T>(userId: string, sql: string): AsyncDuckPondResult<T[]>`

Execute a SQL query for a specific user.

```typescript
const result = await pond.query<{ id: number; total: number }>(
  "user123",
  "SELECT id, SUM(amount) as total FROM orders GROUP BY id",
)
```

#### `async execute(userId: string, sql: string): AsyncDuckPondResult<void>`

Execute SQL without returning results (DDL, DML).

```typescript
await pond.execute(
  "user123",
  `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name VARCHAR,
    price DECIMAL(10,2)
  )
`,
)
```

#### `async getUserStats(userId: string): AsyncDuckPondResult<UserStats>`

Get statistics about a user's database.

```typescript
const result = await pond.getUserStats("user123")
result.fold(
  (error) => console.error(error.message),
  (stats) =>
    console.log({
      userId: stats.userId,
      attached: stats.attached,
      lastAccess: stats.lastAccess,
      memoryUsage: stats.memoryUsage,
    }),
)
```

#### `isAttached(userId: string): boolean`

Check if a user is currently cached.

```typescript
if (pond.isAttached("user123")) {
  console.log("User database is active")
}
```

#### `async detachUser(userId: string): AsyncDuckPondResult<void>`

Manually detach a user's database from the cache.

```typescript
await pond.detachUser("user123")
```

#### `async close(): AsyncDuckPondResult<void>`

Close DuckPond and cleanup all resources.

```typescript
await pond.close()
```

### Error Codes

```typescript
import { ErrorCode } from "duckpond"

ErrorCode.CONNECTION_FAILED
ErrorCode.R2_CONNECTION_ERROR
ErrorCode.S3_CONNECTION_ERROR
ErrorCode.USER_NOT_FOUND
ErrorCode.QUERY_EXECUTION_ERROR
ErrorCode.QUERY_TIMEOUT
ErrorCode.MEMORY_LIMIT_EXCEEDED
ErrorCode.STORAGE_ERROR
ErrorCode.INVALID_CONFIG
ErrorCode.NOT_INITIALIZED
ErrorCode.UNKNOWN_ERROR
```

## Examples

### AWS S3 Configuration

```typescript
const pond = new DuckPond({
  s3: {
    region: "us-east-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    bucket: "my-duckdb-bucket",
  },
})
```

### MinIO or S3-Compatible Storage

```typescript
const pond = new DuckPond({
  s3: {
    region: "us-east-1",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    bucket: "duckdb",
    endpoint: "http://localhost:9000",
  },
})
```

### Advanced Error Handling

```typescript
import { ErrorCode } from "duckpond"

const result = await pond.query("user123", "SELECT * FROM orders")

result.fold(
  (error) => {
    switch (error.code) {
      case ErrorCode.QUERY_EXECUTION_ERROR:
        console.error("SQL error:", error.message)
        if (error.context?.sql) {
          console.error("Query:", error.context.sql)
        }
        break

      case ErrorCode.USER_NOT_FOUND:
        console.error("User not found:", error.context?.userId)
        break

      case ErrorCode.MEMORY_LIMIT_EXCEEDED:
        console.error("Out of memory:", error.context?.limit)
        break

      default:
        console.error("Unexpected error:", error)
    }
  },
  (rows) => {
    console.log(`Fetched ${rows.length} rows`)
  },
)
```

### Using Functype Utilities

```typescript
import { Option, List } from "duckpond"

// Safe null handling with Option
const maybeUser = Option(user)
const userName = maybeUser.map((u) => u.name).orElse("Anonymous")

// Immutable collections with List
const users = List([
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
])

const names = users
  .map((u) => u.name)
  .filter((name) => name.startsWith("A"))
  .toArray()
```

## Development

### Pre-Checkin Command

```bash
pnpm validate  # 🚀 Format, lint, test, and build
```

### Individual Commands

```bash
# Formatting
pnpm format        # Format code with Prettier
pnpm format:check  # Check formatting without writing

# Linting
pnpm lint          # Fix ESLint issues
pnpm lint:check    # Check ESLint issues without fixing

# Testing
pnpm test          # Run tests once
pnpm test:watch    # Run tests in watch mode
pnpm test:coverage # Run tests with coverage
pnpm test:ui       # Launch Vitest UI

# Building
pnpm build         # Production build
pnpm dev           # Development mode with watch
```

## Architecture

```
┌─────────────────────────────────────────┐
│           DuckPond Manager              │
│  - User isolation & lifecycle           │
│  - Connection pooling                   │
│  - Functional error handling            │
└──────────────┬──────────────────────────┘
               │
       ┌───────┴────────┐
       │   LRU Cache    │
       │  - Max active  │
       │  - Auto-evict  │
       └───────┬────────┘
               │
       ┌───────▼────────┐
       │  DuckDB Inst   │
       │  - Per-user DB │
       │  - R2/S3 mount │
       └───────┬────────┘
               │
       ┌───────▼────────┐
       │ Cloud Storage  │
       │ - R2 / S3      │
       │ - Parquet files│
       └────────────────┘
```

### Key Components

- **DuckPond**: Main manager class handling user lifecycle and queries
- **LRUCache**: Generic LRU cache with functype Option/List integration
- **Error Utilities**: Functional error creation and handling with Either
- **Types**: Comprehensive TypeScript definitions for all APIs

## Contributing

Contributions are welcome! Please ensure:

1. All tests pass: `pnpm test`
2. Code is formatted: `pnpm format`
3. No lint errors: `pnpm lint:check`
4. Build succeeds: `pnpm build`

Or simply run: `pnpm validate`

## License

MIT - see LICENSE file for details

---

Built with [functype](https://github.com/jordanburke/functype) for functional TypeScript
