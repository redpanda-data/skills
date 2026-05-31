# Lint and Validate: rpk connect lint / dry-run

Pre-deployment validation prevents runtime surprises. Redpanda Connect
provides two levels: `rpk connect lint` (static structural analysis) and
`rpk connect dry-run` (structural analysis + live connection tests).

The dry-run command is grounded in `connect/internal/cli/dry_run.go`.

Note on source attribution: `connect/internal/cli/custom_lint.go` implements
`customLintCli()`, which is wired as the `mcp-server lint` subcommand (a
directory-only lint for MCP server repositories). The top-level `rpk connect
lint` command that accepts YAML file paths and globs comes from the upstream
Benthos framework (not in this source tree). The flags documented below match
both implementations.

---

## rpk connect lint

Parses one or more pipeline YAML files and reports structural errors: unknown
fields, wrong types, missing required fields, deprecated fields (with
`--deprecated`), and missing labels (with `--labels`). It also validates
Bloblang expressions embedded in processors and the `mapping:` field.

**Exit code:** `0` = no lint errors. `1` = at least one lint error found.

Lint errors are written to **stderr** in yellow. Parse errors are in red.
When `--verbose` is set, each file gets an `OK` or `FAILED` status line on
stdout.

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--deprecated` | `false` | Emit lint errors when deprecated fields are used |
| `--labels` | `false` | Emit lint errors when components do not have a `label:` field |
| `--skip-env-var-check` | `false` | Do not fail on `${ENV_VAR}` interpolations that are undefined and have no default value |
| `--verbose` | `false` | Print `OK` or `FAILED` for every file scanned |
| `--env-file` / `-e` | (none) | Load a `.env` dotenv file to set environment variables before linting |
| `--secrets` | `env:` | Secret lookup URN list; `env:` (default) looks up env vars, `none:` disables all lookups |

### Usage patterns

```bash
# Lint a single file
rpk connect lint pipeline.yaml

# Lint with glob
rpk connect lint "./pipelines/*.yaml"

# Walk a directory tree (Connect-style glob pattern)
rpk connect lint "./pipelines/..."

# Strict CI mode: flag deprecated usage, require labels, verbose
rpk connect lint --deprecated --labels --verbose ./pipelines/

# Skip env-var check (useful in CI where secrets are not injected at lint time)
rpk connect lint --skip-env-var-check --verbose ./pipelines/

# Provide a dotenv file so env var substitutions can be resolved
rpk connect lint --env-file .env.lint ./pipeline.yaml
```

### What lint catches

- **Unknown fields**: a field name that does not exist in the component schema
- **Wrong types**: e.g., setting an integer field to a string
- **Missing required fields**: component config missing a required value
- **Invalid Bloblang**: syntax errors in `mapping:` and processor Bloblang
- **Undefined env vars** (when `--skip-env-var-check` is false): `${FOO}` where `FOO` is not set and has no default (e.g. `${FOO:default_value}`)
- **Deprecated fields** (with `--deprecated`): fields that have been superseded
- **Missing labels** (with `--labels`): components without `label:` annotations

### What lint does NOT catch

- Network connectivity issues (wrong broker address, wrong credentials)
- Schema Registry auth
- Enterprise license requirements (these surface at dry-run or runtime)
- Logical errors in Bloblang that are syntactically valid

---

## rpk connect dry-run

`rpk connect dry-run` extends lint by actually building every component and
attempting to connect. It runs the full config parse, wires up the components,
and calls `ConnectionTest()` on each — a lightweight probe that opens and
immediately closes the connection.

**Exit code:** `0` = all connections succeeded (or returned "not supported").
`1` = at least one connection failed.

Connection errors are written to **stderr** in red. Components that do not
support connection testing emit a yellow warning in verbose mode but do not
cause a failure exit.

All flags grounded in `dryRunCli()` in `dry_run.go`:

| Flag | Default | Description |
|------|---------|-------------|
| `--verbose` | `false` | Print `OK` or `FAILED` for every file |
| `--env-file` / `-e` | (none) | Load dotenv file |
| `--secrets` | `env:` | Secret lookup URN list |
| `--redpanda-license` | (none) | Provide an inline Enterprise license to enable Enterprise component tests |

```bash
# Test all connections in a single file
rpk connect dry-run ./pipeline.yaml

# Verbose (prints per-file result)
rpk connect dry-run --verbose ./pipeline.yaml

# With a dotenv file for credentials
rpk connect dry-run --env-file .env.staging ./pipeline.yaml

# Test an Enterprise component (e.g. postgres_cdc, mysql_cdc)
rpk connect dry-run --redpanda-license "$(cat /etc/redpanda/redpanda.license)" \
  ./cdc-pipeline.yaml

# Test a directory of pipelines
rpk connect dry-run --verbose ./pipelines/
```

### When dry-run is more useful than lint

- Validating broker/database credentials before deploying
- Confirming TLS certificates work end-to-end
- Testing that a Schema Registry URL is reachable
- Confirming an Enterprise license is valid and the component is licensed
- Staging environment gate: run dry-run in CI with real staging credentials

### Interpreting dry-run output

The output format is `<file>: [<label>] <error>` (grounded in `dry_run.go`).
The examples below are illustrative; exact error text comes from the component:

```
# Successful run (verbose):
./pipeline.yaml: OK

# A connection failure (exact text from the component's error):
./pipeline.yaml: [.input.kafka_franz] dial tcp: connection refused

# Component does not support connection testing (verbose only, yellow, not a failure):
# The exact "not supported" text comes from service.ErrConnectionTestNotSupported
./pipeline.yaml: [.output.some_output] connection test not supported
```

The label shown in brackets is either the component's `label:` value, or the
dotted path (`.input.kafka_franz`) if no label is set — another reason to
always set labels (use `--labels` in CI to enforce this).

---

## CI Integration

A two-stage gate works well:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Stage 1: structural validation (no credentials needed)
echo "=== Linting configs ==="
rpk connect lint --deprecated --labels --skip-env-var-check --verbose \
  "./pipelines/*.yaml"

# Stage 2: connection test (uses injected secrets)
echo "=== Testing connections ==="
rpk connect dry-run --verbose \
  --env-file .env.ci \
  "./pipelines/*.yaml"

echo "All validations passed."
```

The `--skip-env-var-check` flag on the lint stage means the lint can run in
any environment (without secrets injected). The dry-run stage uses real
credentials from `.env.ci`.

---

## Template Files

To run a pipeline with templates, pass the templates directory at run time:

```bash
rpk connect run -t "./templates/*.yaml" ./config.yaml
```

Note: A `rpk connect template lint` subcommand and markdown-file lint support
are not verified against the source tree in this repository. Consult
`rpk connect --help` or the upstream Benthos documentation for the current
template-lint surface before relying on those invocations.

---

## Unit Tests

Connect has a built-in test framework for validating processor logic in
isolation:

```bash
# Run all unit tests
rpk connect test ./config/test/...

# Run tests for a specific config
rpk connect test ./pipeline.yaml

# Run with debug logging
rpk connect test --log DEBUG ./pipeline.yaml
```

Test files follow the naming convention `<name>_benthos_test.yaml`. See the
unit-testing docs for the test schema.
