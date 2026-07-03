# Oxla Admin API, Prometheus Metrics, and Runtime Controls

## Admin API Overview

Oxla's admin API is a ConnectRPC-based HTTP server (default port 9090). It is separate from both the PostgreSQL wire protocol (port 5432) and the Prometheus metrics endpoint (port 8080).

**Key characteristics:**
- HTTP server using the ConnectRPC protocol (not gRPC-over-HTTP/2; uses standard HTTP/1.1)
- Accepts both `application/proto` (binary protobuf) and `application/json` encodings
- Only supports **unary RPCs** (no streaming)
- URL pattern: `POST /<proto-package>.<ServiceName>/<MethodName>`
- Health check: `GET /healthz` — returns `200 OK` with body `OK`
- Enabled by default (`admin_api.enabled: true`, port 9090, 2 workers)

---

## Health Check

Before calling any RPC, confirm the admin server is up:

```bash
curl -s http://localhost:9090/healthz
# Response: OK (HTTP 200)
```

The blackbox test framework polls `/healthz` until it returns 200 before running admin API tests.

---

## Services

Two admin services are exposed under package `oxla.admin.v1`:

- **`LoggingService`** (`src/admin/proto/logging.proto`) — get/set the runtime log level.
- **`DebugService`** (`src/admin/proto/debug.proto`) — read-only diagnostics consumed by `rpk debug bundle`. See [DebugService](#debugservice-read-only-diagnostics) below.

## LoggingService

`oxla.admin.v1.LoggingService` is defined in `src/admin/proto/logging.proto`.

### Proto definition

```protobuf
syntax = "proto3";
package oxla.admin.v1;

enum LogLevel {
  LOG_LEVEL_NONE    = 0;
  LOG_LEVEL_FATAL   = 1;
  LOG_LEVEL_ERROR   = 2;
  LOG_LEVEL_WARNING = 3;
  LOG_LEVEL_INFO    = 4;
  LOG_LEVEL_DEBUG   = 5;
  LOG_LEVEL_VERBOSE = 6;
}

message GetLogLevelRequest {}
message GetLogLevelResponse { LogLevel level = 1; }

message SetLogLevelRequest  { LogLevel level = 1; }
message SetLogLevelResponse { LogLevel level = 1; }

service LoggingService {
  rpc GetLogLevel(GetLogLevelRequest) returns (GetLogLevelResponse);
  rpc SetLogLevel(SetLogLevelRequest) returns (SetLogLevelResponse);
}
```

### RPC endpoints

| RPC | HTTP path | Request body | Response |
|-----|-----------|-------------|---------|
| `GetLogLevel` | `POST /oxla.admin.v1.LoggingService/GetLogLevel` | Empty (`{}` or empty proto) | `{"level": "LOG_LEVEL_INFO"}` |
| `SetLogLevel` | `POST /oxla.admin.v1.LoggingService/SetLogLevel` | `{"level": "LOG_LEVEL_DEBUG"}` | `{"level": "LOG_LEVEL_DEBUG"}` |

### Get current log level (JSON)

```bash
curl -s -X POST \
  http://localhost:9090/oxla.admin.v1.LoggingService/GetLogLevel \
  -H "Content-Type: application/json" \
  -d '{}'
```

Example response:
```json
{"level":"LOG_LEVEL_INFO"}
```

### Set log level (JSON)

```bash
# Set to DEBUG
curl -s -X POST \
  http://localhost:9090/oxla.admin.v1.LoggingService/SetLogLevel \
  -H "Content-Type: application/json" \
  -d '{"level":"LOG_LEVEL_DEBUG"}'

# Set to VERBOSE
curl -s -X POST \
  http://localhost:9090/oxla.admin.v1.LoggingService/SetLogLevel \
  -H "Content-Type: application/json" \
  -d '{"level":"LOG_LEVEL_VERBOSE"}'

# Set back to INFO
curl -s -X POST \
  http://localhost:9090/oxla.admin.v1.LoggingService/SetLogLevel \
  -H "Content-Type: application/json" \
  -d '{"level":"LOG_LEVEL_INFO"}'

# Suppress all non-fatal logs
curl -s -X POST \
  http://localhost:9090/oxla.admin.v1.LoggingService/SetLogLevel \
  -H "Content-Type: application/json" \
  -d '{"level":"LOG_LEVEL_FATAL"}'
```

### Using binary protobuf encoding

If you have the generated Python bindings or a protobuf-capable client:

```python
# Using the generated admin client (from tests/blackbox/admin_client/client.py)
from admin_client.client import AdminClient, LogLevel

client = AdminClient("http://localhost:9090")
level = client.get_log_level()
print(f"Current level: {level}")

client.set_log_level(LogLevel.DEBUG)
client.close()
```

The client automatically uses `application/proto` encoding unless `use_json=True` is passed.

### Log level effect on the startup config

The `SetLogLevel` RPC changes the log level **in memory only** — it is not persisted to the config file. After a restart, Oxla reads `logging.level` from the YAML config (or `OXLA__LOGGING__LEVEL` env var) again.

---

## DebugService (read-only diagnostics)

`oxla.admin.v1.DebugService` (`src/admin/proto/debug.proto`) is a read-only
diagnostics surface consumed by `rpk debug bundle`. All RPCs are unary and read
internal state directly in-process (never through the SQL stack). Timestamps are
Unix epoch milliseconds. Same URL pattern as any admin RPC:
`POST /oxla.admin.v1.DebugService/<MethodName>`.

RPCs (stable method names; request/response fields evolve — verify against
`debug.proto`):

| RPC | Purpose |
|-----|---------|
| `GetVersion` | Build/version, commit SHA, image tag/digest, hostname, node id |
| `GetConfig` | Node's **effective** config as redacted YAML (see below) |
| `GetClusterNodes` | Cluster membership, roles, leader, heartbeat state |
| `GetCatalogHead` | Raw persisted `CatalogHead` proto bytes |
| `GetRecentQueries` / `GetActiveQueries` | Query history / in-flight queries (SQL text masked by default via `SqlTextMode`) |
| `GetResourceUsage` | CPU ticks, memory, disk counters (client samples twice to derive %) |
| `GetOxlaHomeListing` | File listing under the data directory |
| `GetLogTail` / `GetStartupLog` / `GetCrashReports` | Log tails, startup logs, crash reports |
| `GetHostProbes` | Host/OS facts (`/proc/*`, `uname`, `df`, `free`, opt-in `vmstat`) |
| `GetCpuProfile` | gzipped pprof CPU profile (duration clamped server-side) |

### GetConfig — effective configuration

`GetConfig` returns the node's *effective* configuration — the parsed
`oxla.yaml` after environment-variable overrides — so support can inspect a
running cluster's config without shell access.

- Request: `GetConfigRequest {}` (empty).
- Response: `GetConfigResponse { string yaml = 1; }` — the merged config
  serialized as YAML.
- **Redaction is server-side**, driven by a maintained non-sensitive allowlist
  (deny-by-default): only allowlisted scalar paths are emitted verbatim; every
  other scalar — secrets, sequence-nested values, and unknown/injected keys — is
  replaced by the placeholder `***`. SSL/TLS entries are file *paths* (not key
  material), so they stay visible.

```bash
curl -s -X POST \
  http://localhost:9090/oxla.admin.v1.DebugService/GetConfig \
  -H "Content-Type: application/json" \
  -d '{}'
# Response: {"yaml":"access_control:\n  initial_password: \"***\"\n..."}
```

---

## Error Responses

The admin API returns ConnectRPC-style JSON error objects for failures:

```json
{"code":"not_found","message":"unknown method"}
```

HTTP status codes returned for errors:

| ConnectRPC error code | HTTP status |
|-----------------------|-------------|
| `not_found` | 404 |
| `invalid_argument` | 400 |
| `permission_denied` | 403 |
| `unavailable` | 503 |
| `internal` | 500 |
| `unauthenticated` | 401 |
| `already_exists` | 409 |
| `resource_exhausted` | 429 |
| `unimplemented` | 404 |

Unsupported content types (anything other than `application/proto` or `application/json`) return `400 invalid_argument`.

Non-POST requests other than `GET /healthz` return `405 Method Not Allowed`.

---

## Admin API TLS Configuration

The admin API can be TLS-secured independently of the PostgreSQL port. This uses the `admin_api.ssl` block in the config (all parameters are **internal** — not in the public set):

```yaml
admin_api:
  enabled: true
  port: 9090
  workers: 2
  ssl:
    mode: "require"          # "off" | "optional" | "require"
    cert_file: "/certs/admin.crt"
    key_file: "/certs/admin.key"
    ca_crt_file: ""          # set for mTLS (client cert verification)
    min_protocol_version: 1.2
    max_protocol_version: 1.3
```

Via env vars:
```bash
OXLA__ADMIN_API__SSL__MODE=require
OXLA__ADMIN_API__SSL__CERT_FILE=/certs/admin.crt
OXLA__ADMIN_API__SSL__KEY_FILE=/certs/admin.key
OXLA__ADMIN_API__SSL__CA_CRT_FILE=/certs/client-ca.pem   # only for mTLS
```

**SSL modes for the admin API:**
- `off` — plain HTTP (default)
- `optional` — accepts both TLS and plain connections
- `require` — TLS only; plain HTTP connections are rejected

**mTLS (mutual TLS):** When `ca_crt_file` is set, the server requires a client certificate signed by that CA. This is only valid with `ssl.mode: require`.

Example curl with TLS:
```bash
curl -s --cacert /certs/admin-ca.pem \
  -X POST https://localhost:9090/oxla.admin.v1.LoggingService/GetLogLevel \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Prometheus Metrics Endpoint

Oxla exposes Prometheus metrics on port 8080 (configurable via `metrics.port`). This is a plain HTTP server — no authentication.

```bash
# Scrape all metrics (metrics endpoint is on port 8080, not 9090)
curl http://localhost:8080/metrics

# Scrape from a remote node
curl http://oxla-node-1:8080/metrics
```

To disable the metrics endpoint:
```bash
OXLA__METRICS__NO_EXPOSER=true
# or in config:
metrics:
  no_exposer: true
```

For a list of available Prometheus metrics and their meaning, see the `sql-debugging` skill's `metrics-and-logging.md` reference.

---

## Memory and OOM Controls

Memory limits are controlled by two parameters (both **internal**):

```yaml
memory:
  max: 0           # query memory budget
                   # 0 = Oxla reads available RAM from OS and calculates max
                   # Minimum non-zero value: 8G (e.g., "8G", "32G")
  max_non_query: 6442M  # non-query memory (buffers, catalog cache, etc.)
                         # Must be at least ~6442 MB
```

Setting `max: 0` is recommended unless you need to cap Oxla's memory usage explicitly (e.g., when running alongside other workloads on the same machine).

OOM behavior: Oxla runs a background OOM monitor that samples the process RSS (Resident Set Size) from `/proc/self/status`. When RSS exceeds the operational limit — the total memory budget minus a ~1% margin — the monitor triggers two emergency actions: (1) cancels all running queries (logged as "cancelled due to OOM prevention") and (2) evicts the entire storage cache. The trigger threshold is slightly below `memory.max`, not exactly equal to it.

To observe memory pressure, scrape the `oxla_process_memory_total` Prometheus metric (process RSS in bytes) exposed on port 8080. See the `sql-debugging` skill's `metrics-and-logging.md` reference for a full list of available metrics.

Via env vars:
```bash
OXLA__MEMORY__MAX=32G          # or 0 for auto-detect
OXLA__MEMORY__MAX_NON_QUERY=8G
```

---

## Runtime Log Level Workflow

Recommended pattern for temporary debug logging without restart:

```bash
# 1. Save current level
CURRENT=$(curl -s -X POST http://localhost:9090/oxla.admin.v1.LoggingService/GetLogLevel \
  -H "Content-Type: application/json" -d '{}' | python3 -c "import sys,json; print(json.load(sys.stdin)['level'])")
echo "Current level: $CURRENT"

# 2. Bump to DEBUG
curl -s -X POST http://localhost:9090/oxla.admin.v1.LoggingService/SetLogLevel \
  -H "Content-Type: application/json" \
  -d '{"level":"LOG_LEVEL_DEBUG"}'

# 3. Reproduce the issue / collect logs

# 4. Restore original level
curl -s -X POST http://localhost:9090/oxla.admin.v1.LoggingService/SetLogLevel \
  -H "Content-Type: application/json" \
  -d "{\"level\":\"$CURRENT\"}"
```

**Note:** The change takes effect immediately across all running queries but does **not** persist across restarts. To make the change permanent, update `OXLA__LOGGING__LEVEL` in your config or env vars.

---

## Admin API Configuration Reference

| Config key | Env var | Default | Type | Public? |
|-----------|---------|---------|------|--------|
| `admin_api.enabled` | `OXLA__ADMIN_API__ENABLED` | `true` | bool | Internal |
| `admin_api.port` | `OXLA__ADMIN_API__PORT` | `9090` | uint16 | Internal |
| `admin_api.workers` | `OXLA__ADMIN_API__WORKERS` | `2` | uint16 | Internal |
| `admin_api.ssl.mode` | `OXLA__ADMIN_API__SSL__MODE` | `"off"` | string | Internal |
| `admin_api.ssl.ca_crt_file` | `OXLA__ADMIN_API__SSL__CA_CRT_FILE` | `""` | string | Internal |
| `admin_api.ssl.cert_file` | `OXLA__ADMIN_API__SSL__CERT_FILE` | `""` | string | Internal |
| `admin_api.ssl.key_file` | `OXLA__ADMIN_API__SSL__KEY_FILE` | `""` | string | Internal |
| `admin_api.ssl.min_protocol_version` | `OXLA__ADMIN_API__SSL__MIN_PROTOCOL_VERSION` | `1.2` | float | Internal |
| `admin_api.ssl.max_protocol_version` | `OXLA__ADMIN_API__SSL__MAX_PROTOCOL_VERSION` | `1.3` | float | Internal |

The `admin_api` requires at least 1 worker thread (`workers > 0`). If set to 0, startup throws `"Admin API requires at least 1 worker thread"`.

---

## Adding New Admin Services (Developer Notes)

The admin server uses a ConnectRPC codegen pattern. To add a new service:

1. Create a proto file in `src/admin/proto/` (e.g., `cluster.proto`)
2. Add it to `proto/CMakeLists.txt` using `protobuf_generate_connect`
3. Implement the generated `*ServiceBase` abstract class
4. Register routes via `service_impl.registerRoutes(router)` in `server.cpp`

URL pattern for any service: `POST /oxla.admin.v1.<ServiceName>/<MethodName>`

Only unary RPCs are supported; the codegen rejects streaming RPCs. Handlers run synchronously on the server's worker threads — keep them fast.
