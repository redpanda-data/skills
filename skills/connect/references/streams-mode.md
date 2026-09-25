# Redpanda Connect: Streams Mode

Normally one Redpanda Connect process runs a single stream (one `input` → `buffer` → `pipeline` → `output`). In **streams mode**, a single running Connect instance hosts **multiple entirely isolated streams**, each with its own input, optional buffer, processor pipeline, and output — and its own lifetime.

Streams can be defined two ways, and the methods combine (you can update or delete streams via the API that were created from static files):

1. **Static config files** — a directory of per-stream YAML files loaded at startup.
2. **HTTP REST API** — create, inspect, update, and delete streams dynamically at runtime. **Off by default**: the management endpoints are only registered when you pass `--bind-http` (see [Streams REST API](#streams-rest-api)).

## When to use streams mode

- **Many small pipelines, one process**: consolidate lots of low-volume pipelines instead of running one process (and one metrics/HTTP port) per pipeline.
- **Dynamic pipeline management**: add/remove/replace pipelines at runtime through the REST API without restarting the service (requires `--bind-http`).
- **Shared resources**: cache, rate-limit, and other resource components are defined once and shared by every stream.

Prefer separate single-config processes when pipelines need independent scaling, isolation of failure/resource domains, or independent deploy lifecycles — streams in one process share the process's CPU, memory, and observability config.

## Running streams mode

```bash
# Load every stream config in a directory (one stream per file; stream id = file name)
rpk connect streams ./streams/*.yaml

# Service-wide observability config (metrics, logger, tracer, http) via -o/--observability
rpk connect streams -o ./config.yaml ./streams/*.yaml

# Shared resources via -r/--resources (same flag as regular run mode)
rpk connect streams -r "./resources/prod/*.yaml" ./streams/*.yaml

# API-only: start with no static streams, manage everything over REST.
# --bind-http is REQUIRED: without it the management endpoints are not
# registered and there is no way to add a stream.
rpk connect streams --bind-http
```

(Equivalently `redpanda-connect streams ...` with the plain binary.)

## Config-file layout

Each stream config contains **only the base stream fields**: `input`, `buffer`, `pipeline`, `output`. Everything service-wide lives elsewhere:

- **Observability** (`metrics`, `logger`, `tracer`, plus the `http` server section) goes in the general config passed with `-o`/`--observability`.
- **Resources** (`cache_resources`, `rate_limit_resources`, etc.) must NOT appear in a stream config — define them in the general config or in files imported with `-r`/`--resources`. They are shared across all streams.

```
streams/
  foo.yaml     # stream "foo": input/pipeline/output only
  bar.yaml     # stream "bar"
resources/
  caches.yaml  # shared cache_resources
config.yaml    # http/metrics/logger/tracer (-o)
```

## HTTP endpoints and metrics

- Components that register HTTP endpoints (e.g. an `http_server` input) get their paths **prefixed with the stream id**: a `/meow` path in stream `foo` becomes `/foo/meow`, preventing collisions between streams. Disable with `--prefix-stream-endpoints=false`.
- Metrics from all streams are aggregated on the instance's metrics exporter, enriched with a `stream` label carrying the stream name. Short-lived, uniquely-named streams grow metric cardinality indefinitely — filter with the metrics `mapping` field, e.g.:

```yaml
metrics:
  mapping: if meta("stream") != "foo" { deleted() }
  prometheus: {}
```

## Streams REST API

Served on the instance's HTTP server (default `localhost:4195`). Stream configs POSTed/PUT through the API can be JSON or YAML. Note: configs created or updated via the API do **not** get environment-variable interpolation (function interpolation `${! ... }` still works).

### The management endpoints are opt-in

The endpoints that **create, update, or remove** streams and resources accept pipeline configuration over HTTP, so they are **not registered by default**. Pass `--bind-http` to `rpk connect streams` to register them:

```bash
rpk connect streams --bind-http -o ./config.yaml ./streams/*.yaml
```

Without the flag the routes are simply never registered: the HTTP server still binds as configured and serves everything else, but these paths are unknown to it. Confirm with `rpk connect streams --help` on your installed version.

What the flag does and does not gate:

| Always registered | Requires `--bind-http` |
|---|---|
| `GET /ready` | `GET`/`POST /streams` |
| The service-wide `/ping`, `/stats`, `/metrics` | `POST`/`GET`/`PUT`/`PATCH`/`DELETE /streams/{id}` |
| Endpoints registered by components (e.g. an `http_server` input) | `GET /streams/{id}/stats` |
| | `POST /resources/{type}/{id}` |

So a liveness/readiness probe on `/ready` and the metrics scrape keep working with the API disabled — only runtime pipeline management is lost.

**When you enable it, secure the HTTP server.** These endpoints let a caller run arbitrary pipeline configuration in your process. Bind `http.address` to a trusted interface and/or set `http.basic_auth` in the general (`-o`) config; the flag adds no authentication of its own.

> **`--no-api` is deprecated and has no effect.** It was the old opt-*out* for this API. It is now hidden, and passing it only logs a warning (`The --no-api flag is deprecated and no longer has any effect: the streams-mode HTTP API is now disabled by default and enabled with --bind-http.`). A deployment that relied on `--no-api` to keep the API closed is already closed; one that relied on the API being on by default must add `--bind-http`.

### Endpoints

| Method + path | Effect |
|---|---|
| `GET /ready` | 200 if all active streams are connected to their inputs/outputs; 503 (naming the faulty stream) otherwise. 200 when zero streams are active. **The only endpoint here that does not need `--bind-http`.** |
| `GET /streams` | Map of stream id → `{active, uptime, uptime_str}`. |
| `POST /streams` | **Set the entire collection**: body is a map of id → stream config. Streams absent from the body are removed, existing ones updated, new ones created. |
| `POST /streams/{id}` | Create stream `{id}` from the body (standard `input`/`buffer`/`pipeline`/`output` config). |
| `GET /streams/{id}` | Status plus the stream's loaded `config`. |
| `PUT /streams/{id}` | Replace the stream's config: the previous stream is shut down and a new one takes its place. |
| `PATCH /streams/{id}` | Patch the existing config with only the changed fields and restart the stream with the result. |
| `DELETE /streams/{id}` | Shut down and remove the stream. |
| `GET /streams/{id}/stats` | The stream's metrics as a hierarchical JSON object. |
| `POST /resources/{type}/{id}` | Add or modify a shared resource; `{type}` is one of `cache`, `input`, `output`, `processor`, `rate_limit`. |

Create/update endpoints return `400` with a `{"lint_errors": [...]}` body when the config fails linting; append `?chilled=true` to accept a config despite lint errors (which also relaxes the missing-environment-variable check).

### Lifecycle example

(All of these require the instance to have been started with `--bind-http`.)

```bash
# Add a stream
curl http://localhost:4195/streams/foo -X POST --data-binary @foo.yaml

# List and inspect
curl http://localhost:4195/streams
curl http://localhost:4195/streams/foo

# Replace its config (old stream shuts down first)
curl http://localhost:4195/streams/foo -X PUT --data-binary @foo-v2.yaml

# Remove it
curl http://localhost:4195/streams/foo -X DELETE
```

## Authoritative reference

- Docs: docs.redpanda.com → Redpanda Connect → Guides → Streams mode (the About, Using config files, Using the REST API, and Streams API pages; the Streams API page is the full endpoint spec).
- Engine source: `redpanda-data/benthos` `internal/cli/streams.go` (the `streams` subcommand and its flags, including `--bind-http`), `internal/cli/common/service.go` (the `--no-api` deprecation warning), and `internal/stream/manager/api.go` (`registerEndpoints`, whose `enableCrud` argument is what `--bind-http` sets).
- Live surface: `rpk connect streams --help` on your installed version for the current flag set.
