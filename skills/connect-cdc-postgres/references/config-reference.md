# postgres_cdc Config Reference

Every field in the `postgres_cdc` input, grounded in `internal/impl/postgresql/input_pg_stream.go` and the generated documentation at `docs/modules/components/pages/inputs/postgres_cdc.adoc`. Introduced in version 4.39.0. The legacy input name `pg_stream` is deprecated.

## Required Fields

### `dsn`

**Type**: `string` | **Required**: yes

PostgreSQL Data Source Name (connection string). Format:

```
postgres://[user[:password]@][host][:port][/dbname][?param=value&...]
```

PostgreSQL enforces SSL/TLS by default. Add `?sslmode=disable` to disable it, or configure the `tls` block to use custom certificates.

```yaml
dsn: postgres://cdc_user:secret@localhost:5432/mydb?sslmode=disable
# RDS example (IAM auth — password supplied by aws block):
dsn: postgres://cdc_user@mydb.abc123.us-east-1.rds.amazonaws.com:5432/mydb
```

### `schema`

**Type**: `string` | **Required**: yes

The PostgreSQL schema to replicate from. Use `public` for the default schema. Case-sensitive schema names that require quoting must be wrapped in double-quoted strings:

```yaml
schema: public
schema: '"MyCaseSensitiveSchema"'
```

### `tables`

**Type**: `array` (list of strings) | **Required**: yes

Table names to include in logical replication. Each entry is a separate list item. Case-sensitive table names that need quoting must be wrapped in double-quoted strings:

```yaml
tables:
  - orders
  - customers
  - '"MyMixedCaseTable"'
```

### `slot_name`

**Type**: `string` | **Required**: yes (validated at startup — empty string causes an error)

The name of the PostgreSQL logical replication slot. The name must contain only alphanumeric characters and underscores (`[A-Za-z0-9_]+`); other characters are rejected to prevent SQL injection.

The connector auto-creates the slot if it does not exist. On restart it resumes from the slot's `confirmed_flush_lsn`.

The connector also creates (and manages) a PostgreSQL publication named `pglog_stream_<slot_name>`. Pre-create this publication to avoid needing `CREATE PUBLICATION` privilege for the replication user.

```yaml
slot_name: my_cdc_slot
# -> publication name: pglog_stream_my_cdc_slot
```

## Snapshot Fields

### `stream_snapshot`

**Type**: `bool` | **Default**: `false`

When `true`, the connector first reads all existing rows from each table (snapshot phase, `operation: read`) before switching to live WAL replication. Tables being snapshot must have a primary key — the connector uses the primary key to paginate and parallelize the scan.

```yaml
stream_snapshot: true
```

### `snapshot_batch_size`

**Type**: `int` | **Default**: `1000`

Number of rows fetched per query during the snapshot phase. Increase for higher throughput at the cost of more memory per batch.

```yaml
snapshot_batch_size: 10000
```

### `max_parallel_snapshot_tables`

**Type**: `int` | **Default**: `1`

Number of tables to snapshot simultaneously. Set to a value greater than 1 when snapshotting many large tables and the database can handle the connection load.

```yaml
max_parallel_snapshot_tables: 4
```

### `snapshot_memory_safety_factor`

**Type**: `float` | **Default**: `1` | **Deprecated**

Fraction of available memory usable during snapshot streaming. Values between 0 and 1. This field is deprecated; use `snapshot_batch_size` instead.

## Replication Slot Fields

### `temporary_slot`

**Type**: `bool` | **Default**: `false`

When `true`, creates a temporary replication slot that is automatically dropped when the connection closes. Useful for testing or one-shot pipelines. Not recommended for production (a temporary slot cannot survive restarts).

```yaml
temporary_slot: false
```

## Streaming / Behavior Fields

### `include_transaction_markers`

**Type**: `bool` | **Default**: `false`

When `true`, the connector emits empty messages with `operation: begin` and `operation: commit` at the boundary of each PostgreSQL transaction. These messages have `null` payloads. Useful for exactly-once or transactional fan-out patterns.

```yaml
include_transaction_markers: false
```

### `checkpoint_limit`

**Type**: `int` | **Default**: `1024`

Maximum number of messages in-flight before back-pressure is applied. Increasing this value allows higher throughput via batching at the output but increases memory usage. The connector will not acknowledge an LSN to PostgreSQL until all messages up to that LSN have been confirmed delivered (at-least-once guarantee).

```yaml
checkpoint_limit: 2048
```

### `heartbeat_interval`

**Type**: `duration` | **Default**: `"1h"` | **Advanced**

How frequently the connector writes a logical message to the WAL using `pg_logical_emit_message`. This keeps the replication slot's acknowledged LSN advancing even when the subscribed tables are quiet, preventing WAL accumulation on the PostgreSQL server.

Set to `"0s"` to disable heartbeats entirely (not recommended for production — if your tables are ever quiet the WAL will not be reclaimed).

The heartbeat message prefix is `redpanda_connect_<slot_name>` and the payload is `{"type":"heartbeat"}`.

```yaml
heartbeat_interval: 1h    # default — once per hour
heartbeat_interval: 5m    # more frequent for very quiet tables
heartbeat_interval: 0s    # disable
```

### `pg_standby_timeout`

**Type**: `duration` | **Default**: `"10s"`

Standby timeout before refreshing an idle connection to PostgreSQL. After this period of no WAL activity the connector sends a keepalive (standby status update) to the server.

```yaml
pg_standby_timeout: 30s
```

### `pg_wal_monitor_interval`

**Type**: `duration` | **Default**: `"3s"`

How often to report changes to the replication lag metric (`postgres_replication_lag_bytes`) and snapshot progress (`postgres_snapshot_progress`).

```yaml
pg_wal_monitor_interval: 6s
```

### `unchanged_toast_value`

**Type**: `unknown` (any) | **Default**: `null` | **Advanced** | **Optional**

The value to emit in place of an unchanged TOAST column. This occurs on `UPDATE` and `DELETE` when `REPLICA IDENTITY` is not `FULL` — PostgreSQL does not include the full column value in the WAL, so the connector cannot distinguish between "column is null" and "column unchanged". Setting this to a sentinel string (e.g. `__redpanda_connect_unchanged_toast_value__`) lets downstream consumers detect which columns were unchanged.

```yaml
unchanged_toast_value: "__redpanda_connect_unchanged_toast_value__"
```

## TLS Fields

### `tls`

**Type**: `object` | **Optional**

Overrides SSL/TLS settings from the DSN and environment. When a `tls` block is present, the TLS configuration from this block is used and the server name is set to the DSN host.

```yaml
tls:
  skip_cert_verify: false        # skip server certificate validation (dev only)
  enable_renegotiation: false    # allow TLS renegotiation
  root_cas_file: ./ca.pem        # path to CA certificate
  client_certs:
    - cert_file: ./client.pem
      key_file: ./client.key
      password: ""               # if key is encrypted
```

| Sub-field | Type | Default | Description |
|---|---|---|---|
| `tls.skip_cert_verify` | bool | `false` | Skip server certificate validation |
| `tls.enable_renegotiation` | bool | `false` | Allow remote TLS renegotiation |
| `tls.root_cas` | string | `""` | Inline PEM CA chain |
| `tls.root_cas_file` | string | `""` | Path to PEM CA file |
| `tls.client_certs` | array | `[]` | Client certificates (cert+key or cert_file+key_file) |

## AWS IAM Authentication Fields

### `aws`

**Type**: `object` | **Advanced** | **Optional**

AWS IAM authentication for RDS or Aurora PostgreSQL. When enabled, the connector generates a temporary IAM authentication token (instead of a static password) at connection time. The `dsn` should not include a password — the token is injected automatically.

**Requires** the `components/aws` package to be imported in the binary. Use the full Redpanda Connect Enterprise binary; the community binary does not import AWS components.

```yaml
aws:
  enabled: true
  region: us-east-1                                         # optional (uses env default if not set)
  endpoint: mydb.abc123.us-east-1.rds.amazonaws.com        # required when aws.enabled=true
  # Static credentials (optional — uses environment/instance role by default):
  id: AKIAIOSFODNN7EXAMPLE                                  # optional
  secret: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY        # optional
  token: ""                                                 # required for short-lived credentials
  # Role assumption (use one of role or roles, not both):
  role: arn:aws:iam::123456789012:role/rds-cdc-role         # optional
  role_external_id: ""                                       # optional
  roles:                                                     # optional (chained role assumption)
    - role: arn:aws:iam::111111111111:role/intermediate-role
      role_external_id: ""
    - role: arn:aws:iam::222222222222:role/final-role
      role_external_id: ext-id-123
```

| Sub-field | Type | Default | Required | Description |
|---|---|---|---|---|
| `aws.enabled` | bool | `false` | no | Enable IAM auth |
| `aws.region` | string | — | no | AWS region (uses env if omitted) |
| `aws.endpoint` | string | — | yes (when enabled) | RDS/Aurora hostname |
| `aws.id` | string | — | no | AWS access key ID |
| `aws.secret` | string | — | no | AWS secret access key |
| `aws.token` | string | — | no | Session token (short-lived creds) |
| `aws.role` | string | — | no | IAM role ARN to assume |
| `aws.role_external_id` | string | — | no | External ID for role assumption |
| `aws.roles` | array | — | no | Chained role list (role + role_external_id each) |

## Batching Fields

### `batching`

**Type**: `object` | **Optional**

Output-side batch policy. By default, `batching.count` is set to `1` (each message is individually flushed). Increase `count` or set `period` for higher throughput.

```yaml
batching:
  count: 100        # flush after 100 messages
  period: 1s        # or after 1 second, whichever comes first
  byte_size: 0      # or after N bytes (0 = disabled)
  check: ""         # or when this Bloblang expression returns true
```

## Auto-Replay

### `auto_replay_nacks`

**Type**: `bool` | **Default**: `true`

When `true`, messages rejected (nacked) at the output are automatically replayed indefinitely. When `false`, rejected messages are dropped. Disabling can reduce memory usage in high-throughput pipelines, at the cost of losing rejected messages.

## Complete Config Example (All Fields)

```yaml
input:
  label: "pg_cdc_full"
  postgres_cdc:
    dsn: postgres://cdc_user:secret@localhost:5432/mydb?sslmode=disable
    schema: public
    tables:
      - orders
      - customers
    slot_name: my_cdc_slot
    include_transaction_markers: false
    stream_snapshot: true
    snapshot_batch_size: 5000
    max_parallel_snapshot_tables: 2
    checkpoint_limit: 2048
    temporary_slot: false
    pg_standby_timeout: 10s
    pg_wal_monitor_interval: 3s
    unchanged_toast_value: null
    heartbeat_interval: 1h
    tls:
      skip_cert_verify: false
      enable_renegotiation: false
      root_cas: ""
      root_cas_file: ""
      client_certs: []
    aws:
      enabled: false
      region: ""
      endpoint: ""
      id: ""
      secret: ""
      token: ""
      role: ""
      role_external_id: ""
      roles: []
    auto_replay_nacks: true
    batching:
      count: 0
      byte_size: 0
      period: ""
      check: ""
```
