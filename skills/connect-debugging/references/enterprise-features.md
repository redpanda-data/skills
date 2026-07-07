# Redpanda Connect Enterprise Features

Redpanda Connect ships a single binary covering Community (BSL) and Enterprise
(RCL) editions. Enterprise features require a valid Redpanda Enterprise license.
After the 30-day trial expires, you are blocked from using enterprise connectors
unless you upgrade. This file documents the Connect enterprise differentiators
relevant to debugging, with their nested config keys grounded in the Connect
source and component docs.

The canonical Connect enterprise feature set (per the licensing overview):

| Feature | License | Behavior without valid license |
|---------|---------|--------------------------------|
| Enterprise connectors (incl. all CDC inputs) | Enterprise | All enterprise connectors are blocked at startup/connection time |
| Allow or deny lists | Enterprise | No change (feature itself is free to configure, but gates enterprise components) |
| FIPS compliance | Enterprise | No change |
| Redpanda Connect configuration service (`redpanda:` block) | Enterprise | No change |
| Secrets management (remote lookup at runtime) | Enterprise | No change |

Source: `docs/modules/get-started/pages/licensing/overview.adoc` (Connect table),
plus implementation files licensed under RCL in
`connect/internal/cli/enterprise.go`, `connect/internal/secrets/secrets.go`.

---

## License loading (where the binary looks)

Grounded in `connect/internal/license/service.go` and
`connect/internal/cli/flags_redpanda.go`.

Resolution order when a license is applied:

1. `--redpanda-license <inline-string>` CLI flag (highest priority).
2. `REDPANDA_LICENSE` environment variable (inline license string).
3. `REDPANDA_LICENSE_FILEPATH` environment variable (path to a license file).
4. Default path **`/etc/redpanda/redpanda.license`** (constant
   `defaultLicenseFilepath`).

```go
// flags_redpanda.go defaultLicenseConfig()
License:         os.Getenv("REDPANDA_LICENSE"),
LicenseFilepath: os.Getenv("REDPANDA_LICENSE_FILEPATH"),
```

CLI flags (apply to `rpk connect run`, `rpk connect dry-run`, agent, mcp-server):

```bash
rpk connect run     --redpanda-license "$(cat redpanda.license)" ./pipeline.yaml
rpk connect dry-run --redpanda-license "$(cat redpanda.license)" ./pipeline.yaml
```

Flag usage string (from `flags_redpanda.go`): "Provide an explicit Redpanda
License, which enables enterprise functionality. By default licenses found at
the path `/etc/redpanda/redpanda.license` are applied."

If no valid Enterprise license is found, a 10-year open-source license is applied
automatically. Using an enterprise component under that open-source license fails
at connection time — surface this fast with `rpk connect dry-run`.

---

## Enterprise connectors: CDC inputs

All change-data-capture inputs are **Enterprise** components. They share a common
shape: a connection field, `tables`/`collections`, a snapshot toggle, and a
checkpoint mechanism. Below are the exact nested config keys per connector
(grounded in `connect/docs/modules/components/pages/inputs/*.adoc`).

### `postgres_cdc` (logical replication slot)

```yaml
input:
  postgres_cdc:
    dsn: postgres://user:pass@host:5432/db?sslmode=disable  # required
    include_transaction_markers: false
    stream_snapshot: false          # snapshot existing rows before streaming changes
    snapshot_batch_size: 1000
    schema: public                  # required
    tables: []                      # required
    checkpoint_limit: 1024          # max un-acked WAL messages in flight
    temporary_slot: false
    slot_name: my_test_slot         # required; replication slot name
    pg_standby_timeout: 10s
    pg_wal_monitor_interval: 3s
    max_parallel_snapshot_tables: 1
    unchanged_toast_value: null
    heartbeat_interval: 1h          # 0s disables; keeps WAL reclaimable on low-traffic tables
    tls:
      skip_cert_verify: false
      enable_renegotiation: false
      root_cas: ""
      root_cas_file: ""
      client_certs: []
    aws:                            # for RDS IAM auth
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
      processors: []
```

Debugging notes: a stuck/orphaned `slot_name` prevents Postgres from reclaiming
WAL (disk fills). `heartbeat_interval` keeps the committed point moving on
low-frequency tables. `checkpoint_limit` caps un-acknowledged replication
messages — lower it if memory grows.

### `mysql_cdc` (binlog)

```yaml
input:
  mysql_cdc:
    flavor: mysql                   # mysql or mariadb
    dsn: user:password@tcp(localhost:3306)/database  # required
    tables: []                      # required
    checkpoint_cache: ""            # required; a cache resource label for binlog position
    checkpoint_key: mysql_binlog_position
    snapshot_max_batch_size: 1000
    max_reconnect_attempts: 10
    stream_snapshot: false          # required
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
      region: ""
      endpoint: ""
      id: ""
      secret: ""
      token: ""
      role: ""
      role_external_id: ""
      roles: []
    batching:
      count: 0
      byte_size: 0
      period: ""
      check: ""
      processors: []
```

Debugging notes: `checkpoint_cache` MUST reference a configured `cache_resources`
entry — a missing or misnamed cache is a common startup failure. The binlog
position is persisted under `checkpoint_key`; deleting it forces a re-snapshot.

### `mongodb_cdc` (change streams)

```yaml
input:
  mongodb_cdc:
    url: mongodb://localhost:27017  # required
    database: ""                    # required
    username: ""
    password: ""
    collections: []                 # required
    checkpoint_key: mongodb_cdc_checkpoint
    checkpoint_cache: ""            # required; cache resource for resume token
    checkpoint_interval: 5s
    checkpoint_limit: 1000
    read_batch_size: 1000
    read_max_wait: 1s
    stream_snapshot: false
    snapshot_parallelism: 1
    snapshot_auto_bucket_sharding: false
    document_mode: update_lookup    # update_lookup, etc.
    json_marshal_mode: canonical    # canonical or relaxed
    app_name: benthos
    auto_replay_nacks: true
```

Debugging notes: change streams require a replica set or sharded cluster.
Capturing deletes requires pre/post image saving enabled on the collection.

### `oracledb_cdc` (LogMiner)

```yaml
input:
  oracledb_cdc:
    connection_string: oracle://username:password@host:port/service_name  # required
    wallet_path: /opt/oracle/wallet
    wallet_password: ""
    stream_snapshot: false
    max_parallel_snapshot_tables: 1
    snapshot_max_batch_size: 1000
    logminer:                       # the nested LogMiner mining block
      scn_window_size: 20000        # SCN range mined per iteration
      backoff_interval: 5s
      mining_interval: 300ms
      strategy: online_catalog      # mining strategy
      max_transaction_events: 0     # 0 = unbounded
      lob_enabled: true
      transaction_cache: ""         # cache resource for in-flight transactions
      transaction_cache_key: oracledb_cdc
    include: []                     # required; tables to capture
    exclude: []
    checkpoint_cache: ""
    checkpoint_cache_table_name: RPCN.CDC_CHECKPOINT_CACHE
    checkpoint_cache_key: oracledb_cdc
    checkpoint_limit: 1024
    pdb_name: ""                    # pluggable database name (multitenant)
    auto_replay_nacks: true
    batching:
      count: 0
      byte_size: 0
      period: ""
      check: ""
```

Debugging notes: the `logminer{}` sub-block controls mining cadence. If you see
slow capture or memory pressure, tune `scn_window_size` (smaller = lower memory,
more round trips) and cap `max_transaction_events`. `transaction_cache` must
reference a configured cache for long-running transactions.

### Other enterprise CDC / connector inputs

Also present and licensed as enterprise (config skeletons in their respective
`inputs/*.adoc`): `microsoft_sql_server_cdc`, `aws_dynamodb_cdc`,
`gcp_spanner_cdc`, `salesforce_cdc`. (`tigerbeetle_cdc` is NOT enterprise —
`internal/plugins/info.csv` marks it `certified`, its source is
Apache-2.0-headed, and it has no `license.CheckRunningEnterprise` call; it is
CGO-only and absent from `rpk connect` and the standard Docker image. See the
`connect-cdc-tigerbeetle` skill.) Enterprise impl packages
under `connect/internal/impl/` (RCL-licensed) include `snowflake`, `splunk`,
`gcp` (BigQuery), `salesforce`, `mssqlserver`, `oracledb`, `mongodb`,
`postgresql`, `mysql`, `iceberg`, `otlp`, and `gateway`.

To confirm whether a component is enterprise, check the component catalog with
`?support=enterprise`, or run `rpk connect dry-run` — an enterprise component
under an open-source license fails at connection time with a license error.

---

## Connector allow / deny lists (Enterprise gating)

Grounded in `connect/internal/cli/enterprise.go` and `connectors_list.go`.

On startup the binary reads **`/etc/redpanda/connector_list.yaml`** (constant
`connectorListPath`). It restricts which components the Connect instance may run.

```yaml
# /etc/redpanda/connector_list.yaml
# Specify EITHER allow OR deny, never both.
allow:
  - kafka_franz
  - postgres_cdc
# deny:
#   - subprocess
#   - http_client
```

- Only `allow` OR `deny` may be set — setting both is a fatal error:
  "connector list must only contain deny or allow items, not both".
- `allow` produces an allow-list (`env.With(...)`); `deny` removes components
  (`env.Without(...)`).
- On success the log shows: `Successfully applied connectors allow/deny list
  from '/etc/redpanda/connector_list.yaml'`.

Debugging note: if a component "does not exist" at lint/run time on a managed
deployment, an allow/deny list may have removed it from the schema. Check this
file first.

---

## Secrets management (remote lookup at runtime)

Grounded in `connect/internal/secrets/secrets.go` (RCL-licensed) and the
`--secrets` flag in `flags_redpanda.go`.

Instead of putting secrets in the config or environment, resolve `${SECRET}`
interpolations from a remote system at runtime via the `--secrets` flag, which
takes one or more URNs tried in order:

```bash
rpk connect run --secrets aws://my-secrets-region?role=arn:aws:iam::... ./pipeline.yaml
rpk connect run --secrets gcp://my-project?audience=... --secrets env: ./pipeline.yaml
```

Supported URN schemes (from `parseSecretsLookupURN`):

| Scheme | Backend | Notes |
|--------|---------|-------|
| `env:` | Environment variables | Default and only entry unless overridden |
| `none:` | Disable all secret lookups | Single entry of `none:` disables lookups |
| `aws:` | AWS Secrets Manager | `aws://<region>?role=<arn>&trimPrefix=<p>` |
| `gcp:` | GCP Secret Manager | `gcp://<project>?audience=<aud>&trimPrefix=<p>` |
| `az:` | Azure Key Vault | `az://<vault-host>?trimPrefix=<p>` |
| `redis:` | Redis | `redis://<host>` |
| `test:` | Test stub | Returns `key + " " + host` (testing only) |

The `trimPrefix` query parameter strips a prefix from looked-up keys. URNs are
tried in order; the first hit wins. The same `--secrets`/`--secrets-uris`
mechanism is honored by `rpk connect lint` (`--secrets` flag) — see
`lint-and-validate.md`.

Debugging note: a `secrets scheme <x> not recognized` error at startup means an
unsupported URN scheme was passed to `--secrets`.

---

## Configuration service: the `redpanda:` block (Enterprise)

Grounded in `connect/docs/modules/components/pages/redpanda/about.adoc`. This
block ships Connect's own process logs and pipeline status events to topics on a
Redpanda cluster — invaluable for debugging fleets of pipelines centrally.

```yaml
redpanda:
  seed_brokers: []                  # required
  pipeline_id: ""                   # tags logs/status with a pipeline identifier
  logs_topic: __redpanda.connect.logs    # topic for process logs
  logs_level: info                  # debug, info, warn, error
  status_topic: __redpanda.connect.status  # topic for status updates
  # --- connection / producer tuning ---
  client_id: redpanda-connect
  tls:
    enabled: false
    skip_cert_verify: false
    enable_renegotiation: false
    root_cas: ""
    root_cas_file: ""
    client_certs: []
  sasl: []                          # list; mechanism + username/password/token
  metadata_max_age: 1m
  request_timeout_overhead: 10s
  conn_idle_timeout: 20s
  tcp:
    connect_timeout: 0s
    keep_alive: {idle: 15s, interval: 15s, count: 9}
    tcp_user_timeout: 0s
  partitioner: ""                   # murmur2_hash | round_robin | least_backup | manual
  idempotent_write: true
  acks: all                         # all | leader | none (must be all when idempotent_write)
  compression: ""                   # lz4 | snappy | gzip | zstd | none
  allow_auto_topic_creation: true
  timeout: 10s
  max_message_bytes: 1MiB
  broker_write_max_bytes: 100MiB
  max_buffered_records: 10000
  max_buffered_bytes: "0"
  max_in_flight_requests: 1
  record_retries: 0
  record_delivery_timeout: 0s
```

`sasl[]` mechanisms: `SCRAM-SHA-256`, `SCRAM-SHA-512`, `PLAIN`, `OAUTHBEARER`,
`AWS_MSK_IAM`, `REDPANDA_CLOUD_SERVICE_ACCOUNT`, `none`. The
`logs_level` here is reconciled with the top-level `logger.level` at config
parse time (see `enterprise.go` `OnConfigParse`).

Debugging note: set `logs_topic` and `status_topic` plus a unique `pipeline_id`
to centralize debugging across many Connect instances; consume those topics to
see every pipeline's logs and connect/disconnect status in one place.

---

## FIPS compliance (Enterprise)

Run Connect with a FIPS-compliant `rpk` build. This is an Enterprise feature with
no behavioral change on license expiry (the binary keeps running) but it cannot
be newly enabled without a license. See the rpk quickstart FIPS section. Relevant
at the cluster side via the node config `fips_mode` (`enabled`/`disabled`); on
the Connect side it is a distinct FIPS-compliant binary/distribution.

---

## Disabling enterprise features for compliance

If a cluster shows `license violation: true` (`rpk cluster license info`), either
add a valid license or disable the feature. Connect's enterprise gates are
controlled by NOT loading a license (the open-source fallback blocks enterprise
connectors), or by using a `deny` list in `/etc/redpanda/connector_list.yaml` to
remove enterprise components. Cluster-side enterprise features are disabled via
`rpk cluster config set` (see
`docs/modules/get-started/pages/licensing/disable-enterprise-features.adoc`).
