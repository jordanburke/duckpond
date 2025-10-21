# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**DuckPond** is a multi-tenant DuckDB manager with Cloudflare R2 and AWS S3 storage integration, built using functional programming patterns from the [functype](https://github.com/jordanburke/functype) library. It provides per-user database isolation with automatic resource management, LRU caching, and type-safe error handling using `Either<E, T>`.

### Key Technologies
- **DuckDB node-api** (v1.4.1-r.4): In-process analytical database
- **functype** (v0.16.0): Functional programming utilities for TypeScript
- **TypeScript** (v5.9.3): Full type safety with strict mode
- **Node.js** (v22.x): Minimum required version
- **Vitest**: Testing framework with 14 comprehensive tests
- **tsup**: Fast bundler for ESM/CJS dual output
- **pnpm**: Package manager (v10.18.3+)

## Development Commands

### Pre-Checkin Command

```bash
pnpm validate  # 🚀 Format, lint, test, and build everything
```

### Formatting

- `pnpm format` - Format code with Prettier (write mode)
- `pnpm format:check` - Check Prettier formatting without writing

### Linting

- `pnpm lint` - Fix ESLint issues (write mode)
- `pnpm lint:check` - Check ESLint issues without fixing

### Testing

- `pnpm test` - Run all 14 tests once
- `pnpm test:watch` - Run tests in watch mode
- `pnpm test:coverage` - Run tests with coverage report
- `pnpm test:ui` - Launch Vitest UI for interactive testing

### Building

- `pnpm build` - Production build (outputs to `dist/`)
- `pnpm dev` - Development build with watch mode
- `pnpm build:watch` - Alias for dev

### Development Setup

```bash
# Install dependencies (uses pnpm 10.18.3+)
pnpm install

# Run in development mode with auto-rebuild
pnpm dev

# Run tests in watch mode while developing
pnpm test:watch
```

### Debugging

Enable debug logging by setting the `DEBUG` environment variable:

```bash
# Enable all DuckPond debug logs
DEBUG=duckpond:* pnpm test

# Enable specific modules
DEBUG=duckpond:main pnpm test
DEBUG=duckpond:cache pnpm test
```

Debug namespaces (see src/utils/logger.ts):
- `duckpond:main` - DuckPond class operations
- `duckpond:cache` - LRU cache operations

## Architecture

### Project Structure

```
src/
├── DuckPond.ts           # Main manager class
├── index.ts              # Public API exports
├── types.ts              # Type definitions
├── cache/
│   └── LRUCache.ts      # Generic LRU cache with functype
└── utils/
    ├── errors.ts         # Error utilities with Either
    └── logger.ts         # Debug logging

test/
└── DuckPond.spec.ts     # 14 comprehensive tests

dist/                     # Build output (ESM + CJS + types)
```

### Core Modules

#### 1. DuckPond Class (src/DuckPond.ts)

Main manager responsible for:
- **User lifecycle**: Attach/detach user databases from cache
- **Connection pooling**: Reuse connections via LRU cache
- **Cloud storage**: R2/S3 integration via DuckDB extensions
- **Error handling**: All methods return `AsyncDuckPondResult<T>` (Promise<Either<Error, T>>)

Key methods:
- `init()`: Initialize DuckDB instance and configure cloud storage
- `getUserConnection(userId)`: Get or create user connection
- `query<T>(userId, sql)`: Execute query with type-safe results
- `execute(userId, sql)`: Execute DDL/DML without results
- `detachUser(userId)`: Manually evict user from cache
- `close()`: Cleanup all resources

#### 2. LRUCache (src/cache/LRUCache.ts)

Generic least-recently-used cache using functype:
- **Option<T>** for safe get operations
- **List<T>** for immutable collections (keys, values)
- **Automatic eviction** of LRU items when at capacity
- **Stale detection** based on lastAccess timestamp

Methods:
- `get(key): Option<T>` - Returns Some(value) or None
- `set(key, value)` - Add/update with LRU tracking
- `getLRU(): Option<string>` - Get least recently used key
- `getStale(timeoutMs): List<string>` - Find idle entries

#### 3. Error Utilities (src/utils/errors.ts)

Functional error handling without exceptions:
- `createError()`: Create `Either<DuckPondError, never>` (Left)
- `success<T>(value)`: Create `Either<DuckPondError, T>` (Right)
- `toDuckPondError()`: Convert unknown errors to DuckPondError
- `Errors`: Factory object with pre-defined error creators
- `formatError()`: Pretty-print errors for logging

#### 4. Types (src/types.ts)

Comprehensive TypeScript definitions:
- `DuckPondConfig`: R2/S3 configuration with defaults
- `DuckPondResult<T>`: Sync Either<Error, T>
- `AsyncDuckPondResult<T>`: Promise<Either<Error, T>>
- `ErrorCode`: Enum of all error types
- `UserStats`: Per-user statistics

## Functype Integration Patterns

### 1. Option<T> - Safe Null Handling

**When to use**: Replacing nullable types (T | null | undefined)

```typescript
// ✅ Good: Option for cache lookup
const cached = this.cache.get(userId)  // Returns Option<UserDatabase>
if (cached.isSome()) {
  const userDb = cached.fold(
    () => { throw new Error("Unreachable") },
    db => db
  )
}

// ❌ Bad: Don't use null/undefined
const cached = this.cache.get(userId)  // Would return UserDatabase | null
if (cached !== null) { /* ... */ }
```

**Key methods**:
- `Option(value)` - Constructor (NOT `Option.some()`)
- `.isSome()` / `.isNone()` - Type guards
- `.fold(onNone, onSome)` - Pattern matching
- `.map(fn)` - Transform value if present
- `.orElse(defaultValue)` - Provide fallback

### 2. Either<L, R> - Error Handling

**When to use**: All async operations that can fail

```typescript
// ✅ Good: Return Either from async functions
async function query(sql: string): AsyncDuckPondResult<Row[]> {
  try {
    const rows = await conn.run(sql)
    return success(rows)  // Right
  } catch (error) {
    return Errors.queryExecutionError(error.message, sql, error)  // Left
  }
}

// Usage with fold()
const result = await query('SELECT * FROM users')
result.fold(
  error => console.error(error.message),  // Left case
  rows => console.log(rows)                // Right case
)
```

**Key methods**:
- `Left(error)` - Create error (left) side
- `Right(value)` - Create success (right) side
- `.isLeft()` / `.isRight()` - Type guards
- `.fold(onLeft, onRight)` - Pattern matching (primary method)
- `.map(fn)` - Transform right value
- `.mapLeft(fn)` - Transform left value

### 3. Try - Synchronous Error Catching

**⚠️ IMPORTANT**: Try does NOT work with async functions!

```typescript
// ❌ Wrong: Try with async
async function bad(): AsyncDuckPondResult<void> {
  return Try(async () => {
    await someAsyncOp()
  }).toEither()  // Returns Try<Promise<void>>, not Promise<Either>
}

// ✅ Correct: Use try/catch for async
async function good(): AsyncDuckPondResult<void> {
  try {
    await someAsyncOp()
    return success(undefined)
  } catch (error) {
    return Errors.storageError("Failed", error as Error)
  }
}
```

Use Try only for synchronous operations.

### 4. List<T> - Immutable Collections

**When to use**: Replacing mutable arrays for functional operations

```typescript
// ✅ Good: List for cache keys
const keys = this.cache.keys()  // Returns List<string>
keys.map(id => parseInt(id))
    .filter(num => num > 100)
    .toArray()  // Convert back to native array

// Note: List doesn't have sortBy()
const values = this.values().toArray()
const sorted = values.sort((a, b) => a.lastAccess.getTime() - b.lastAccess.getTime())
```

**Key methods**:
- `List(array)` - Constructor
- `.map(fn)` - Transform elements
- `.filter(fn)` - Filter elements
- `.forEach(fn)` - Iterate (side effects)
- `.toArray()` - Convert to native array
- `.head()` - Get first element as Option
- Note: `.sortBy()` is NOT available - use native array sort

## DuckDB Node-API Specifics

### Connection Management

```typescript
// ✅ Correct: Connections are managed by the instance
const instance = await DuckDBInstance.create(":memory:")
const conn = await instance.connect()
// No need to call conn.close() - managed automatically

// ❌ Wrong: Don't try to close connections
await conn.close()  // Method doesn't exist!
```

### Query Results

```typescript
// ✅ Correct: Use getRowObjects() for column name mapping
const resultObj = await conn.run(sql)
const rows = await resultObj.getRowObjects()  // Returns [{col: val}, ...]

// ❌ Wrong: getRows() returns arrays without column names
const rows = await resultObj.getRows()  // Returns [[val1, val2], ...]

// ❌ Wrong: getColumns() returns empty array
const columns = await resultObj.getColumns()  // Returns []
```

## Type System Gotchas

### 1. Async Either Type Compatibility

When returning `Either` from async functions, TypeScript strict mode requires type assertions:

```typescript
async function example(): AsyncDuckPondResult<void> {
  // ❌ Error: Either<E, never> not assignable to Promise<Either<E, void>>
  return Errors.notInitialized()

  // ✅ Fix: Cast to any (with eslint-disable)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Errors.notInitialized() as any

  // ✅ Also works: Cast to expected type
  return Errors.notInitialized() as AsyncDuckPondResult<void>
}
```

### 2. Either Propagation in Async Functions

When checking `isLeft()` in async functions:

```typescript
async function example(): AsyncDuckPondResult<Data> {
  const result = await getConnection()  // Returns Either<E, Connection>

  if (result.isLeft()) {
    // ❌ Wrong: Type mismatch
    return result  // Either<E, Connection> vs Promise<Either<E, Data>>

    // ✅ Fix: Cast to any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result as any
  }

  // Extract right value
  const conn = result.fold(
    () => { throw new Error("Unreachable") },
    c => c
  )
}
```

### 3. Void vs Undefined

The `success()` helper uses conditional types for void:

```typescript
// Handles both void and undefined
export function success<T = void>(value?: T): Either<DuckPondError, T extends void ? void : T> {
  return Right(value) as any
}

// Usage
return success(undefined)  // Either<E, void>
return success(data)       // Either<E, Data>
```

## Testing Strategy

### Test Coverage (14 tests, all passing)

1. **Initialization (4 tests)**
   - Instance creation with defaults
   - Query failure before init
   - Successful initialization
   - Multiple init calls (idempotent)

2. **User Management (2 tests)**
   - Attachment checking (`isAttached()`)
   - User statistics retrieval

3. **Query Execution (4 tests)**
   - Simple queries with Either
   - Error handling with Either
   - DDL statement execution
   - Functype fold pattern usage

4. **Resource Management (2 tests)**
   - Manual user detachment
   - LRU eviction when cache is full

5. **Functype Integration (2 tests)**
   - Option for null handling
   - Either chaining with map

### Writing Tests

```typescript
import { describe, test, expect, beforeAll, afterAll } from "vitest"
import { DuckPond } from "../src/DuckPond"
import { ErrorCode } from "../src/types"

describe("Feature", () => {
  let pond: DuckPond

  beforeAll(async () => {
    pond = new DuckPond({ memoryLimit: "1GB" })
    await pond.init()
  })

  afterAll(async () => {
    await pond.close()
  })

  test("should handle errors with Either", async () => {
    const result = await pond.query("user", "SELECT * FROM missing")

    expect(result.isLeft()).toBe(true)
    const error = result.fold(err => err, () => null)
    expect(error?.code).toBe(ErrorCode.QUERY_EXECUTION_ERROR)
  })
})
```

## Common Patterns

### Pattern 1: Initialize and Query

```typescript
const pond = new DuckPond({ r2: { /* ... */ } })

const initResult = await pond.init()
if (initResult.isLeft()) {
  const error = initResult.fold(err => err, () => null)
  console.error(`Init failed: ${error?.message}`)
  process.exit(1)
}

const queryResult = await pond.query<Row>('user123', 'SELECT * FROM data')
queryResult.fold(
  error => console.error(error.message),
  rows => processRows(rows)
)

await pond.close()
```

### Pattern 2: Error Context Extraction

```typescript
const result = await pond.query('user', sql)
result.fold(
  error => {
    console.error(`[${error.code}] ${error.message}`)
    if (error.cause) console.error('Cause:', error.cause.message)
    if (error.context?.sql) console.error('SQL:', error.context.sql)
  },
  rows => console.log(`Got ${rows.length} rows`)
)
```

### Pattern 3: Safe Cache Access

```typescript
const cached = this.cache.get(userId)
cached.fold(
  () => {
    // User not in cache - load from storage
    return this.loadUser(userId)
  },
  userDb => {
    // User found - return existing connection
    return Promise.resolve(success(userDb.connection))
  }
)
```

## Build Configuration

### tsup (tsup.config.ts)

- **Dual format**: ESM (.mjs) and CommonJS (.js)
- **Type declarations**: .d.ts and .d.mts files
- **Source maps**: Generated for debugging
- **Environment-aware**: Uses `NODE_ENV` for development/production
- **Entry points**: All exports from src/ directory

### TypeScript (tsconfig.json)

- **Module resolution**: `bundler` (required for functype subpath imports)
- **Strict mode**: Enabled with `noImplicitAny: false` for DuckDB native types
- **Target**: ESNext for modern syntax
- **Declaration only**: tsup handles actual transpilation

### Vitest (vitest.config.ts)

- **Environment**: Node.js
- **Coverage**: v8 provider with text/json/html reports
- **UI**: Available via `pnpm test:ui`

### ESLint (eslint.config.mjs)

- **Flat config format**: Using ESLint 9.x flat config
- **Plugins**: TypeScript, Prettier, simple-import-sort
- **Import sorting**: Enforced with simple-import-sort plugin
- **Prettier integration**: Runs as ESLint rule for consistency

## CI/CD

GitHub Actions workflows run automatically on push/PR to `main`:

- **Node.js CI**: Runs `pnpm validate` (format, lint, test, build)
- **CodeQL**: Security scanning for vulnerabilities
- **Node version**: Tests run on Node 22.x

View status badges at the top of README.md or check `.github/workflows/`.

## Publishing Checklist

Before publishing to npm, ensure:

1. ✅ All tests pass: `pnpm test`
2. ✅ No lint errors: `pnpm lint:check`
3. ✅ Formatting correct: `pnpm format:check`
4. ✅ Build succeeds: `pnpm build`
5. ✅ Version bumped in `package.json`
6. ✅ CHANGELOG updated (if applicable)

Or run: `pnpm validate` (automatically runs on `prepublishOnly`)

## Key Implementation Notes

1. **Always use functype constructors correctly**:
   - `Option(value)` NOT `Option.some(value)`
   - `Either` has no `.left()` or `.right()` - use `.fold()`

2. **DuckDB connections are instance-managed**:
   - Never call `connection.close()`
   - Use `getRowObjects()` for query results

3. **Handle async Either carefully**:
   - Use `as any` type assertions when needed
   - Always return `AsyncDuckPondResult<T>` from async functions

4. **List limitations**:
   - No `sortBy()` method - use native array sort
   - Convert to array with `.toArray()` when needed

5. **Error handling convention**:
   - Use `Errors` factory for common errors
   - Always provide context in custom errors
   - Format errors with `formatError()` for logging
