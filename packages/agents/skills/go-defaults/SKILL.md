---
name: go-defaults
description: Use when selecting, reviewing, or standardizing libraries and infrastructure for a Go project, including HTTP servers, databases, ORMs, migrations, configuration, validation, CLIs, authentication, logging, observability, testing, WebSockets, OpenAPI, and embedded storage. Provides production-oriented default choices while preserving deliberate existing project decisions.
---

# Go Defaults

Choose boring, maintained libraries with clear ownership. Prefer the standard
library when it already provides the required behavior. Do not add a dependency
only to replace a small, well-tested helper.

## Workflow

1. Read `go.mod`, repository instructions, architecture docs, and adjacent code.
2. Distinguish an established project choice from accidental local reinvention.
3. State the proposed stack and important tradeoffs before changing dependencies.
4. Use one library per responsibility. Remove the replaced path in the same
   change; do not leave two routers, ORMs, loggers, or migration authorities.
5. Pin tools and modules, run `go mod tidy`, inspect the module graph and licenses,
   and run `govulncheck`, tests, race tests, lint, and supported-platform builds.
6. Wrap provider SDKs at ownership boundaries so their types do not spread
   through domain code.

Respect a coherent existing stack unless the user requests a cutover or the
existing choice creates a concrete correctness, security, or maintenance issue.

## Default Stack

| Concern | Default | Use differently when |
|---|---|---|
| HTTP server | `github.com/labstack/echo/v4` | Use `net/http` alone for a tiny service, specialized proxy, or generated handler that needs no framework. |
| HTTP client | `net/http` | Add a provider SDK when it owns substantial protocol behavior, pagination, signing, or typed errors. |
| ORM | `gorm.io/gorm` | Use `pgx`, `database/sql`, or `github.com/jmoiron/sqlx` directly for SQL-first, query-heavy, or infrastructure state code. |
| PostgreSQL | `github.com/jackc/pgx/v5`; use `gorm.io/driver/postgres` with GORM | Use another driver only for an existing supported database contract. |
| Embedded relational state | `database/sql` with `modernc.org/sqlite` | Use bbolt only for genuinely key/value state with no relational querying or cross-record transaction needs. |
| Migrations | `github.com/pressly/goose/v3` | Preserve an existing authoritative migration system such as Alembic or Atlas. Never run GORM `AutoMigrate` in production. |
| Configuration | standard flags plus a strict typed environment decoder; use `github.com/joho/godotenv` only for local files | Preserve an established decoder such as `envconfig`; reject present-but-invalid values. |
| Request validation | `github.com/go-playground/validator/v10` plus explicit domain validation | Use generated protocol validation where the schema is canonical. |
| OpenAPI | `github.com/oapi-codegen/oapi-codegen/v2` and `github.com/getkin/kin-openapi` | Keep handwritten transport code for streaming or proxy routes that generated handlers cannot preserve. |
| CLI | `github.com/spf13/cobra` | Use `flag` for a small command with no subcommands. |
| Terminal UI | `github.com/charmbracelet/bubbletea` with `github.com/charmbracelet/lipgloss` | Do not add a TUI framework to a non-interactive service or simple CLI. |
| Logging | `go.uber.org/zap` | Use `log/slog` for a small dependency-light service; do not run multiple logging stacks. |
| UUIDs | `github.com/google/uuid` | Use opaque secure random IDs when identifiers are authorization material. |
| JWT | `github.com/golang-jwt/jwt/v5` | Prefer a provider SDK for provider-specific token verification and key rotation. |
| JWK/JWS/JWE | `github.com/lestrrat-go/jwx/v2` | Do not add it when JWT parsing alone satisfies the protocol. |
| WebSockets | `github.com/gorilla/websocket` | Use another implementation only after protocol, cancellation, backpressure, and close-handshake conformance tests. |
| Redis | `github.com/redis/go-redis/v9` | Do not add Redis when local memory or the primary database satisfies the contract. |
| Scheduling | `github.com/robfig/cron/v3` | Use platform scheduling for durable jobs that must survive process downtime. |
| Metrics | `github.com/prometheus/client_golang` | Use the deployment platform's established metrics SDK. |
| Tracing | `go.opentelemetry.io/otel` | Omit tracing for small local tools with no distributed request path. |
| Tests | `testing`, `httptest`, `github.com/stretchr/testify`, and `github.com/testcontainers/testcontainers-go` | Prefer small hand-written fakes over a mocking framework. |
| Concurrency | `golang.org/x/sync` and `golang.org/x/time/rate` | Use standard channels, mutexes, and contexts when sufficient. |
| JSON Patch | `github.com/evanphx/json-patch/v5` | Keep merge-patch and RFC 6902 semantics explicit; do not manipulate patches as maps. |
| Compression | `github.com/klauspost/compress` | Use the standard library when its formats and performance are sufficient. |

## SQLite Defaults

Use SQLite for local durable state that has relationships, indexes, lifecycle
events, idempotency records, an outbox, or operator queries.

- Use one database per independently deployed service or privilege boundary.
- Use `database/sql` with `modernc.org/sqlite` for CGO-free Linux and macOS
  releases. Do not route infrastructure state through GORM by default.
- Enable foreign keys, WAL mode, a bounded busy timeout, and an explicitly chosen
  synchronous policy on every database initialization.
- Put related state changes and outbox insertion in one transaction.
- Use unique constraints for idempotency and foreign keys for lifecycle ownership.
- Keep schema migrations explicit, ordered, checksummed, and transactional where
  SQLite permits.
- Bound row and blob sizes at ingress. Do not store request bodies, credentials,
  prompts, or other secrets merely because SQLite can hold them.
- Provide integrity checking, consistent backup, and redacted JSON export for
  operations. Do not encourage operators to edit the live database manually.
- Keep state on a local filesystem; do not place SQLite databases on network
  filesystems without a separately proven locking contract.

For security-sensitive state, default to stronger durability over maximum write
throughput. Benchmark before weakening synchronous behavior.

## GORM Defaults

- Treat GORM as a query and mapping layer, not the schema authority.
- Use explicit migrations and database constraints for invariants.
- Pass contexts to queries and transactions.
- Make transaction boundaries visible at the service layer.
- Avoid hidden writes in hooks unless the invariant cannot be expressed more
  clearly elsewhere.
- Use explicit column, index, and constraint names when compatibility matters.
- Inspect generated SQL for nontrivial joins, preloads, updates, and locking.
- Test production behavior against the production database. SQLite unit tests do
  not prove PostgreSQL locking, constraint, JSON, timestamp, or query semantics.

## HTTP Defaults

- Use one Echo instance and one authoritative route-registration layer.
- Keep domain services independent of `echo.Context`.
- Centralize authentication, request IDs, recovery, body limits, timeouts, and
  error mapping as middleware.
- Reject duplicate JSON keys, trailing values, oversized bodies, and unknown
  fields for closed request schemas; Echo's binder alone is not a security
  boundary.
- Use `http.Server` read-header, read, write, idle, and graceful-shutdown limits.
- Preserve streaming and backpressure for uploads, downloads, WebSockets, and
  reverse proxies.
- Do not expose raw dependency errors or response bodies to clients or logs.

## Domain Integrations

Use domain libraries only when the feature exists:

- Use `cloud.google.com/go/storage` for Google Cloud Storage rather than
  handwritten signed requests or bucket protocol code.
- Use `github.com/sideshow/apns2` for Apple Push Notification delivery while
  keeping token lifecycle, idempotency, retries, and user policy in the service.
- Use `github.com/wI2L/jsondiff` for deterministic JSON Patch generation in
  tests or patch-producing features.
- Use official or broadly adopted provider SDKs for signing, pagination, token
  refresh, typed errors, and protocol evolution. Keep bounded I/O, secret
  redaction, authorization, and business policy in project-owned wrappers.

## Dependency Rules

- Prefer mature libraries with active maintenance, tagged releases, compatible
  licenses, security reporting, and broad production use.
- Record why a large runtime dependency is justified. Include binary size,
  build-time, cross-compilation, and transitive-module cost when relevant.
- Pin generators as Go tools and verify generated files are current in CI.
- Do not leak ORM models into API contracts or framework contexts into domain
  services.
- Do not replace security-sensitive OS primitives, policy decisions, or privilege
  transitions with a generic convenience library without threat-model review.
