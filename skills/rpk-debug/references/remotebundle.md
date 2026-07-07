# rpk debug remote-bundle

`rpk debug remote-bundle` collects a diagnostics bundle from every broker in a remote Redpanda cluster by sending requests through the Admin API. Unlike `rpk debug bundle` (which must run on the broker host), `remote-bundle` can be executed from any machine that can reach the Admin API endpoints.

The result is a ZIP-of-ZIPs: a single archive containing one per-broker ZIP file, stored under `<download-root>/<broker-address>/<job-id>.zip`.

> **Redpanda Cloud:** not applicable. Remote bundles require the broker Admin API, which Redpanda Cloud does not expose; the Cloud docs list the Admin API, debug bundles, and `rpk debug` as unsupported — see "Scope: Self-Managed Deployments Only" in SKILL.md.

---

## Subcommands

| Subcommand | Description |
|---|---|
| `start` | Initiate bundle collection on all configured Admin API brokers |
| `status` | Poll collection status across all brokers |
| `download` | Download completed per-broker bundles into a ZIP-of-ZIPs |
| `cancel` | Cancel an in-progress collection |

---

## How It Works

1. **`start`** sends a `CreateDebugBundle` request to each broker's Admin API in parallel. Each broker starts collecting its own diagnostics bundle. The job is identified by a UUID (`--job-id`; auto-generated if not provided). The command prints a table of `broker → job-ID` results.

2. **`status`** calls `GetDebugBundleStatus` on each broker and reports `broker / status / job-ID`. Status values seen in practice include `running`, `success`, and `error`.

3. **`download`** filters to brokers with `status == success`, then calls `DownloadDebugBundleFile` for each and streams the data into a combined ZIP. Only brokers with a `success` status are downloaded; brokers still running or in error state are skipped (a warning is printed).

4. **`cancel`** calls `CancelDebugBundleProcess` on each broker (optionally filtered by `--job-id`).

---

## Broker Targeting

All four subcommands use the Admin API addresses from your rpk profile or from the `-X admin.hosts=...` flag:

```bash
# Use all brokers in the active rpk profile
rpk debug remote-bundle start

# Target only specific brokers
rpk debug remote-bundle start -X admin.hosts=broker-0:9644,broker-1:9644

# With a named profile
rpk debug remote-bundle start --profile prod-cluster

# With TLS
rpk debug remote-bundle start \
  -X admin.hosts=broker-0:9644 \
  -X admin.tls.enabled=true \
  -X admin.tls.ca=/path/to/ca.pem
```

The `status`, `download`, and `cancel` subcommands accept the same connection flags as `start`.

---

## `rpk debug remote-bundle start`

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--job-id` | string | (auto UUID) | Custom UUID for the job. Useful for correlating bundles across multiple runs. |
| `--no-confirm` | bool | false | Skip the broker-list confirmation prompt. |
| `--wait` | bool | false | Block until all brokers complete (or `--wait-timeout` expires). Polls every 10 seconds. |
| `--wait-timeout` | duration | `5m0s` | Maximum time to wait locally when `--wait` is set. Collection continues on the cluster even after timeout. |
| `--logs-since` | string | `yesterday` | Include logs from this date onward (journalctl format). |
| `--logs-until` | string | (none) | Include logs up to this date (journalctl format). |
| `--logs-size-limit` | string | `100MiB` | Stop reading logs once this size is reached. |
| `--controller-logs-size-limit` | string | `132MB` | Max size for controller log segments. |
| `--cpu-profiler-wait` | duration | `30s` | CPU profiler sample duration. No client-side validation (unlike local `bundle`); the value is passed through to the broker. |
| `--metrics-samples` | int | `2` | Number of metrics snapshots. No client-side validation (unlike local `bundle`); the value is passed through to the broker. |
| `--metrics-interval` | duration | `10s` | Time between metrics snapshots. |
| `-p, --partition` | stringArray | (none) | Extra Admin API detail for specific partitions (`topic/0,1,2`). |
| `-n, --namespace` | string | (none) | Kubernetes namespace (K8s only). |
| `-l, --label-selector` | stringArray | `app.kubernetes.io/name=redpanda` | K8s label selector (K8s only). |
| `--kafka-connections-limit` | int | `256` | Max Kafka connections in the bundle. |

### Authentication Passed to Brokers

The remote-bundle start command passes SASL and TLS credentials from the active rpk profile down to each broker, so the broker can authenticate to its own Kafka API when collecting Kafka metadata. Specifically:
- SCRAM credentials (`--sasl-mechanism`, `--user`, `--password`) are forwarded.
- OAuth Bearer token (from `sasl.mechanism: OAUTHBEARER` with a token in `sasl.password`) is forwarded.
- TLS configuration (`tls.enabled`, `tls.insecure_skip_verify`) is forwarded.

### Output

```
broker            job-ID
broker-0:9644     550e8400-e29b-41d4-a716-446655440000
broker-1:9644     550e8400-e29b-41d4-a716-446655440000
broker-2:9644     550e8400-e29b-41d4-a716-446655440000

The debug bundle collection process has started with Job-ID 550e8400-e29b-41d4-a716-446655440000. To check the
status, run:
  rpk debug remote-bundle status
```

---

## `rpk debug remote-bundle status`

Polls `GetDebugBundleStatus` on each configured broker.

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--format` | string | `text` | Output format: `text`, `json`, `yaml`, `wide`, `help`. |

### Output

```
broker            status   job-ID
broker-0:9644     success  550e8400-e29b-41d4-a716-446655440000
broker-1:9644     running  550e8400-e29b-41d4-a716-446655440000
broker-2:9644     success  550e8400-e29b-41d4-a716-446655440000

After the process is completed, you may retrieve the debug bundle using:
  rpk debug remote-bundle download
```

Status values:
- `running` — collection still in progress on this broker
- `success` — collection complete; bundle is ready to download
- `error` — collection failed on this broker

### JSON output

```bash
rpk debug remote-bundle status --format json | jq '.[] | select(.status == "error")'
```

When using `--format json` or `--format yaml`, the object keys are `broker`, `status`, `job_id`, and `error` (note: `job_id` is snake_case in the JSON, distinct from the `job-ID` column header in the text table).

---

## `rpk debug remote-bundle download`

Downloads completed per-broker bundles and packages them into a single ZIP-of-ZIPs.

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `-o, --output` | string | `./<timestamp>-remote-bundle.zip` | Output ZIP file path. |
| `--job-id` | string | (none) | Download only the bundle with this job ID. |
| `--no-confirm` | bool | false | Skip the broker-list confirmation prompt. |
| `--upload-url` | string | (none) | Upload the combined bundle to this URL after downloading (HTTP PUT). |

### Output Structure

The resulting ZIP contains one entry per broker:

```
<timestamp>-remote-bundle/
  <broker-address>/<job-id>.zip    # per-broker bundle ZIP
  <broker-address>/<job-id>.zip
  ...
```

Example:
```
1700000000-remote-bundle/
  broker-0-9644/550e8400-e29b-41d4-a716-446655440000.zip
  broker-1-9644/550e8400-e29b-41d4-a716-446655440000.zip
  broker-2-9644/550e8400-e29b-41d4-a716-446655440000.zip
```

Special characters (`<`, `>`, `:`, `"`, `/`, `|`, `?`, `*`) in broker addresses are replaced with `-` in the directory name.

### Extracting Individual Broker Bundles

```bash
# Unzip the outer archive
unzip 1700000000-remote-bundle.zip -d cluster-bundle

# List broker bundles
ls cluster-bundle/1700000000-remote-bundle/

# Extract a specific broker's bundle
cd cluster-bundle/1700000000-remote-bundle/
unzip broker-0-9644/550e8400-e29b-41d4-a716-446655440000.zip -d broker-0-bundle

# Inspect the broker bundle
cat broker-0-bundle/admin/health_overview.json | jq
cat broker-0-bundle/redpanda.log | grep ERROR
```

---

## `rpk debug remote-bundle cancel`

Cancels the in-progress bundle collection. Gets the current status first and shows a confirmation prompt before canceling.

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--job-id` | string | (none) | Cancel only the bundle with this job ID. If not set, cancels all in-progress jobs. |
| `--no-confirm` | bool | false | Skip the confirmation prompt. |

### Output

```
broker            canceled
broker-0:9644     true
broker-1:9644     true
broker-2:9644     true
```

---

## Full Workflow Examples

### Standard workflow

```bash
# 1. Start collection
rpk debug remote-bundle start --no-confirm

# 2. Poll until complete (wait manually)
rpk debug remote-bundle status

# 3. Download when all brokers show 'success'
rpk debug remote-bundle download --output /tmp/cluster-bundle.zip

# 4. Inspect
unzip /tmp/cluster-bundle.zip -d /tmp/cluster-bundle-dir
```

### Automated workflow with --wait

```bash
rpk debug remote-bundle start \
  --wait \
  --wait-timeout 15m \
  --no-confirm \
  --logs-since "2024-11-15" \
  --cpu-profiler-wait 60s

# --wait blocks until complete, then:
rpk debug remote-bundle download \
  --output /tmp/cluster-bundle.zip \
  --no-confirm
```

### Target a specific time window

```bash
rpk debug remote-bundle start \
  --logs-since "2024-11-20" \
  --logs-until "2024-11-21" \
  --logs-size-limit 300MiB \
  --no-confirm
```

### Upload to Redpanda Support

```bash
rpk debug remote-bundle download \
  --output /tmp/support-bundle.zip \
  --upload-url "https://...presigned-s3-url..." \
  --no-confirm
echo "Bundle uploaded"
```

### With custom job ID (for scripting)

```bash
JOB_ID="my-incident-$(date +%Y%m%d)"

rpk debug remote-bundle start \
  --job-id "$JOB_ID" \
  --no-confirm

# Poll
while true; do
  STATUS=$(rpk debug remote-bundle status --format json)
  RUNNING=$(echo "$STATUS" | jq '[.[] | select(.status == "running")] | length')
  if [ "$RUNNING" -eq 0 ]; then break; fi
  echo "Still running on $RUNNING brokers..."
  sleep 15
done

rpk debug remote-bundle download \
  --job-id "$JOB_ID" \
  --output "/tmp/${JOB_ID}.zip" \
  --no-confirm
```

---

## Remote vs Local Bundle: When to Use Each

| | `rpk debug bundle` | `rpk debug remote-bundle` |
|---|---|---|
| Requires shell access to broker host | Yes | No |
| Collects OS-level data (syslog, sysctl, ethtool) | Yes (Linux) | No |
| Cluster-wide (all brokers) | No (one node) | Yes |
| Can run from a laptop or CI | No | Yes |
| Works in restricted environments (K8s RBAC limited) | Sometimes | Yes (needs Admin API access only) |
| Output | Single ZIP | ZIP-of-ZIPs |

---

## Error Handling

- If `start` is called while a bundle is already running on a broker, the error `DebugBundleErrorCodeProcessAlreadyRunning` is returned and the output message guides you to cancel first.
- If some but not all brokers fail, the table shows errors and the process exits with status 1.
- `download` only downloads brokers with `status == success`. Brokers with `status == error` are counted and a warning is printed.
- Any per-step collection failures inside each broker's bundle are written to `errors.txt` inside that broker's ZIP.
