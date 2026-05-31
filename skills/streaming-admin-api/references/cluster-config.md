# Cluster Configuration via the Admin API

The Redpanda Admin API exposes cluster configuration at `/v1/cluster_config`. This covers cluster-wide settings that apply to all brokers and take effect without file edits.

---

## Cluster Config vs Node Config

| Aspect | Cluster Config | Node Config |
|--------|---------------|-------------|
| Scope | Applies to every broker in the cluster | Per-broker (in `redpanda.yaml`) |
| Managed via | Admin API `/v1/cluster_config` | `redpanda.yaml` file on each node |
| Propagation | Automatically replicated to all brokers via the controller log | Must be edited on each node individually |
| Examples | `log_retention_ms`, `kafka_connections_max`, `group_max_session_timeout_ms` | `node_id`, `data_directory`, `seeds`, listener addresses |

> **Rule of thumb**: Tunable cluster-wide parameters (retention, compression, connections, timeouts, SASL settings) are cluster config. Physical identity (node ID, data dir, IP addresses, listeners) is node config.

---

## Reading Configuration

### Get the Config Schema

The schema describes every cluster config property — its type, description, default, constraints, and metadata:

```bash
curl http://localhost:9644/v1/cluster_config/schema
```

Each property in the schema object has:

| Metadata Field | Description |
|---------------|-------------|
| `description` | Human-readable explanation |
| `type` | Value type: `string`, `integer`, `number`, `boolean`, `array` |
| `nullable` | Whether `null` is an allowed value |
| `needs_restart` | `true` if changing this property requires a broker restart |
| `visibility` | `user` (normal), `tunable` (advanced), or `deprecated` |
| `is_secret` | `true` if the value should not be logged |
| `units` | Optional: `ms`, `bytes`, etc. |
| `example` | Example value string |
| `enum_values` | For enum properties: list of valid values |
| `aliases` | Legacy names that can be used in PUT requests |

Example: inspect the schema for `log_retention_ms`:

```bash
curl -s http://localhost:9644/v1/cluster_config/schema | \
  python3 -c "import json,sys; s=json.load(sys.stdin); print(json.dumps(s.get('log_retention_ms'), indent=2))"
```

### Read All Non-Default Values

```bash
curl http://localhost:9644/v1/cluster_config
```

### Read All Values Including Defaults

```bash
curl "http://localhost:9644/v1/cluster_config?include_defaults=true"
```

### Read a Single Property

```bash
curl "http://localhost:9644/v1/cluster_config?key=log_retention_ms"
```

Also works with property aliases:
```bash
# delete_retention_ms is the alias for log_retention_ms
curl "http://localhost:9644/v1/cluster_config?key=delete_retention_ms"
```

### Suppress Pending (Show Active Runtime Values)

By default, properties with pending values (awaiting restart) report the pending value. To see the currently active runtime values:

```bash
curl "http://localhost:9644/v1/cluster_config?suppress_pending=true"
```

---

## Altering Configuration

### Basic Upsert

```bash
curl -u admin:secret -X PUT http://localhost:9644/v1/cluster_config \
  -H "Content-Type: application/json" \
  -d '{
    "upsert": {
      "log_retention_ms": 604800000,
      "log_compression_type": "snappy",
      "kafka_connections_max": 10000
    },
    "remove": []
  }'
```

The `upsert` object maps property names to values. All properties in `upsert` are applied atomically.

> **Note on value types**: The Swagger schema for `upsert` declares values as strings (`additionalProperties: {type: string}`), but Redpanda coerces JSON scalars — numbers, booleans, and strings all work. The examples in this document use JSON scalars (e.g., `86400000`, `true`) which is the conventional practice.

### Reset a Property to Default

Add the property name to the `remove` array:

```bash
curl -u admin:secret -X PUT http://localhost:9644/v1/cluster_config \
  -H "Content-Type: application/json" \
  -d '{"upsert": {}, "remove": ["log_compression_type"]}'
```

### Combined Upsert and Remove

```bash
curl -u admin:secret -X PUT http://localhost:9644/v1/cluster_config \
  -H "Content-Type: application/json" \
  -d '{
    "upsert": {"log_retention_ms": 86400000},
    "remove": ["log_compression_type", "kafka_connections_max"]
  }'
```

### Dry Run (Validate Without Applying)

Add `?dry_run=1` to validate the request without making changes:

```bash
curl -u admin:secret -X PUT "http://localhost:9644/v1/cluster_config?dry_run=1" \
  -H "Content-Type: application/json" \
  -d '{"upsert": {"log_retention_ms": -99}, "remove": []}'
```

Returns HTTP 400 with a map of property name → error string if validation fails.

### Force (Skip Validation)

Use `?force=1` to skip validation and allow unknown properties (advanced/emergency use):

```bash
curl -u admin:secret -X PUT "http://localhost:9644/v1/cluster_config?force=1" \
  -H "Content-Type: application/json" \
  -d '{"upsert": {"some_experimental_property": "value"}, "remove": []}'
```

### Success Response

A successful PUT returns the new config version:

```json
{"config_version": 42}
```

The `config_version` is a monotonically increasing integer. You can cross-reference it with the per-node status endpoint to confirm propagation.

---

## Per-Node Configuration Status

After altering cluster config, check whether all nodes have applied the change and whether any require a restart:

```bash
curl http://localhost:9644/v1/cluster_config/status

# Include pending config lists (properties awaiting restart) for each node
curl "http://localhost:9644/v1/cluster_config/status?show_pending=true"
```

Response is an array of per-node status objects:

| Field | Description |
|-------|-------------|
| `node_id` | Broker ID |
| `restart` | `true` if a restart is needed to apply a pending change |
| `config_version` | The config version this node is currently running |
| `invalid` | Properties this node considers invalid |
| `unknown` | Properties unknown to this node (can indicate version skew) |
| `pending` | Properties with pending values awaiting restart (only populated for the node serving the request) |

Example response:
```json
[
  {"node_id": 1, "restart": false, "config_version": 42, "invalid": [], "unknown": [], "pending": []},
  {"node_id": 2, "restart": true,  "config_version": 41, "invalid": [], "unknown": [], "pending": ["kafka_connections_max"]},
  {"node_id": 3, "restart": false, "config_version": 42, "invalid": [], "unknown": [], "pending": []}
]
```

To wait for full propagation (all nodes on the same config version):

```bash
TARGET_VERSION=42
until curl -s http://localhost:9644/v1/cluster_config/status | \
  python3 -c "
import json,sys
nodes = json.load(sys.stdin)
all_ready = all(n['config_version'] >= $TARGET_VERSION for n in nodes)
print(all_ready)
" | grep -q True; do
  sleep 2
done
echo "All nodes on config version $TARGET_VERSION"
```

---

## Common Configuration Properties

The following are frequently changed properties. Verify the current schema with the `/schema` endpoint for exact types, ranges, and `needs_restart` flags.

| Property | Type | Description |
|----------|------|-------------|
| `log_retention_ms` | integer | Default log retention in milliseconds (-1 = infinite) |
| `retention_bytes` | integer | Default log retention size in bytes (-1 = infinite) |
| `log_compression_type` | string | Default compression: `none`, `gzip`, `lz4`, `snappy`, `zstd`, `producer` |
| `kafka_connections_max` | integer | Maximum Kafka client connections per broker |
| `kafka_connections_max_per_ip` | integer | Per-IP connection limit |
| `group_max_session_timeout_ms` | integer | Maximum consumer group session timeout |
| `group_min_session_timeout_ms` | integer | Minimum consumer group session timeout |
| `auto_create_topics_enabled` | boolean | Whether to auto-create topics on produce/consume |
| `default_topic_partitions` | integer | Default partition count for auto-created topics |
| `default_topic_replications` | integer | Default replication factor for auto-created topics |
| `enable_sasl` | boolean | Enable SASL authentication |
| `superusers` | array of string | List of usernames with superuser privileges |
| `cloud_storage_enabled` | boolean | Enable tiered storage |
| `data_transforms_enabled` | boolean | Enable Wasm data transforms |
| `partition_autobalancing_mode` | string | Balancer mode: `off` (disabled, not recommended for production), `node_add` (rebalance when a node is added), `continuous` (requires Enterprise license) |

---

## Notes on `needs_restart`

When you change a property with `needs_restart: true`, the change is accepted and propagated but does not take effect until each broker restarts. The `/v1/cluster_config/status` endpoint will show `restart: true` for affected nodes and list the property under `pending`.

Rolling restart workflow:
1. Apply config change via `PUT /v1/cluster_config`
2. Check `/v1/cluster_config/status` to confirm which nodes need restart
3. For each broker: enter maintenance mode → restart → exit maintenance mode
4. After all brokers restart, `/v1/cluster_config/status` should show `restart: false` for all nodes
