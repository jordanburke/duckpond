# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**DuckPond** is a multi-tenant DuckDB manager with Cloudflare R2 and AWS S3 storage integration, built using functional programming patterns from the [functype](https://github.com/jordanburke/functype) library. It provides per-user database isolation with automatic resource management, LRU caching, and type-safe error handling using `Either<E, T>`.

### Key Technologies

- **DuckDB node-api** (v1.4.1-r.4): In-process analytical database
- **functype** (v1.3.0): Functional programming utilities for TypeScript
- **TypeScript** (v5.9.3): Full type safety with strict mode
- **Node.js** (v22.x): Minimum required version
- **Vitest**: Testing framework with 17 comprehensive tests
- **tsdown**: Fast bundler for ESM/CJS dual output
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

- `pnpm test` - Run all 17 tests once
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
└── DuckPond.spec.ts     # 17 comprehensive tests

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
const cached = this.cache.get(userId) // Returns Option<UserDatabase>
if (cached.isSome()) {
  const userDb = cached.fold(
    () => {
      throw new Error("Unreachable")
    },
    (db) => db,
  )
}

// ❌ Bad: Don't use null/undefined
const cached = this.cache.get(userId) // Would return UserDatabase | null
if (cached !== null) {
  /* ... */
}
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
    return success(rows) // Right
  } catch (error) {
    return Errors.queryExecutionError(error.message, sql, error) // Left
  }
}

// Usage with fold()
const result = await query("SELECT * FROM users")
result.fold(
  (error) => console.error(error.message), // Left case
  (rows) => console.log(rows), // Right case
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
  }).toEither() // Returns Try<Promise<void>>, not Promise<Either>
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
const keys = this.cache.keys() // Returns List<string>
keys
  .map((id) => parseInt(id))
  .filter((num) => num > 100)
  .toArray() // Convert back to native array

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
await conn.close() // Method doesn't exist!
```

### Query Results

```typescript
// ✅ Correct: Use getRowObjects() for column name mapping.
// getRowObjects() is not exposed on the result type, so use a typed cast
// (NOT `as any` — keep it narrow so it still satisfies no-explicit-any).
const resultObj = await conn.run(sql)
const rows = await (resultObj as unknown as { getRowObjects: () => Promise<T[]> }).getRowObjects()

// ❌ Wrong: getRows() returns arrays without column names
const rows = await resultObj.getRows() // Returns [[val1, val2], ...]

// ❌ Wrong: getColumns() returns empty array
const columns = await resultObj.getColumns() // Returns []
```

## Type System Gotchas

> **⚠️ Updated for functype 1.3.0.** Earlier revisions of this file (written against
> functype 0.16.0) told you to reach for `as any` + `eslint-disable` whenever an
> `Either` crossed an async boundary. **That advice is obsolete and was removed.**
> In 1.3.0 `Either<out L, out R>` is **covariant** in both type params and `.isLeft()` /
> `.isRight()` are real type guards (`this is LeftOf<L,R>`). The patterns below need
> **no `as any` and no disables** — do not reintroduce them.

### 1. Async Either Type Compatibility

`Errors.*` factories return `Either<DuckPondError, never>`. Because `R` is covariant
and `never` is a subtype of every type, this is directly assignable to
`Either<DuckPondError, T>` — even across an `async` boundary (the value gets wrapped in
a `Promise` automatically):

```typescript
async function example(): AsyncDuckPondResult<void> {
  // ✅ Just return it — no cast needed
  return Errors.notInitialized()
}
```

### 2. Either Propagation in Async Functions

`.isLeft()` narrows to `LeftOf<L, R>`, so `.value` is the error (typed as `L`). To
propagate a `Left` whose success type differs from the current function's, rebuild it
with `Left(...)` — covariance handles the success-type change:

```typescript
async function example(): AsyncDuckPondResult<Data> {
  const result = await getConnection() // Either<DuckPondError, Connection>

  if (result.isLeft()) {
    return Left(result.value) // result.value is DuckPondError (narrowed)
  }

  // result is now narrowed to RightOf — read the value directly
  const conn = result.value
}
```

To extract a value from an `Option` after an `isNone()` guard (instead of a
`throw`-in-`fold`), use `.orThrow(...)`:

```typescript
if (this.instance.isNone()) return Errors.notInitialized()
const instance = this.instance.orThrow(new Error("Unexpected: instance should be Some"))
```

### 3. Void vs Undefined

The `success()` helper uses conditional types for void. Assert to the **precise return
type** (never `any`):

```typescript
// Handles both void and undefined
export function success<T = void>(value?: T): Either<DuckPondError, T extends void ? void : T> {
  return Right(value) as Either<DuckPondError, T extends void ? void : T>
}

// Usage
return success(undefined) // Either<E, void>
return success(data) // Either<E, Data>
```

### 4. Remaining `functype/prefer-either` warnings (intentional)

`pnpm lint:check` reports ~7 `functype/prefer-either` **warnings** (not errors — CI stays
green). They flag the `try/catch` blocks in async methods (`init`, `setupCloudStorage`,
`query`, `execute`, etc.) and one sync guard `throw` in `getUserDbPath`. These are
**knowingly left in place**: functype's `Try` is sync-only, so catching DuckDB promise
rejections and mapping them to a typed `Left` via `try/catch` + `toDuckPondError()` is the
current, deliberate strategy. Clearing them properly means migrating async effects to
`IO.tryPromise` / `Task` — a larger architectural change. **Do not silence these warnings
with `eslint-disable`.** Either leave them, or do the full `IO`/`Task` migration.

## Testing Strategy

### Test Coverage (17 tests, all passing)

1. **Initialization (4 tests)**
   - Instance creation with defaults
   - Query failure before init
   - Successful initialization
   - Multiple init calls (idempotent)

2. **User Management (5 tests)**
   - Attachment checking (`isAttached()`)
   - User statistics retrieval
   - `listUsers()` with empty cache
   - `listUsers()` with cached users
   - Cache utilization reporting

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
    const error = result.fold(
      (err) => err,
      () => null,
    )
    expect(error?.code).toBe(ErrorCode.QUERY_EXECUTION_ERROR)
  })
})
```

## Common Patterns

### Pattern 1: Initialize and Query

```typescript
const pond = new DuckPond({
  r2: {
    /* ... */
  },
})

const initResult = await pond.init()
if (initResult.isLeft()) {
  const error = initResult.fold(
    (err) => err,
    () => null,
  )
  console.error(`Init failed: ${error?.message}`)
  process.exit(1)
}

const queryResult = await pond.query<Row>("user123", "SELECT * FROM data")
queryResult.fold(
  (error) => console.error(error.message),
  (rows) => processRows(rows),
)

await pond.close()
```

### Pattern 2: Error Context Extraction

```typescript
const result = await pond.query("user", sql)
result.fold(
  (error) => {
    console.error(`[${error.code}] ${error.message}`)
    if (error.cause) console.error("Cause:", error.cause.message)
    if (error.context?.sql) console.error("SQL:", error.context.sql)
  },
  (rows) => console.log(`Got ${rows.length} rows`),
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
  (userDb) => {
    // User found - return existing connection
    return Promise.resolve(success(userDb.connection))
  },
)
```

## Build Configuration

### tsdown (tsdown.config.ts)

The config just re-exports the shared `ts-builds/tsdown` preset (`export default tsdown`),
so build behavior is centralized in `ts-builds`. Observed output (`pnpm build`):

- **Bundler**: tsdown (powered by rolldown)
- **Type declarations**: `.d.ts` emitted per entry
- **Source maps**: `.js.map` generated for debugging
- **Target**: es2020
- **Entry points**: `src/DuckPond.ts`, `src/index.ts`, `src/types.ts`, `src/cache/LRUCache.ts`, `src/utils/errors.ts`, `src/utils/logger.ts`

### TypeScript (tsconfig.json)

- **Module resolution**: `bundler` (required for functype subpath imports)
- **Strict mode**: Enabled with `noImplicitAny: false` for DuckDB native types
- **Target**: ESNext for modern syntax
- **Declaration only**: tsdown handles actual transpilation

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

3. **Handle async Either carefully** (functype 1.3.0 — no `as any`):
   - `Either<E, never>` from `Errors.*` is assignable to `Either<E, T>` (covariant `R`) — return it directly
   - After `isLeft()`, propagate with `Left(result.value)`; after the guard, read `result.value` directly (it's narrowed)
   - Use a **precise** typed assertion only where genuinely needed (e.g. the `success()` conditional type), never `as any`
   - Always return `AsyncDuckPondResult<T>` from async functions

4. **List limitations**:
   - No `sortBy()` method - use native array sort
   - Convert to array with `.toArray()` when needed

5. **Error handling convention**:
   - Use `Errors` factory for common errors
   - Always provide context in custom errors
   - Format errors with `formatError()` for logging
