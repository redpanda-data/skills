---
name: connect-debugging
description: "Behavioral guidance for debugging Redpanda Connect pipelines. Use when: a pipeline fails, stalls, drops messages, or won't start. This skill provides agent choreography - the actual commands and config syntax come from docs."
metadata:
  version: "2.0.0"
---

# Connect Debugging: Agent Behavior Guide

This skill provides behavioral guidance for debugging Redpanda Connect pipelines. For command syntax, config fields, and detailed procedures, see the [Redpanda Connect documentation](https://docs.redpanda.com/redpanda-connect/).

## First three moves

When a Redpanda Connect pipeline isn't working:

1. **Lint the config first** — run `rpk connect lint ./pipeline.yaml`. If it fails, fix structural errors before anything else.
2. **Check for license issues** — if using enterprise connectors (CDC inputs), verify the license is loaded. Look for the startup log line with `license_type=enterprise`.
3. **Run with DEBUG logging** — use `rpk connect run --log.level DEBUG ./pipeline.yaml` to see what's actually happening.

## Decision tree

| Symptom | First Move |
|---------|-----------|
| Pipeline exits immediately | `rpk connect lint` first, then check stderr for the first ERROR line |
| `/ready` stuck at 503 | Check input/output connection errors in DEBUG logs — something can't connect |
| Messages dropping silently | Enable DEBUG logging; look for `failed to process` or output errors |
| Enterprise component fails | Check license: `REDPANDA_LICENSE` env var or `--redpanda-license` flag |
| TLS handshake failure | Verify cert paths exist and certs aren't expired |
| Auth / credential error | Use `rpk connect dry-run --verbose` to surface the exact connection error |
| High latency / backpressure | Compare `output_sent` vs `input_received` in metrics |
| Memory growth | Enable debug endpoints; capture heap profile at `/debug/pprof/heap` |

## Validation before deployment

Always validate in this order:

1. **`rpk connect lint`** — catches structural YAML errors, missing required fields
2. **`rpk connect dry-run`** — tests actual connections (credentials, network, TLS)
3. **`rpk connect run` with DEBUG** — run briefly to verify messages flow end-to-end

## Red herrings to avoid

- **`/ready` returning 503 at startup is normal** — it returns 200 only when both input AND output are connected. Give it time.
- **Missing metrics doesn't mean failure** — metrics only appear for features in use. No consumer groups = no consumer metrics.
- **"Component does not exist" might be an allow/deny list** — check `/etc/redpanda/connector_list.yaml` if a known component is rejected.

## Health endpoints

Use these for Kubernetes probes:
- `/ping` → liveness probe (always 200 while process is up)
- `/ready` → readiness probe (200 only when input + output connected)

## Enterprise features

For CDC inputs (postgres_cdc, mysql_cdc, mongodb_cdc, etc.):

1. **Always verify license first** — these are enterprise connectors that fail without a license
2. **License is checked at connection time** — `dry-run` will surface license errors
3. **Default license path** is `/etc/redpanda/redpanda.license`

## When to escalate

- Pipeline runs but data is silently corrupted
- Memory leaks despite proper configuration
- Intermittent failures with no pattern in logs
- Performance degradation with no obvious bottleneck

**Docs**: [Redpanda Connect](https://docs.redpanda.com/redpanda-connect/) · [Configuration](https://docs.redpanda.com/redpanda-connect/configuration/about/) · [Components](https://docs.redpanda.com/redpanda-connect/components/about/)
