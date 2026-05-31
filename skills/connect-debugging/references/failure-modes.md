# Common Failure Modes and Triage

A step-by-step triage guide for the most common Redpanda Connect failure modes.
Each section identifies symptoms, the exact diagnostic command or config knob,
and the fix. Grounded in:
- `connect/internal/cli/dry_run.go` (connection test)
- `connect/internal/cli/custom_lint.go` (lint)
- `connect/internal/license/service.go` (license handling)
- `connect/docs/modules/components/pages/logger/about.adoc`
- `connect/docs/modules/components/pages/metrics/` (metrics)
- `connect/docs/modules/components/pages/http/about.adoc` (health endpoints)

---

## Triage Checklist (start here)

```bash
# 1. Lint the config (catches syntax/schema errors immediately)
rpk connect lint ./pipeline.yaml

# 2. Dry-run to test actual connections (catches credential/network errors)
rpk connect dry-run --verbose ./pipeline.yaml

# 3. Run with DEBUG logging to see per-message events
rpk connect run --log.level DEBUG ./pipeline.yaml 2>&1 | tee /tmp/connect.log

# 4. Check health (pipeline must be running)
curl -s http://localhost:4195/ping   # 200 = alive
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4195/ready  # 503 until connected

# 5. Check metrics (if prometheus or json_api is configured)
curl -s http://localhost:4195/metrics
```

---

## Pipeline Exits Immediately at Startup

**Symptoms:** `rpk connect run` exits within seconds; no messages processed.

**Diagnostics:**

```bash
# Run and capture stderr
rpk connect run ./pipeline.yaml 2>&1 | head -50

# Check the first ERROR line
rpk connect run ./pipeline.yaml 2>&1 | grep -E 'level=(error|fatal)'
```

**Common causes:**

| Error in stderr | Cause | Fix |
|-----------------|-------|-----|
| `field: unknown field` or `yaml: unmarshal errors` | Invalid config field name (typo or wrong component) | Run `rpk connect lint` to pinpoint the exact field |
| `failed to read Redpanda License` | An explicit license path/file is set but unreadable or parse fails (grounded in `service.go`) | Check path, permissions, or set `REDPANDA_LICENSE` env var instead |
| `license expired on <date>` | Enterprise license has expired (grounded in `service.go`) | Renew license |
| `this feature requires a valid Redpanda Enterprise Edition license...` | Using an Enterprise component (postgres_cdc, mysql_cdc, etc.) with no valid Enterprise license (exact error from `shared_service.go:CheckRunningEnterprise`) | Provide a valid Enterprise license |
| `unknown component type` | Component name is wrong or from a different distribution | Check the component name in the Connect documentation; `rpk connect list` (upstream Benthos command) lists available components by type |

---

## /ready Stuck at 503 (Pipeline Unhealthy)

**Symptoms:** Pipeline is running but `/ready` returns 503; consumers not
receiving messages.

**Meaning:** At least one of the input or output has not yet established its
connection. `/ready` returns 200 only when **both** the input and output are
fully connected (grounded in `http/about.adoc`).

**Diagnostics:**

```bash
# Check ready status
curl -s -o /dev/null -w "%{http_code}" http://localhost:4195/ready

# Look for connection-related log lines at DEBUG level
rpk connect run --log.level DEBUG ./pipeline.yaml 2>&1 | grep -i "connect\|reconnect\|failed\|error"
```

**Common causes:**

| Logged message | Cause | Fix |
|----------------|-------|-----|
| `connection refused` | Broker/database port not reachable | Check firewall, hostname, port |
| `i/o timeout` | Network timeout reaching host | Check DNS resolution; increase component's `timeout` field |
| `SASL handshake failed` | Wrong SASL mechanism or credentials | Verify mechanism (SCRAM-SHA-256/512, PLAIN), username, password |
| `tls: failed to verify certificate` | TLS cert CN/SAN mismatch or untrusted CA | Set `tls.root_cas_file` to the cluster's CA cert; disable `tls.skip_cert_verify` only for testing |
| `x509: certificate has expired` | Server cert expired | Renew the server certificate |
| `failed to connect to any seed broker` | Kafka brokers all unreachable | Verify `seed_brokers` list; check VPC/firewall; check that Redpanda is running |

---

## Messages Drop Silently

**Symptoms:** Pipeline appears healthy (`/ready` = 200), metrics show
`input_received` increasing, but no messages arrive at the output (or fewer
than expected).

**Diagnostics:**

```bash
# Step 1: Enable DEBUG to see per-message events
rpk connect run --log.level DEBUG ./pipeline.yaml 2>&1 | grep -i "failed\|error\|reject\|drop"

# Step 2: Check output_sent vs input_received with json_api metrics
# Add to config:
#   metrics:
#     json_api: {}
curl -s http://localhost:4195/metrics | jq '{input_received: .input_received, output_sent: .output_sent}'

# Step 3: Check if there are processor errors
curl -s http://localhost:4195/metrics | jq 'to_entries | map(select(.key | contains("error")))'
```

**Common causes:**

- **Bloblang mapping errors**: A processor `mapping:` expression throws an
  error for some messages. Errors cause messages to be flagged as failed;
  without a `catch:` or dead-letter output they are dropped.
  Fix: add error handling:

  ```yaml
  pipeline:
    processors:
      - mapping: |
          root = this.myfield  # will error if myfield is absent
      - catch:
          - log:
              level: ERROR
              message: "Processing error: ${!error()}"
  ```

- **Output rejects**: The output broker returns an error (e.g. message too
  large, auth failure). At INFO level these appear as output errors; at DEBUG
  you see the full broker response.

- **Batching/buffering**: Some outputs batch messages; if the batch never
  fills (or flush period is very long), messages appear to stall.

- **Schema mismatch in CDC pipelines**: An unexpected message type (e.g.
  a DDL event) causes a decoder panic that is caught and dropped.

---

## Connection / TLS / Auth Errors

**Symptoms:** Lint passes but dry-run or runtime reports connection failures.

### Kafka / Redpanda broker

```bash
# Step 1: Dry-run to see exact error
rpk connect dry-run --verbose ./pipeline.yaml

# Step 2: Test broker connectivity directly
rpk cluster info -X brokers=<broker:9092>
# Or with TLS + SASL:
rpk cluster info -X brokers=<broker:9092> \
  -X tls.enabled=true \
  -X sasl.mechanism=SCRAM-SHA-256 \
  -X sasl.username=myuser \
  -X sasl.password=mypass
```

**Typical error messages and fixes:**

| Error | Fix |
|-------|-----|
| `SASL auth failure: SASL handshake first` | Add TLS to config; broker requires TLS before SASL |
| `unknown SASL mechanism` | Change mechanism to one the broker supports (SCRAM-SHA-256, SCRAM-SHA-512, PLAIN) |
| `TOPIC_AUTHORIZATION_FAILED` | User lacks ACL for the topic; grant ACL via `rpk security acl create` |
| `x509: certificate signed by unknown authority` | Set `tls.root_cas_file` to the broker's CA cert path |
| `dial tcp: no such host` | DNS resolution failed; check `seed_brokers` hostnames |

**Config template for TLS + SCRAM:**

```yaml
input:
  kafka_franz:
    seed_brokers:
      - broker.example.com:9093
    tls:
      enabled: true
      root_cas_file: /etc/ssl/certs/redpanda-ca.pem
    sasl:
      - mechanism: SCRAM-SHA-256
        username: "${KAFKA_USER}"
        password: "${KAFKA_PASSWORD}"
    topics: ["my-topic"]
    consumer_group: my-group
```

### Database connections (CDC)

```bash
# Test a Postgres DSN directly
psql "postgresql://user:pass@host:5432/dbname?sslmode=require"

# Test MySQL
mysql -h host -P 3306 -u user -p dbname

# For dry-run with Enterprise license:
rpk connect dry-run --redpanda-license "$(cat /etc/redpanda/redpanda.license)" \
  ./cdc-pipeline.yaml
```

---

## Enterprise License Errors

Enterprise components (CDC inputs: `postgres_cdc`, `mysql_cdc`, `mongodb_cdc`,
`microsoft_sql_server_cdc`, `oracledb_cdc`, `gcp_spanner_cdc`,
`aws_dynamodb_cdc`, `salesforce_cdc`) require a Redpanda Enterprise license.

**License loading order** (grounded in `internal/license/service.go`):
1. `--redpanda-license` CLI flag (inline license string)
2. `REDPANDA_LICENSE` environment variable
3. `REDPANDA_LICENSE_FILEPATH` environment variable (path to file)
4. Default file path: `/etc/redpanda/redpanda.license`
5. If none found: open-source license is applied (Enterprise components fail)

**Startup log when license loads successfully:**
```
level=info msg="Successfully loaded Redpanda license" license_org=MyOrg license_type=enterprise expires_at=2026-12-31T00:00:00Z
```

**When the default license file is absent (falls back to OSS silently):**

Per `internal/license/service.go`, when the default path
`/etc/redpanda/redpanda.license` does not exist, `readLicense()` returns nil
bytes and no error (`os.IsNotExist` path). The service then loads the built-in
10-year open-source license and logs at INFO:
```
level=info msg="Successfully loaded Redpanda license" license_org= license_type=opensource expires_at=...
```
No error is logged. Enterprise components then fail only at connection time.

**The `Failed to read Redpanda License` error** (grounded in `service.go:67`)
fires only when a license file exists but is unreadable (e.g., permission
denied), or when an explicit path/inline license is set but fails to parse or
has expired.

**At component startup with no Enterprise license** (grounded in
`internal/license/shared_service.go`, `CheckRunningEnterprise`):
```
this feature requires a valid Redpanda Enterprise Edition license that includes the Connect product. For more information check out: https://docs.redpanda.com/redpanda-connect/get-started/licensing/
```

### Fixing license errors

```bash
# Option 1: Env var (inline)
export REDPANDA_LICENSE="$(cat redpanda.license)"
rpk connect run ./pipeline.yaml

# Option 2: Env var (file path)
export REDPANDA_LICENSE_FILEPATH=/etc/redpanda/redpanda.license
rpk connect run ./pipeline.yaml

# Option 3: CLI flag
rpk connect run --redpanda-license "$(cat redpanda.license)" ./pipeline.yaml

# Option 4: Place at default path
cp redpanda.license /etc/redpanda/redpanda.license
rpk connect run ./pipeline.yaml
```

**Kubernetes secret mount:**
```yaml
# Mount the license as a file
volumeMounts:
  - name: license
    mountPath: /etc/redpanda
    readOnly: true
volumes:
  - name: license
    secret:
      secretName: redpanda-enterprise-license
      items:
        - key: license
          path: redpanda.license
```

**License expiry metric:**
When a valid Enterprise license is loaded, Connect emits:
```
redpanda_cluster_features_enterprise_license_expiry_sec
```
This is a gauge tracking seconds until license expiry (updated hourly).

```bash
# Check expiry (with prometheus metrics configured)
curl -s http://localhost:4195/metrics | grep license_expiry
```

---

## Checkpoint / Cache Failures (CDC inputs)

CDC inputs (mysql_cdc, microsoft_sql_server_cdc) require a cache resource for
checkpointing. Without it, the input fails to start.

**Symptom:** Error referencing `checkpoint_cache` resource not found.

```bash
# Check the error
rpk connect lint ./cdc-pipeline.yaml
rpk connect dry-run --verbose ./cdc-pipeline.yaml
```

**Fix:** Add a cache resource and reference it:

```yaml
cache_resources:
  - label: cdc_checkpoint
    redis:
      url: redis://localhost:6379

input:
  mysql_cdc:
    dsn: "user:pass@tcp(localhost:3306)/mydb"
    checkpoint_cache: cdc_checkpoint
    tables: ["my_table"]
```

For non-Redis environments, use the file cache:

```yaml
cache_resources:
  - label: cdc_checkpoint
    file:
      directory: /var/lib/connect/checkpoints

input:
  mysql_cdc:
    dsn: "user:pass@tcp(localhost:3306)/mydb"
    checkpoint_cache: cdc_checkpoint
    tables: ["my_table"]
```

If the checkpoint cache is unavailable at restart, the CDC input may
re-read from the beginning (snapshot mode) or fail to start.

---

## Backpressure and Consumer Lag

**Symptoms:** `input_received` growing faster than `output_sent`; memory
increasing; output errors (e.g. "too many requests", broker rate limiting).

**Diagnostics:**

```bash
# Compare input vs output rate
curl -s http://localhost:4195/metrics | \
  jq '{input_received: .input_received, output_sent: .output_sent}'

# If metrics are Prometheus:
# input_received{} / rate(...)  vs output_sent{} / rate(...)
```

**Fixes:**

1. **Slow output**: increase output parallelism if the component supports
   `max_in_flight`. Example for kafka output:

   ```yaml
   output:
     kafka_franz:
       seed_brokers: ["broker:9092"]
       topic: my-topic
       max_in_flight_requests: 10
       max_buffered_records: 50000
   ```

2. **Enable batching**: batch multiple messages into one write (reduces
   round-trips to the output):

   ```yaml
   output:
     kafka_franz:
       seed_brokers: ["broker:9092"]
       topic: my-topic
     batching:
       count: 1000
       period: 1s
   ```

3. **Add a buffer**: absorb bursty input with an in-memory buffer:

   ```yaml
   buffer:
     memory:
       limit: 536870912   # 512 MiB
   ```

4. **Scale pipeline threads**: increase `pipeline.threads`:

   ```yaml
   pipeline:
     threads: 4
     processors:
       - mapping: root = this
   ```

---

## Memory Growth / OOM

**Symptoms:** Connect process memory grows continuously; eventually killed by
OOM killer.

**Diagnostics:**

```bash
# Enable debug endpoints in config:
# http:
#   debug_endpoints: true

# Capture a heap profile
curl -s http://localhost:4195/debug/pprof/heap -o heap.prof
go tool pprof -http=:8080 heap.prof

# Goroutine leak check
curl -s "http://localhost:4195/debug/pprof/goroutine?debug=2" | head -100
```

**Common causes:**

- **Large in-flight batches**: `max_buffered_records` or buffer `limit` set
  too high. Reduce them.
- **Goroutine leak**: check goroutine count over time; a growing count
  indicates leaking goroutines in a component.
- **Unbounded cache**: a cache resource growing without eviction. Set a TTL
  or size limit.
- **CDC transaction cache too large** (oracledb_cdc): reduce
  `logminer.max_transaction_events` to limit in-memory transaction state.

---

## Pipeline Stalls (No Progress, No Errors)

**Symptoms:** `/ready` = 200, logs show no errors, but no messages flow.

**Diagnostics:**

```bash
# Enable TRACE to see individual message events
rpk connect run --log.level TRACE ./pipeline.yaml 2>&1 | tail -50

# Check if input component is blocked (e.g. waiting for messages that aren't there)
# and whether output is flushing
curl -s http://localhost:4195/metrics | jq '.'
```

**Common causes:**

- **Empty input topic**: input is polling but there is nothing to consume.
  Produce a test message.

- **Consumer group already at latest offset**: if `auto_offset_reset: latest`
  (or equivalent) and the group was already committed to the end, no new
  messages will flow until new ones arrive.

- **Output batch not flushing**: if `batching.count` is high and messages
  arrive slowly, the batch may not fill. Add `batching.period: 5s`.

- **Input paused by flow control**: a blocking output (e.g. rate-limited
  sink) pauses the input. Check output error rate in metrics.

- **Processor infinite loop** (rare): a processor Bloblang expression
  creates a loop. Check goroutine dump for stuck goroutines:
  ```bash
  curl -s "http://localhost:4195/debug/pprof/goroutine?debug=1" | head -50
  ```
