## typescript-library-template

[![Node.js CI](https://github.com/jordanburke/typescript-library-template/actions/workflows/node.js.yml/badge.svg)](https://github.com/jordanburke/typescript-library-template/actions/workflows/node.js.yml)
[![CodeQL](https://github.com/jordanburke/typescript-library-template/actions/workflows/codeql.yml/badge.svg)](https://github.com/jordanburke/typescript-library-template/actions/workflows/codeql.yml)

A modern TypeScript library template with standardized build scripts and tooling.

## Features

- **Modern Build System**: [tsup](https://tsup.egoist.dev/) for fast bundling with TypeScript support
- **Testing**: [Vitest](https://vitest.dev/) with coverage reporting and UI
- **Code Quality**: ESLint + Prettier with automatic formatting and fixing
- **Dual Format**: Outputs both CommonJS and ES modules with proper TypeScript declarations
- **Standardized Scripts**: Consistent commands across all projects

## Quick Start

1. **Use this template** to create a new repository
2. **Clone your new repository**
3. **Install dependencies**: `pnpm install`
4. **Start developing**: `pnpm dev` (builds with watch mode)
5. **Before committing**: `pnpm run validate` (format + lint + test + build)

## Development Commands

### Pre-Checkin Command

```bash
pnpm run validate  # 🚀 Main command: format, lint, test, and build everything
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
pnpm test:coverage # Run tests with coverage report
pnpm test:ui       # Launch Vitest UI

# Building
pnpm build         # Production build
pnpm build:watch   # Build with watch mode
pnpm dev           # Development mode (alias for build:watch)

# Type Checking
pnpm ts-types      # Check TypeScript types
```

## Publishing

The template automatically runs `pnpm run validate` before publishing via the `prepublishOnly` script, ensuring your package is properly formatted, linted, tested, and built.

```bash
pnpm publish --access public
```

## Project Structure

```
src/
├── index.ts          # Main library entry point
test/
├── *.spec.ts         # Test files
dist/                 # Built output (CommonJS + ES modules + types)
```

## Tooling

- **Build**: [tsup](https://tsup.egoist.dev/) - Fast TypeScript bundler
- **Test**: [Vitest](https://vitest.dev/) - Fast unit test framework
- **Lint**: [ESLint](https://eslint.org/) with TypeScript support
- **Format**: [Prettier](https://prettier.io/) with ESLint integration
- **Package Manager**: [pnpm](https://pnpm.io/) for fast, efficient installs

---

_This template is based on the earlier work of https://github.com/orabazu/tsup-library-template but updated with modern tooling and standardized scripts._
