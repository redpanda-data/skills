# gcp_spanner_cdc Config Reference

Every field for the `gcp_spanner_cdc` input, grounded in
`connect/internal/impl/gcp/enterprise/input_spanner_cdc.go` and confirmed
against the generated docs at
`connect/docs/modules/components/pages/inputs/gcp_spanner_cdc.adoc`.

---

## Full Config (all fields, with defaults)

```yaml
input:
  label: ""
  gcp_spanner_cdc:
    credentials_json: ""          # optional
    project_id: ""                # required
    instance_id: ""               # required
    database_id: ""               # required
    stream_id: ""                 # required
    start_timestamp: ""           # optional
    end_timestamp: ""             # optional
    heartbeat_interval: 10s       # advanced, optional
    metadata_table: ""            # advanced, optional
    min_watermark_cache_ttl: 5s   # advanced, optional
    allowed_mod_types: []         # advanced, optional
    batching:
      count: 0
      byte_size: 0
      period: ""
      check: ""
      processors: []              # optional
    auto_replay_nacks: true
```

---

## Field-by-Field Reference

### `credentials_json`

- **Type:** `string`
- **Default:** `""`
- **Required:** No
- **Description:** Base64-encoded GCP service account JSON credentials file. If
  empty, [Application Default Credentials (ADC)](https://cloud.google.com/docs/authentication/application-default-credentials)
  are used instead. This is the standard GCP auth fallback — ADC works when
  running on GCE, GKE, Cloud Run, or when `GOOGLE_APPLICATION_CREDENTIALS` is
  set in the environment.

  To encode a service account key file:

  ```bash
  base64 < my-service-account-key.json
  ```

  In a pipeline YAML, inject via an environment variable:

  ```yaml
  credentials_json: "${SPANNER_CDC_CREDENTIALS}"
  ```

### `project_id`

- **Type:** `string`
- **Default:** none
- **Required:** Yes
- **Description:** GCP project ID that contains the Spanner instance. This is
  the project-level identifier (e.g. `my-gcp-project`), not the numeric project
  number.

### `instance_id`

- **Type:** `string`
- **Default:** none
- **Required:** Yes
- **Description:** Spanner instance ID within the project (e.g.
  `my-spanner-instance`). List instances with:

  ```bash
  gcloud spanner instances list --project=MY_PROJECT
  ```

### `database_id`

- **Type:** `string`
- **Default:** none
- **Required:** Yes
- **Description:** Spanner database ID within the instance (e.g. `my-database`).
  The change stream named by `stream_id` must exist in this database, and the
  connector will also create its metadata table in this same database.

### `stream_id`

- **Type:** `string`
- **Default:** none
- **Required:** Yes
- **Description:** Name of the Spanner change stream to read. The stream must
  already exist in the database before starting the connector. Create it with
  DDL — see [Setup Spanner](setup-spanner.md).

  The connector also uses this value to derive the default metadata table name:
  `cdc_metadata_<stream_id>`.

### `start_timestamp`

- **Type:** `string` (RFC3339Nano format)
- **Default:** `""` (current time)
- **Required:** No
- **Description:** Inclusive timestamp from which to begin reading the change
  stream. If empty, reading starts from the current time — meaning you will only
  receive changes committed after the connector starts.

  To back-fill historical changes, set this to a past timestamp. Spanner change
  streams retain data for a configurable retention window (default 1 day, max 7
  days).

  ```yaml
  start_timestamp: "2025-01-15T00:00:00Z"
  ```

  The value must be parseable as RFC3339 with optional nanosecond precision
  (`time.RFC3339Nano`). An invalid format causes a startup error.

### `end_timestamp`

- **Type:** `string` (RFC3339Nano format)
- **Default:** `""` (no end — streams indefinitely)
- **Required:** No
- **Description:** Exclusive timestamp at which to stop reading. When the
  connector reaches this timestamp, it stops processing and exits. Useful for
  bounded replay jobs.

  ```yaml
  end_timestamp: "2025-01-16T00:00:00Z"
  ```

  Note: the Spanner change stream API treats the end timestamp as exclusive, so
  mutations committed exactly at this timestamp are not included.

### `heartbeat_interval`

- **Type:** `string` (duration, e.g. `10s`, `1m`)
- **Default:** `"10s"`
- **Required:** No (advanced field)
- **Description:** How frequently Spanner emits a heartbeat record when no data
  changes have occurred in a partition. Heartbeat records allow the connector to
  confirm forward progress and update watermarks even during quiet periods.

  Lower values give more frequent watermark updates but increase Spanner read
  cost. The default `10s` is suitable for most workloads.

### `metadata_table`

- **Type:** `string`
- **Default:** `""` (derives to `cdc_metadata_<stream_id>`)
- **Required:** No (advanced field)
- **Description:** Name of the Spanner table used to persist partition metadata
  (states: CREATED, SCHEDULED, RUNNING, FINISHED) and per-partition watermarks.
  The connector creates this table automatically if it does not exist; it
  requires Spanner DDL permissions (`roles/spanner.databaseAdmin` or equivalent)
  on first run.

  The table schema includes columns:
  `PartitionToken`, `ParentTokens`, `StartTimestamp`, `EndTimestamp`,
  `HeartbeatMillis`, `State`, `Watermark`, `CreatedAt`, `ScheduledAt`,
  `RunningAt`, `FinishedAt`.

  On restart the connector reads SCHEDULED and RUNNING partitions from this
  table and resumes them from their watermarks.

  If you specify a custom table name, ensure it is consistent across restarts.
  Changing the table name on an existing deployment forces a cold restart (all
  watermarks are lost).

### `min_watermark_cache_ttl`

- **Type:** `string` (duration, e.g. `5s`, `30s`)
- **Default:** `"5s"`
- **Required:** No (advanced field)
- **Description:** How frequently the connector queries Spanner for the minimum
  unfinished partition watermark (used to detect new partitions). Lower values
  are more reactive to partition splits/merges but increase Spanner read
  operations. The default `5s` is appropriate for most workloads.

### `allowed_mod_types`

- **Type:** `array` of `string`
- **Default:** `[]` (all mod types processed)
- **Required:** No (advanced field)
- **Description:** Filters which Spanner mutation types to emit as messages. If
  the list is empty, all mutations pass through. Allowed values are:

  - `INSERT` — new rows inserted into a tracked table
  - `UPDATE` — existing rows modified
  - `DELETE` — rows removed

  Example — capture inserts and updates only, skip deletes:

  ```yaml
  allowed_mod_types:
    - INSERT
    - UPDATE
  ```

  Filtering happens before messages are placed on the output channel, so
  filtered records do not count toward batching limits.

### `batching`

- **Type:** `object`
- **Description:** Controls how individual Mod messages are grouped into batches
  before being sent downstream. Each Spanner `DataChangeRecord` can contain
  multiple `Mod` objects (one per modified row); each Mod becomes a separate
  message. Batching aggregates these across records and partitions.

  Sub-fields:

  | Field | Type | Default | Description |
  |-------|------|---------|-------------|
  | `count` | int | `0` | Flush when batch reaches this many messages. `0` disables count-based batching. |
  | `byte_size` | int | `0` | Flush when batch reaches this many bytes. `0` disables size-based batching. |
  | `period` | string | `""` | Flush at this interval regardless of size (e.g. `1s`, `500ms`). |
  | `check` | string | `""` | Bloblang query; flush when it returns `true` for a message. |
  | `processors` | array | `[]` | Processors applied to the flushed batch. |

  When no batching policy is set (all values at default), the connector defaults
  to `count: 1` (one message per batch).

  Recommended production settings:

  ```yaml
  batching:
    count: 100
    period: 1s
  ```

### `auto_replay_nacks`

- **Type:** `bool`
- **Default:** `true`
- **Description:** When `true`, messages rejected (nacked) by the output are
  automatically replayed indefinitely. When `false`, nacked messages are
  **deleted** (data loss risk) — but memory efficiency improves because the
  connector can discard the original payload immediately after the message is
  consumed, without holding it in memory pending a retry. Only set to `false`
  if you have an independent mechanism to detect and recover from output
  failures, or if losing nacked messages is acceptable for your workload.

---

## Minimal Required Config

```yaml
input:
  gcp_spanner_cdc:
    project_id: "my-project"
    instance_id: "my-instance"
    database_id: "my-database"
    stream_id: "MyChangeStream"
```

With ADC configured in the environment, no `credentials_json` is needed.

---

## Environment Variable Pattern

All string fields support `${ENV_VAR}` interpolation:

```yaml
input:
  gcp_spanner_cdc:
    credentials_json: "${SPANNER_CDC_CREDENTIALS}"
    project_id: "${SPANNER_PROJECT}"
    instance_id: "${SPANNER_INSTANCE}"
    database_id: "${SPANNER_DATABASE}"
    stream_id: "${SPANNER_STREAM}"
```
