# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Memory System Initialization

**IMPORTANT**: At the start of each conversation, load the memory system to recall context:

```sql
-- 1. Health check (verify system integrity)
SELECT * FROM memory_health;

-- 2. Load active memories (high fitness, not archived)
SELECT type, category, key, value, fitness_score FROM active_memories;

-- 3. Check for promotion candidates (memories ready to hardwire)
SELECT key, value, suggested_target FROM promotion_candidates;

-- 4. Check memory relations
SELECT * FROM memory_graph;
```

**If health check fails or tables missing**, run schema validation:

```sql
SELECT name, status FROM validate_schema_query;  -- or check memory_queries for 'validate_schema'
```

### Memory Operations Quick Reference

| Action                  | Query                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Search memories         | `SELECT * FROM active_memories WHERE key ILIKE '%keyword%' OR value ILIKE '%keyword%'`                                                    |
| Store new memory        | Use `store_memory` template from `memory_queries`                                                                                         |
| Reinforce useful memory | `UPDATE memories SET reinforcement_count = reinforcement_count + 1, fitness_score = LEAST(1.0, fitness_score + 0.1) WHERE id = 'mem_xxx'` |
| Deprecate outdated      | `UPDATE memories SET fitness_score = fitness_score * 0.5 WHERE id = 'mem_xxx'`                                                            |

### Memory Schema

- `memories` - Core storage with fitness tracking
- `memory_relations` - Links between memories
- `memory_access_log` - Audit trail
- `memory_queries` - SQL templates for operations

## Project Overview

This is an MCP (Model Context Protocol) server that exposes DuckPond's multi-tenant DuckDB capabilities to AI agents. The server enables agents to manage per-user databases, execute SQL queries, and leverage R2/S3 cloud storage through a standardized MCP interface.

**Implementation Plan**: See docs/PLAN_MCP_SERVER.md for the complete implementation roadmap.

## Skills to Use

**IMPORTANT**: Always use these skills when working on this project:

### functype-user

This project uses functype patterns extensively through the duckpond library dependency:

- Use the `functype-user` skill when converting imperative/OOP code to functional patterns
- Consult the functype-user skill for API lookups and method usage
- The duckpond library returns `Either<Error, T>` for error handling - use functype-user skill for Either operations
- Reference the FUNCTYPE_FEATURE_MATRIX.md in global CLAUDE.md for data structure capabilities

### typescript-standards

This project follows the typescript-library-template pattern:

- Use the `typescript-standards` skill when setting up build scripts, tooling, or package configuration
- Follow dual module format patterns (ESM + CJS)
- Consult the skill for tsup, Vitest, ESLint, and Prettier configuration standards

## Development Commands

### Pre-Checkin Command

- `pnpm validate` - **Main command**: Format, lint, test, and build everything for checkin

### Formatting

- `pnpm format` - Format code with Prettier (write mode)
- `pnpm format:check` - Check Prettier formatting without writing

### Linting

- `pnpm lint` - Fix ESLint issues (write mode)
- `pnpm lint:check` - Check ESLint issues without fixing

### Testing

- `pnpm test` - Run tests once
- `pnpm test:watch` - Run tests in watch mode
- `pnpm test:coverage` - Run tests with coverage report
- `pnpm test:ui` - Launch Vitest UI for interactive testing

### Building

- `pnpm build` - Production build (outputs to `dist/`)
- `pnpm build:watch` - Watch mode build
- `pnpm dev` - Development build with watch mode (alias for build:watch)

### Publishing

- `prepublishOnly` - Automatically runs `pnpm validate` before publishing

### Type Checking

- `pnpm ts-types` - Check TypeScript types with tsc

## Architecture

### Build System

- **tsup**: Primary build tool configured in `tsup.config.ts`
- **Dual Output Directories**:
  - `lib/` - Development builds (NODE_ENV !== "production", used during `pnpm dev`)
  - `dist/` - Production builds (NODE_ENV === "production", used for publishing)
- **Format Support**: Generates both CommonJS (`.js`) and ES modules (`.mjs`)
- **TypeScript**: Auto-generates `.d.ts` declaration files for both formats
- **Environment-Based Behavior**:
  - Production: minified, bundled, no watch
  - Development: source maps, watch mode, faster builds

### Testing Framework

- **Vitest**: Modern test runner with hot reload and coverage
- **Configuration**: `vitest.config.ts` with Node.js environment
- **Coverage**: Uses v8 provider with text/json/html reports

### Code Quality Tools

- **ESLint**: Flat config setup in `eslint.config.mjs` with TypeScript support
- **Prettier**: Integrated with ESLint for consistent formatting
- **Import Sorting**: Automatic import organization via `simple-import-sort`

### Package Configuration

- **Entry Points**: Main source in `src/index.ts`, builds all files in `src/**/*.ts`
- **Exports**: Supports both `require()` and `import` with proper type definitions
- **Publishing**:
  - Configured for npm with public access
  - Both `lib/` and `dist/` directories are published (see package.json "files" field)
  - `prepublishOnly` hook ensures full validation before publish

### TypeScript Configuration

- **Strict Mode**: Enabled with some pragmatic exceptions:
  - `noImplicitAny: false` - Allows implicit any for flexibility
  - `strictPropertyInitialization: false` - Relaxed for constructor properties
- **Target**: ESNext for modern JavaScript features
- **Output**: TypeScript only emits declaration files; tsup handles transpilation

## Key Files

- `src/index.ts` - Main library entry point
- `test/*.spec.ts` - Test files using Vitest
- `tsup.config.ts` - Build configuration with environment-based settings (line 3 checks NODE_ENV)
- `vitest.config.ts` - Test configuration with coverage settings
- `eslint.config.mjs` - Linting rules and TypeScript integration
- `STANDARDIZATION_GUIDE.md` - Instructions for applying this pattern to other projects
