---
name: connect-debugging
description: >-
  Diagnoses, validates, and monitors Redpanda Connect pipelines. Use when a
  Redpanda Connect pipeline fails, stalls, drops messages, or won't start; when
  linting a config with rpk connect lint; tuning log level or format; reading
  Connect metrics (Prometheus, statsd, json_api) or traces (OpenTelemetry);
  checking /ready and /ping health endpoints; running a dry-run connection test;
  or diagnosing connector failures including auth errors, TLS errors, Enterprise
  license errors, backpressure, and checkpoint/cache issues. Covers Redpanda
  Connect enterprise features and their config keys: enterprise connectors
  including all CDC inputs (postgres_cdc, mysql_cdc, mongodb_cdc, oracledb_cdc
  logminer block), connector allow/deny lists, secrets management URNs, the
  redpanda: configuration service block, and FIPS compliance — all requiring an
  Enterprise license.
---

# Redpanda Connect: Debugging

Redpanda Connect (formerly Benthos) provides built-in tools for validating
configs before deployment, tuning structured logs, exporting metrics to
Prometheus or StatsD, shipping traces to OpenTelemetry, and probing pipeline
health over HTTP. This skill covers the full debugging lifecycle: lint before
you deploy, tune logging to see what is happening, scrape metrics to quantify
it, and use the health endpoints to build reliable probes.

The HTTP server (default `0.0.0.0:4195`) provides `/ping` (liveness),
`/ready` (readiness — 200 only when both input and output are connected), and
`/metrics`/`/stats` (metrics). Use `debug_endpoints: true` to expose pprof.

## Quickstart

```bash
# 1. Lint a config (exit 1 on any error)
rpk connect lint ./pipeline.yaml

# Lint with extra checks: flag deprecated fields, require labels
rpk connect lint --deprecated --labels ./pipeline.yaml

# Lint without failing on unset env vars (useful in CI without secrets)
rpk connect lint --skip-env-var-check ./pipeline.yaml

# 2. Dry-run: lint + test actual connections (does the broker accept the creds?)
rpk connect dry-run ./pipeline.yaml

# Dry-run with verbose per-file output
rpk connect dry-run --verbose ./pipeline.yaml

# 3. Run with DEBUG logging to see what is happening
rpk connect run --log.level DEBUG ./pipeline.yaml

# 4. Check health endpoints (pipeline must be running on port 4195)
curl -s http://localhost:4195/ping          # 200 OK = process alive
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:4195/ready              # 200 = input+output connected, 503 = not yet

# 5. Scrape metrics (when metrics: prometheus or json_api is configured)
curl -s http://localhost:4195/metrics      # Prometheus text format
curl -s http://localhost:4195/stats        # Alias; also serves json_api format
```

Add this block to a pipeline config to expose Prometheus metrics and bump
logging to DEBUG for initial troubleshooting:

```yaml
http:
  address: 0.0.0.0:4195
  debug_endpoints: false   # set true to enable /debug/pprof/* endpoints

logger:
  level: DEBUG             # OFF FATAL ERROR WARN INFO DEBUG TRACE ALL NONE
  format: logfmt           # logfmt or json
  add_timestamp: true
  static_fields:
    '@service': redpanda-connect

metrics:
  prometheus: {}
  mapping: ""              # optional Bloblang filter/rename for metric names
```

## Linting and Validation

`rpk connect lint` parses pipeline YAML and reports structural errors before
the pipeline ever runs. It exits with status code 1 if any lint error is found.

### Flags

Note: `internal/cli/custom_lint.go` implements `customLintCli()`, which is
the `mcp-server lint` subcommand (directory-only). The top-level `rpk connect
lint` accepting file paths/globs is from the upstream Benthos framework. The
flags below apply to both.

| Flag | Default | Effect |
|------|---------|--------|
| `--deprecated` | false | Fail on use of deprecated fields |
| `--labels` | false | Fail when components are missing `label:` |
| `--skip-env-var-check` | false | Do not fail when `${ENV_VAR}` interpolations have no default and the variable is not set |
| `--verbose` | false | Print OK/FAILED for every file scanned |
| `--env-file` / `-e` | (none) | Load a `.env` dotenv file before linting |
| `--secrets` | `env:` | Secret lookup URNs (e.g. `env:`, `none:`) |

```bash
# Lint a single file
rpk connect lint pipeline.yaml

# Lint all YAML files in a directory tree
rpk connect lint ./config/...

# CI-friendly: strict mode, skip unset env vars, verbose output
rpk connect lint --deprecated --labels --skip-env-var-check --verbose ./pipelines/
```

### Dry-run (connection test)

`rpk connect dry-run` goes beyond lint: it parses the config and attempts to
establish actual connections to every component. It exits 1 if any connection
test fails. This is the fastest way to detect credential/network problems
before deploying. It accepts an optional `--redpanda-license` flag for testing
Enterprise components.

```bash
rpk connect dry-run ./pipeline.yaml
rpk connect dry-run --verbose ./pipeline.yaml
```

## Logger Configuration

Configure the `logger:` section to control level and format. Full schema with
all fields in [`references/logging-metrics-tracing.md`](references/logging-metrics-tracing.md).

Key levels (grounded in `docs/modules/components/pages/logger/about.adoc`):
`OFF`, `FATAL`, `ERROR`, `WARN`, `INFO` (default), `DEBUG`, `TRACE`, `ALL`, `NONE`.

```yaml
logger:
  level: INFO     # OFF FATAL ERROR WARN INFO DEBUG TRACE ALL NONE
  format: logfmt  # logfmt (default) or json
  add_timestamp: true
  static_fields:
    '@service': redpanda-connect
```

Override level on the CLI without editing the config:

```bash
rpk connect run --log.level DEBUG ./pipeline.yaml
```

## Metrics Backends

Configure the `metrics:` section. All backends accept `mapping:` to filter or
rename metric paths. Full YAML schemas for all backends in
[`references/logging-metrics-tracing.md`](references/logging-metrics-tracing.md).

| Backend | Use case |
|---------|----------|
| `prometheus:` | Production scraping via `/metrics` |
| `statsd:` | Push to StatsD/DataDog/InfluxDB |
| `json_api:` | Quick inspection with `curl`/`jq` at `/metrics` |
| `logger:` | Emit as log lines (no HTTP server needed) |

Key standard metric names: `input_received`, `input_latency`, `output_sent`.

## Tracing (OpenTelemetry)

Send distributed traces to an OpenTelemetry collector. Full schema in
[`references/logging-metrics-tracing.md`](references/logging-metrics-tracing.md).

```yaml
tracer:
  open_telemetry_collector:
    service: redpanda-connect
    grpc:
      - address: "localhost:4317"
        secure: false
    sampling:
      enabled: true
      ratio: 0.1    # sample 10% for high-volume pipelines
```

## Health Endpoints

The HTTP server (default `0.0.0.0:4195`) exposes these endpoints.
Grounded in `docs/modules/components/pages/http/about.adoc`.

| Endpoint | Purpose |
|----------|---------|
| `/ping` | Liveness: always 200 while process is up |
| `/ready` | Readiness: 200 when input AND output connected; 503 otherwise |
| `/metrics`, `/stats` | Metrics (prometheus or json_api format) |

`/ready` returning 503 is normal at startup. In Kubernetes use `/ping` as
liveness and `/ready` as readiness.

Set `http.debug_endpoints: true` to expose `/debug/pprof/*` (CPU profile,
heap, goroutine, block, mutex) and `/debug/config/json|yaml`. See full
endpoint list and curl examples in
[`references/logging-metrics-tracing.md`](references/logging-metrics-tracing.md).

## Enterprise License and Enterprise Features

Several Redpanda Connect features are **Enterprise** and require a valid Redpanda
Enterprise license: all enterprise connectors (including the CDC inputs),
connector allow/deny lists, secrets management (remote runtime lookup), the
`redpanda:` configuration service block, and FIPS compliance. After the 30-day
trial expires you are blocked from using enterprise connectors until you upgrade.
Full per-feature config keys (including the `logminer{}` sub-block, the
`connector_list.yaml` allow/deny structure, and `--secrets` URN schemes) are in
[`references/enterprise-features.md`](references/enterprise-features.md).

Enterprise components (CDC inputs: postgres_cdc, mysql_cdc, mongodb_cdc,
oracledb_cdc, microsoft_sql_server_cdc, aws_dynamodb_cdc, gcp_spanner_cdc,
salesforce_cdc) require a Redpanda Enterprise license. Without one, these
components fail at connection time with a license error. (tigerbeetle_cdc is
the exception among CDC inputs: it is a certified community component — no
license required — but it needs a CGO-enabled Connect build; it is absent
from `rpk connect` and the standard Docker image, so a "component not found"
error there is a build issue, not a license issue.)

**Default license path:** `/etc/redpanda/redpanda.license`
(grounded in `internal/license/service.go`, constant `defaultLicenseFilepath`)

**Environment variables:**
- `REDPANDA_LICENSE` — inline license string
- `REDPANDA_LICENSE_FILEPATH` — path to license file

**CLI flag:**
```bash
rpk connect run --redpanda-license "$(cat redpanda.license)" ./pipeline.yaml
rpk connect dry-run --redpanda-license "$(cat redpanda.license)" ./pipeline.yaml
```

The license service logs on startup:
```
level=info msg="Successfully loaded Redpanda license" license_org=MyOrg license_type=enterprise expires_at=2026-01-01T00:00:00Z
```

If no valid Enterprise license is found, a 10-year open-source license is
applied automatically. Attempting to use an Enterprise component under the
open-source license produces an error at connection time (visible in dry-run).

**Allow/deny list:** `/etc/redpanda/connector_list.yaml` restricts which
components an instance may run (`allow:` OR `deny:`, never both). If a component
unexpectedly "does not exist," check this file. See
[`references/enterprise-features.md`](references/enterprise-features.md).

**Secrets management:** the `--secrets <urn>` flag resolves `${SECRET}`
interpolations from a remote system at runtime. Schemes: `env:`, `none:`,
`aws:`, `gcp:`, `az:`, `redis:`. URNs are tried in order; first hit wins.

## Common Failure Modes

See [`references/failure-modes.md`](references/failure-modes.md) for a
step-by-step triage checklist. Quick index:

| Symptom | First move |
|---------|-----------|
| Pipeline exits immediately | `rpk connect lint` then check stderr for the first ERROR line |
| `/ready` stuck at 503 | Check input/output connection errors in DEBUG logs |
| Messages drop silently | Enable `logger.level: DEBUG`; look for `failed to process` or output errors |
| Enterprise component fails | Check license: `REDPANDA_LICENSE` env or `--redpanda-license` flag |
| TLS handshake failure | Verify `tls.root_cas_file` path and cert expiry |
| Auth / credential error | Use `rpk connect dry-run --verbose` to surface the exact connection error |
| High latency / backpressure | Check `output_sent` vs `input_received` in metrics; inspect buffer config |
| Memory growth | Enable `http.debug_endpoints: true`; capture heap profile |

## Reference Directory

- [lint-and-validate.md](references/lint-and-validate.md): `rpk connect lint` and `rpk connect dry-run` flags, exit codes, what each catches, env-var interpolation handling, and CI integration patterns.
- [logging-metrics-tracing.md](references/logging-metrics-tracing.md): Full logger config (all levels and fields), all metrics backends (prometheus/statsd/json_api/logger) with complete YAML, OpenTelemetry tracer config, and the `/ping`/`/ready` endpoint reference.
- [failure-modes.md](references/failure-modes.md): Triage checklist for common Connect failure modes: connection/TLS/auth errors, checkpoint/cache failures, Enterprise license errors, backpressure and consumer lag, and memory pressure — each with the exact knob to turn.
- [enterprise-features.md](references/enterprise-features.md): Redpanda Connect enterprise features and their nested config keys (all require an Enterprise license): license loading order (`--redpanda-license`, `REDPANDA_LICENSE`, `REDPANDA_LICENSE_FILEPATH`, `/etc/redpanda/redpanda.license`); enterprise CDC inputs with full skeletons (postgres_cdc slot/heartbeat, mysql_cdc binlog/checkpoint_cache, mongodb_cdc change streams, oracledb_cdc `logminer{}` block); connector allow/deny lists (`/etc/redpanda/connector_list.yaml`); secrets management `--secrets` URN schemes; the `redpanda:` configuration service block; and FIPS compliance.
