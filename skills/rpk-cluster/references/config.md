# rpk cluster config

`rpk cluster config` manages cluster-wide configuration properties — settings
that apply to every node in the cluster simultaneously. This is distinct from
node configuration (`rpk redpanda config`), which sets per-node parameters in
`redpanda.yaml`.

When you change a cluster property, it propagates immediately to all nodes.
Some properties take effect without a restart; others require a rolling restart
(indicated by `rpk cluster config status`).

## Subcommands

| Subcommand | What it does |
|---|---|
| `get <KEY>` | Print a single property value (bare output for scripting) |
| `set <KEY> <VALUE>` or `set <KEY>=<VALUE>` | Set one or more properties |
| `edit` | Open $EDITOR with the full config (YAML) |
| `list` | List all available properties (supports --filter regex) |
| `export -f FILE` | Write current config to a YAML file |
| `import -f FILE` | Apply a config YAML file (absent keys reset to default) |
| `lint -f FILE` | Validate a config file without applying it |
| `status` | Show per-node config version and restart requirements |
| `force-reset [PROPERTY...]` | Forcibly clear a property from the local node's config_cache.yaml (emergency use only — see below) |

## get

```bash
rpk cluster config get log_retention_ms
# Output (bare, suitable for scripts):
604800000
```

On Redpanda Cloud (non-serverless dedicated clusters), `get` queries the Cloud
Control Plane API instead of the Admin API. Serverless clusters do not support
this command.

## set

```bash
# Single property, two-arg form:
rpk cluster config set log_retention_ms 604800000

# Single property, key=value form:
rpk cluster config set log_retention_ms=604800000

# Multiple properties (key=value notation required for multiple):
rpk cluster config set iceberg_enabled=true iceberg_catalog_type=rest

# Setting a property to empty string resets it to its default:
rpk cluster config set log_retention_ms ""

# Negative values need -- to avoid POSIX flag parsing:
rpk cluster config set -- log_retention_ms -1
```

If `cloud_storage_enable_remote_write=false` is set, rpk warns that disabling
Tiered Storage may cause data loss and prompts for confirmation. Use
`--no-confirm` to skip the prompt.

On Cloud, `set` updates the cluster via the Control Plane API and returns an
operation ID. The command polls the operation (default timeout 10 s) and
reports completion. Use `--timeout` to adjust poll time (e.g. `--timeout 120s`).
Check async progress with `rpk cluster config status`.

## edit

Opens the current cluster configuration as YAML in `$EDITOR`. On save, the
diff is applied.

```bash
rpk cluster config edit
rpk cluster config edit --all   # include low-level tunables (use with care)
```

Not supported on Redpanda Cloud clusters.

## list

```bash
rpk cluster config list                        # all properties
rpk cluster config list --filter="kafka.*"     # properties matching a regex
rpk cluster config list --filter="(?i)batch.*" # case-insensitive
rpk cluster config list --format json          # machine-readable output
```

`--filter` takes a Go regular expression matched against property names.

## export and import

```bash
# Export current config to a file
rpk cluster config export -f /tmp/cluster-config.yml

# Edit the file, then import
rpk cluster config import -f /tmp/cluster-config.yml

# Export including low-level tunables
rpk cluster config export -f /tmp/cluster-config.yml --all
```

**Import behavior:** Properties present in the file are set to the file value.
Properties present in the config schema but absent from the file are reset to
their defaults — within the visibility scope of the export. Hidden/low-level
tunables are only affected if both `export` and `import` are run with `--all`.
A partial hand-crafted file will only touch properties in that export's
visibility scope; it will not reset hidden tunables. The safest pattern is to
start from a complete `export` (or `export --all`), edit what you need, and
`import` (or `import --all`) the result.

Note: `cluster_id` and other cluster-specific identifiers are not imported
(they are silently skipped).

## lint

Validates a YAML config file without applying it. Useful in CI.

```bash
rpk cluster config lint -f /tmp/cluster-config.yml
```

## status

```bash
rpk cluster config status
```

Outputs per-node: NODE, CONFIG-VERSION, NEEDS-RESTART, INVALID, UNKNOWN.

- **CONFIG-VERSION**: The cluster configuration version each node has applied.
  All nodes should show the same number; a lower version means a node is out
  of sync (possibly offline).
- **NEEDS-RESTART**: true if a property requiring a restart was changed.
- **INVALID**: Properties the node rejected (e.g. unrecognized on that version).
- **UNKNOWN**: Properties the node does not know about.

On Redpanda Cloud (dedicated clusters), `status` instead lists recent cluster
update operations (OPERATION-ID, STATUS, STARTED, COMPLETED).

## force-reset

Forcibly clears one or more properties from the local node's
`<data-dir>/config_cache.yaml` so that Redpanda treats them as defaults on
the next startup. This command does NOT go through the Admin API — it edits
the on-disk cache directly on the single node where rpk runs.

**When to use:** Only when Redpanda will not start due to a bad configuration
value and you cannot fix it via the normal Admin API path. **Redpanda must be
stopped** before running this command.

**For a normal reset-to-default** (while Redpanda is running), use:
```bash
rpk cluster config set log_retention_ms ""   # empty string resets to default
# or open $EDITOR and remove the line:
rpk cluster config edit
```

```bash
# Force-reset one property (redpanda must be stopped)
rpk cluster config force-reset log_retention_ms

# Force-reset multiple properties at once
rpk cluster config force-reset log_retention_ms log_segment_size
```

## Cluster Config vs Node Config

| Aspect | Cluster config (`rpk cluster config`) | Node config (`rpk redpanda config`) |
|---|---|---|
| Scope | All nodes simultaneously | Single node |
| Storage | Replicated in Raft (controller log) | `redpanda.yaml` on disk |
| Propagation | Immediate (no SIGHUP or restart needed for most) | Requires restart |
| API | Admin API `/v1/cluster_config` | Admin API or direct file edit |

## Common Cluster Config Properties

These are frequently used properties. Always verify current values with
`rpk cluster config get` before changing them.

### Retention and storage

| Property | Type | Description |
|---|---|---|
| `log_retention_ms` | integer (-1 = unlimited) | Message retention by age (ms) |
| `log_retention_bytes` | integer (-1 = unlimited) | Message retention by size per partition |
| `log_segment_size` | integer | Segment file size (bytes) |
| `log_cleanup_policy` | string | `delete`, `compact`, or `compact,delete` |
| `log_compaction_interval_ms` | integer | How often the compaction runs |

### Replication and availability

| Property | Type | Description |
|---|---|---|
| `default_topic_replications` | integer | Default replication factor for new topics |
| `default_topic_partitions` | integer | Default partition count for new topics |
| `min_version` | integer | Minimum supported Kafka protocol version |

### Partition balancing

| Property | Type | Description |
|---|---|---|
| `partition_autobalancing_mode` | string | `off`, `node_add`, or `continuous` |
| `partition_autobalancing_max_disk_usage_percent` | integer | Disk usage % threshold for balancing |
| `partition_autobalancing_node_availability_timeout_sec` | integer | Seconds before an unavailable node triggers rebalancing |

### Tiered Storage / Cloud Storage

| Property | Type | Description |
|---|---|---|
| `cloud_storage_enabled` | boolean | Enable S3/Azure/GCS tiered storage |
| `cloud_storage_enable_remote_write` | boolean | Enable writing segments to object storage |
| `cloud_storage_bucket` | string | Bucket/container name |
| `cloud_storage_region` | string | Cloud region |

### Authentication

| Property | Type | Description |
|---|---|---|
| `kafka_enable_authorization` | boolean | Enable Kafka ACL-based authorization |
| `superusers` | list of strings | Users with superuser privileges |
| `sasl_mechanisms` | list | Enabled SASL mechanisms (e.g. `SCRAM`, `GSSAPI`) |

### Auditing

| Property | Type | Description |
|---|---|---|
| `audit_enabled` | boolean | Enable audit logging |
| `audit_log_replication_factor` | integer | Replication factor for the audit log topic |

### Iceberg integration

| Property | Type | Description |
|---|---|---|
| `iceberg_enabled` | boolean | Enable Iceberg table support (Enterprise; requires restart) |
| `iceberg_catalog_type` | string | Catalog type. Enum: `object_storage` (default), `rest` |
| `iceberg_target_lag_ms` | duration | Target freshness lag (default `1 minute`) |
| `iceberg_default_partition_spec` | string | Default partition spec (default `(hour(redpanda.timestamp))`) |
| `iceberg_invalid_record_action` | string | Action on untranslatable records (default `dlq_table`) |

### Enterprise feature gates

These cluster properties require an **Enterprise license** to set to their
enterprise value. See [enterprise-features.md](enterprise-features.md) for the
full list and nested sub-properties.

| Property | Enterprise value | License-free fallback |
|---|---|---|
| `partition_autobalancing_mode` | `continuous` | `node_add` |
| `core_balancing_continuous` | `true` | `false` |
| `cloud_storage_enabled` | `true` | `false` |
| `features_auto_finalization` | `false` (disabling requires a license) | `true` |
| `iceberg_enabled` | `true` | `false` |
| `enable_shadow_linking` | `true` | `false` |
| `enable_schema_id_validation` | `compat`/`redpanda` | `none` |
| `schema_registry_enable_authorization` | `true` | `false` |
| `audit_enabled` | `true` | `false` |
| `default_leaders_preference` | non-`none` | `none` |
| `delete_topic_enable` | `false` | `true` |
| `sasl_mechanisms` | `GSSAPI`/`OAUTHBEARER` | `SCRAM`/`PLAIN` |
| `http_authentication` | `OIDC` | `BASIC` |

## Tips

- Use `rpk cluster config list --filter` to discover properties before setting
  them.
- After `set`, always check `rpk cluster config status` to confirm propagation
  and identify whether a restart is required.
- For bulk changes, `export` → edit → `import` is safer than multiple `set`
  calls because `lint` can validate the file first.
- The `--all` flag on `export` and `edit` includes low-level internal tunables.
  (`list` does not have an `--all` flag — use `--filter` to narrow results.)
  Low-level tunables are generally safe to leave at defaults.
