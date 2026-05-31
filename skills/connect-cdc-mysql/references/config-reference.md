# mysql_cdc Config Reference

Every configuration field for the `mysql_cdc` input, grounded in
`connect/internal/impl/mysql/input_mysql_stream.go` and
`connect/docs/modules/components/pages/inputs/mysql_cdc.adoc`.

Component status: **Stable**. Introduced in version **4.45.0**.
This is an **Enterprise** feature — `license.CheckRunningEnterprise` is called at startup.

---

## Full config template (all fields, showing defaults)

```yaml
input:
  label: ""
  mysql_cdc:
    flavor: mysql                          # "mysql" | "mariadb"
    dsn: ""                                # REQUIRED
    tables: []                             # REQUIRED — at least one entry
    checkpoint_cache: ""                   # REQUIRED — must match a cache_resources label
    checkpoint_key: mysql_binlog_position  # default
    snapshot_max_batch_size: 1000
    max_reconnect_attempts: 10
    stream_snapshot: false                 # REQUIRED — set explicitly
    max_parallel_snapshot_tables: 1
    auto_replay_nacks: true
    checkpoint_limit: 1024
    tls:
      skip_cert_verify: false
      enable_renegotiation: false
      root_cas: ""
      root_cas_file: ""
      client_certs: []
    aws:
      enabled: false
      region: ""          # optional
      endpoint: ""        # required when aws.enabled=true
      id: ""              # optional
      secret: ""          # optional
      token: ""           # optional
      role: ""            # optional
      role_external_id: "" # optional
      roles: []           # optional
    batching:
      count: 0
      byte_size: 0
      period: ""
      check: ""
      processors: []
```

---

## Field reference

### `flavor`

**Type:** `string` | **Default:** `"mysql"` | **Required:** No

The database engine flavor. Controls the replication protocol dialect.

| Value | Description |
|---|---|
| `mysql` | MySQL-flavored databases (default) |
| `mariadb` | MariaDB-flavored databases |

Must match the actual server engine. Using the wrong flavor will cause replication errors.

---

### `dsn`

**Type:** `string` | **Default:** none | **Required:** Yes

The MySQL Data Source Name (DSN) in Go MySQL driver format:

```
user:password@tcp(host:port)/dbname
```

Examples:
```yaml
dsn: cdc_user:MyPassword@tcp(localhost:3306)/mydb
dsn: cdc_user:MyPassword@tcp(rds-host.us-east-1.rds.amazonaws.com:3306)/mydb?tls=true
```

The connector forces `ParseTime=true` internally — time values are always parsed to `time.Time`.

TLS can be specified in the DSN (`?tls=true`, `?tls=skip-verify`) **or** via the `tls` field — the `tls` field takes precedence when both are set.

---

### `tables`

**Type:** `array of string` | **Default:** none | **Required:** Yes (at least one entry)

List of table names to capture from the database specified in the DSN. Table names must be in the same database as the DSN `dbname`. Do not include the database prefix.

```yaml
tables:
  - orders
  - customers
  - products
```

Lint rule: the field must contain at least one entry — an empty `tables: []` is a lint error.

Table name validation rules (from `validate.go`):
- Must not be empty
- Maximum 64 UTF-8 characters
- Must start with a letter or underscore (`[a-zA-Z_]`)
- May contain only letters, digits, underscores, and `$` (`[a-zA-Z0-9_$]+`)

---

### `checkpoint_cache`

**Type:** `string` | **Default:** none | **Required:** Yes

The label of a `cache_resources` entry used to persist the current binlog position. The connector reads this cache on startup to determine where to resume streaming. If the key is not found in the cache (first run or cache cleared), behavior depends on `stream_snapshot`:

- `stream_snapshot: true` — performs a full snapshot, then streams from the snapshot's start position.
- `stream_snapshot: false` — starts from the current live binlog position (skips historical data).

The connector **fails at startup** if `checkpoint_cache` references a cache label that does not exist in `cache_resources`.

Recommended backends:
- `file` — durable, single Connect instance
- `redis` — durable, works across restarts and multi-instance deployments

```yaml
cache_resources:
  - label: binlog_cache
    file:
      directory: /var/lib/connect/checkpoints
```

---

### `checkpoint_key`

**Type:** `string` | **Default:** `"mysql_binlog_position"` | **Required:** No

The key under which the binlog position is stored in `checkpoint_cache`. Change this if multiple `mysql_cdc` inputs share the same cache resource — each must use a unique key.

```yaml
checkpoint_key: mydb_orders_binlog_pos
```

---

### `snapshot_max_batch_size`

**Type:** `int` | **Default:** `1000` | **Required:** No

Maximum number of rows fetched per query during the snapshot phase. Snapshot uses keyset pagination — after each batch, the connector queries from the last seen primary key values. Tune this to balance memory usage against snapshot speed.

---

### `max_reconnect_attempts`

**Type:** `int` | **Default:** `10` | **Advanced:** Yes | **Required:** No

Maximum number of reconnect attempts the MySQL canal driver makes when the connection drops before Connect itself attempts a full reconnection. A value of `0` or negative means infinite retries.

**Important for IAM auth:** when `aws.enabled: true`, IAM tokens expire (typically every 15 minutes). Set `max_reconnect_attempts` to a low positive value (e.g. `3`) so the connector reconnects quickly and refreshes the token.

---

### `stream_snapshot`

**Type:** `bool` | **Default:** none | **Required:** Yes (must be set explicitly)

Controls whether the connector reads all existing rows before streaming binlog events:

- `true` — performs a consistent snapshot of all `tables` using `FLUSH TABLES WITH READ LOCK`, then streams from the binlog position recorded at snapshot start. Existing data is emitted as `operation: read` messages.
- `false` — skips the snapshot and starts streaming from the current binlog position. Only new changes (after pipeline start) are captured.

The snapshot only runs once — if a `binlog_position` is found in `checkpoint_cache`, the snapshot is skipped on subsequent starts.

---

### `max_parallel_snapshot_tables`

**Type:** `int` | **Default:** `1` | **Required:** No

Number of tables to snapshot in parallel during the initial snapshot phase. Each parallel worker uses a separate consistent-snapshot database transaction established under the same table-scoped `FLUSH TABLES <tables> WITH READ LOCK` window.

Lint rule: must be at least `1`.

Effective parallelism is `min(max_parallel_snapshot_tables, number_of_tables)` — values above the number of configured tables are clamped and have no additional effect.

Increasing this speeds up snapshots for large multi-table captures at the cost of additional database connections and memory.

---

### `auto_replay_nacks`

**Type:** `bool` | **Default:** `true` | **Required:** No

When `true`, messages rejected (nacked) at the output are automatically retried indefinitely. This can cause backpressure if failures are persistent. Set to `false` to discard nacked messages instead — useful for high-throughput pipelines where dropping is preferable to stalling.

---

### `checkpoint_limit`

**Type:** `int` | **Default:** `1024` | **Required:** No

Maximum number of messages in flight simultaneously. The binlog position only advances in the checkpoint cache once all messages up to that offset have been acknowledged (in order), preserving at-least-once delivery guarantees.

Increasing this enables more parallelism at the output (e.g. when batching to Kafka), but uses more memory. Lower it if memory pressure is a concern.

---

### `tls`

**Type:** `object` | **Optional**

Overrides any TLS settings embedded in the DSN. When this field is set, the connector registers a custom TLS config with the MySQL driver and automatically extracts the `ServerName` from the DSN host.

| Sub-field | Type | Default | Description |
|---|---|---|---|
| `skip_cert_verify` | bool | `false` | Skip server certificate verification (insecure) |
| `enable_renegotiation` | bool | `false` | Allow TLS renegotiation (needs Connect 3.45.0+) |
| `root_cas` | string | `""` | Inline PEM certificate chain for the CA |
| `root_cas_file` | string | `""` | Path to PEM CA file |
| `client_certs` | array | `[]` | Client certificate/key pairs for mTLS |

---

### `aws`

**Type:** `object` | **Advanced** | **Optional**

AWS IAM authentication for RDS / Aurora MySQL. When enabled, the connector generates a short-lived IAM authentication token and uses it as the database password instead of a static password in the DSN.

| Sub-field | Type | Default | Required | Description |
|---|---|---|---|---|
| `enabled` | bool | `false` | No | Enable IAM auth |
| `region` | string | env default | No | AWS region of the RDS instance |
| `endpoint` | string | — | Yes (when enabled) | RDS hostname (e.g. `mydb.abc123.us-east-1.rds.amazonaws.com`) |
| `id` | string | — | No | AWS access key ID |
| `secret` | string | — | No | AWS secret access key |
| `token` | string | — | No | AWS session token (short-term credentials) |
| `role` | string | — | No | IAM role ARN to assume |
| `role_external_id` | string | — | No | External ID for role assumption |
| `roles` | array | — | No | Role chain for cross-account access (`role` + optional `role_external_id` per entry) |

When `aws.enabled: true`, set `max_reconnect_attempts` to a small value (e.g. `3`) so the connector refreshes the token when the connection drops.

The connector refreshes the IAM token before switching from snapshot to streaming mode to avoid an expired token mid-stream.

---

### `batching`

**Type:** `object` | **Optional**

Standard Redpanda Connect batching policy applied to outgoing messages. If not set (or all sub-fields are zero/empty), batching effectively defaults to one message per batch (the Connect framework's `NewBatchPolicyField` behavior when no explicit policy is configured).

| Sub-field | Type | Default | Description |
|---|---|---|---|
| `count` | int | `0` | Flush when this many messages are buffered |
| `byte_size` | int | `0` | Flush when accumulated bytes reach this value |
| `period` | string | `""` | Flush after this duration (e.g. `"1s"`, `"500ms"`) |
| `check` | string | `""` | Bloblang expression — flush when it returns true |
| `processors` | array | `[]` | Processors applied to the batch on flush |

Example — flush every 100 messages or every 1 second:
```yaml
batching:
  count: 100
  period: 1s
```

---

## Type mapping

The connector maps MySQL column types to Go native types. Both the snapshot and CDC code paths produce the same Go types for the same MySQL column. When a consumer calls `AsBytes()`, the value is lazily marshaled to JSON.

| MySQL type | Schema type | Go type |
|---|---|---|
| TINYINT | Int32 | int32 |
| SMALLINT | Int32 | int32 |
| MEDIUMINT | Int32 | int32 |
| INT | Int32 | int32 |
| UNSIGNED TINYINT | Int32 | int32 |
| UNSIGNED SMALLINT | Int32 | int32 |
| UNSIGNED MEDIUMINT | Int32 | int32 |
| UNSIGNED INT | Int64 | int64 |
| BIGINT | Int64 | int64 |
| UNSIGNED BIGINT | Int64 | int64 |
| YEAR | Int32 | int32 |
| FLOAT | Float32 | float32 |
| DOUBLE | Float64 | float64 |
| DECIMAL / NUMERIC | String | string |
| DATE | Timestamp | time.Time |
| DATETIME | Timestamp | time.Time |
| TIMESTAMP | Timestamp | time.Time |
| TIME | String | string |
| BIT | Int64 | int64 |
| CHAR / VARCHAR / TEXT | String | string |
| BINARY / VARBINARY / BLOB | ByteArray | []byte |
| ENUM | String | string |
| SET | Array[String] | []any (string elements) |
| JSON | Any | map[string]any / []any / native |

Notes:
- **DECIMAL** is returned as a string to preserve arbitrary precision (float64 would lose digits).
- **JSON** columns: both snapshot and CDC paths run `json.Unmarshal`, producing stdlib Go types.
- **Zero datetimes** (`0000-00-00 00:00:00`): the CDC path converts these to `nil`.
- **UNSIGNED BIGINT > MaxInt64**: values exceeding `math.MaxInt64` are passed through as `uint64` (rare edge case).
- **SET** columns: the CDC path decodes the integer bitset into a slice of the member strings; the snapshot path splits the comma-separated string.

Source: `connect/internal/impl/mysql/TYPES.md`, `schema.go`, `input_mysql_stream.go`.
