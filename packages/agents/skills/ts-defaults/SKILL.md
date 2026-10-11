---
disable-model-invocation: true
name: ts-defaults
description: Use when selecting, reviewing, or standardizing libraries and infrastructure for a TypeScript or JavaScript project, including package managers, runtimes, HTTP servers, Effect, validation, databases, ORMs, queues, testing, linting, building, CLIs, authentication, logging, WebSockets, and monorepos. Provides production-oriented default choices while preserving deliberate existing project decisions.
---

# TypeScript/JavaScript Defaults

Choose boring, maintained libraries with clear ownership. Prefer platform
built-ins (`fetch`, `node:test`, `crypto`, `--env-file`, `node --run`) when
they already provide the required behavior. Do not add a dependency only to
replace a small, well-tested helper. TypeScript is the default for new
projects; a JavaScript project keeps JSDoc types and `checkJs` so `tsc
--noEmit` still gates it.

## Workflow

1. Read `package.json`, lockfile, workspace config, repository instructions,
   architecture docs, and adjacent code.
2. Distinguish an established project choice from accidental local reinvention.
3. State the proposed stack and important tradeoffs before changing dependencies.
4. Use one library per responsibility. Remove the replaced path in the same
   change; do not leave two HTTP servers, validators, loggers, or test runners.
5. Pin tool versions, commit the lockfile, audit transitive licenses, and run
   typecheck, lint, format check, and tests before finishing.
6. Wrap provider SDKs at ownership boundaries so their types and retries do
   not spread through domain code.

Respect a coherent existing stack unless the user requests a cutover or the
existing choice creates a concrete correctness, security, or maintenance issue.

## Default Stack

| Concern | Default | Use differently when |
|---|---|---|
| Package manager | `pnpm` | Use npm for single-package scripts consumed by users who must not need pnpm; use Bun only for Bun-native projects. |
| Runtime | Node.js LTS (22 or 24), ESM (`"type": "module"`) | Use Bun when its single-binary deploy or edge APIs are the point; Deno only for Deno-native code. |
| Language | TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `noUncheckedSideEffectImports`), `tsc --noEmit` as the gate | Keep JSDoc + `checkJs` for a small plain-JS project that will not adopt a build step. |
| HTTP server | `fastify` | Use `hono` for edge/portable runtimes or tiny routers; `express` only to match an existing legacy app. |
| Functional core | `effect` for services with real failure, retry, resource, or concurrency structure | Skip it for small scripts, CLIs, and libraries where plain `async` is clearer; do not mix two error models. |
| Validation | `zod` (v4) | Use `valibot` for browser/edge bundles where tree-shaken size dominates; use generated codecs at provider boundaries. |
| Database | PostgreSQL via `drizzle-orm` + `drizzle-kit` migrations | Use `prisma` when schema-first DX and Studio win the team; use `postgres.js`/`pg` raw for SQL-first infra code. |
| HTTP client | native `fetch` (undici) | Add `ky` for browser/client ergonomics; use a provider SDK when it owns signing, pagination, or token refresh. |
| Tests | `vitest` | Use `node:test` for small dependency-light libraries; keep tests colocated or under `tests/`. |
| Lint + format | `eslint` with `typescript-eslint` strict type-checked rules + `prettier` | Use `biome` (or oxlint/oxfmt) on greenfield projects with no plugin needs; keep ESLint when custom or framework rules matter. |
| Build/emit | `tsc` for types plus `tsup` (esbuild) for emit | Use `tsc` alone for node-consumed packages; use `tsx` for dev execution instead of a watch build. |
| Logging | `pino` | Use platform logs for serverless; do not run multiple logging stacks. |
| Errors/observability | `pino` + OpenTelemetry SDKs | Omit tracing for small local tools with no distributed request path. |
| Config/env | `process.env` with `node --env-file` or `dotenvx` for earlier runtimes | Validate all external input with the schema layer regardless of source. |
| CLI | `commander` | Use plain `process.argv` parsing for a single-command script; `@clack/prompts` for interactive flows. |
| Terminal UI | `ink` (React) or `@clack/prompts` | Do not add a TUI framework to a non-interactive service. |
| JWT | `jose` | Prefer a provider SDK for provider-specific verification and key rotation. |
| Auth | `better-auth` for full-stack session/credential needs | Use provider SDKs or platform auth for single-provider cases; do not hand-roll password storage. |
| WebSockets | `ws` | Use SSE for one-way streams; use `partysocket`/managed realtime only when the platform provides it. |
| Queues/durable jobs | `bullmq` on Redis | Use platform schedulers for cron; use a database-backed outbox for low-volume durable work. |
| Redis | `ioredis` (or bullmq's bundled client) | Do not add Redis when local memory or the primary database satisfies the contract. |
| Monorepo | pnpm workspaces + `turborepo` | Use a single package when tasks do not need caching or a pipeline. |
| OpenAPI | `@fastify/swagger` + Zod schemas | Keep handwritten transport for streaming/proxy routes generation cannot preserve. |
| Internal RPC | `tRPC`/`oRPC` for same-repo client+server | Use plain REST/JSON when clients are external or non-TS. |
| Browser client | Vite | Use Next.js/React Router framework mode when SSR routing is the product. |

## Effect Defaults

- Model boundaries as `Effect` services in a `Layer`; keep handlers thin so
  framework code (Fastify/Hono) never leaks into domain logic.
- Use typed errors (`Data.TaggedError`) for domain failures; map them to HTTP
  status codes in exactly one place.
- Use `Schedule` for retries with backoff, `Timeout`/`Race` for deadlines, and
  `Scope`/`Resource` for lifecycle; do not hand-roll retry loops beside them.
- Run effects at the edge (`Effect.runPromise` in one bootstrap/handler layer);
  do not mix raw `Promise` chains and Effects across the same call path.
- Pin lockstep versions of `effect` companion packages; upgrade them together.

## HTTP Defaults

- One Fastify instance, one authoritative route-registration layer; plugins
  over ad hoc decorators.
- Validate every request body, query, and param with a Zod (or JSON Schema)
  schema; reject unknown fields and oversized bodies — the validator is the
  security boundary, not the framework.
- Centralize auth, request IDs, rate limits, body limits, timeouts, and error
  mapping as plugins/hooks; map domain errors to responses in one place.
- Set `bodyLimit`, connection timeouts, and graceful shutdown explicitly; do
  not expose raw dependency errors or stack traces to clients or logs.
- Preserve streaming and backpressure for uploads, downloads, and proxies;
  do not buffer large payloads through JSON handlers.

## Data Defaults

- Treat the ORM as a query and mapping layer, not the schema authority: use
  explicit, reviewable migrations and database constraints for invariants.
- Make transaction boundaries visible at the service layer; do not hide
  writes in ORM hooks.
- Inspect generated SQL for nontrivial joins, updates, and locking; keep raw
  SQL escape hatches (Drizzle `sql`, Prisma `$queryRaw`) first-class.
- Test production behavior against the production database engine; SQLite
  (or an emulator) unit tests do not prove PostgreSQL semantics.
- Do not leak ORM row types into API contracts; map to domain types once.

## Dependency Rules

- Prefer mature libraries with active maintenance, tagged releases, compatible
  licenses, security reporting, and broad production use.
- Record why a large runtime dependency is justified (bundle size, cold start,
  transitive cost).
- Commit the lockfile; use `pnpm audit` and Dependabot/Renovate in CI.
- Do not leak framework types (Fastify request/reply, Effect services) into
  shared domain packages or client code.
- Do not replace security-sensitive primitives (crypto, authz decisions,
  privilege transitions) with a generic convenience library without
  threat-model review.
- Pin code generators as dev dependencies and verify generated files are
  current in CI.
