# Admin API Endpoints Overview

Complete map of the Redpanda Admin API endpoint groups. All endpoints are under base path `/v1` on port 9644. Grounded in the Swagger 1.2 JSON specs in `src/v/redpanda/admin/api-doc/`.

## broker.json — Brokers

| Method | Path | Nickname | Description |
|--------|------|----------|-------------|
| GET | `/v1/cluster_view` | `get_cluster_view` | Get cluster view (version + broker list) |
| GET | `/v1/brokers` | `get_brokers` | List all brokers |
| GET | `/v1/broker_uuids` | `get_broker_uuids` | List node_id → UUID mappings |
| GET | `/v1/brokers/{id}` | `get_broker` | Get single broker info |
| GET | `/v1/brokers/{id}/decommission` | `get_decommission` | Get decommission progress |
| PUT | `/v1/brokers/{id}/decommission` | `decommission` | Start broker decommission |
| PUT | `/v1/brokers/{id}/recommission` | `recommission` | Cancel decommission |
| PUT | `/v1/brokers/{id}/maintenance` | `start_broker_maintenance` | Enter maintenance mode |
| DELETE | `/v1/brokers/{id}/maintenance` | `stop_broker_maintenance` | Exit maintenance mode |
| POST | `/v1/brokers/{id}/cancel_partition_moves` | `cancel_partition_moves` | Cancel all partition moves to/from this broker |
| PUT | `/v1/maintenance` | `start_local_maintenance` | Force start local maintenance |
| DELETE | `/v1/maintenance` | `stop_local_maintenance` | Force stop local maintenance |
| GET | `/v1/maintenance` | `get_local_maintenance` | Get local maintenance status |
| PUT | `/v1/reset_crash_tracking` | `reset_crash_tracking` | Reset crash tracking |
| GET | `/v1/broker/pre_restart_probe` | `pre_restart_probe` | Check restart safety (lists at-risk partitions) |
| GET | `/v1/broker/post_restart_probe` | `post_restart_probe` | Check post-restart recovery progress |

### `broker` Response Schema

```json
{
  "node_id": 1,
  "num_cores": 4,
  "rack": "us-east-1a",
  "internal_rpc_address": "node1.example.com",
  "internal_rpc_port": 33145,
  "membership_status": "active",
  "is_alive": true,
  "recovery_mode_enabled": false,
  "disk_space": [{"path": "/var/lib/redpanda/data", "free": 12345678, "total": 99999999}],
  "version": "v25.1.0",
  "maintenance_status": {"draining": false, "finished": false, "errors": false, "partitions": 0, "eligible": 0, "transferring": 0, "failed": 0},
  "in_fips_mode": "disabled"
}
```

### `decommission_status` Response Schema

```json
{
  "finished": false,
  "replicas_left": 42,
  "allocation_failures": [],
  "partitions": [...],
  "reallocation_failure_details": []
}
```

### `pre_restart_probe` Response Schema

Returns a `risks` object (type `restart_risks`) with four arrays of NTP strings:
- `rf1_offline` — RF-1 partitions that will go offline
- `full_acks_produce_unavailable` — partitions that may reject acks=-1 produces
- `unavailable` — partitions that may go fully unavailable
- `acks1_data_loss` — partitions that may lose acks=1 data

---

## partition.json — Partitions

| Method | Path | Nickname | Description |
|--------|------|----------|-------------|
| GET | `/v1/partitions` | `get_partitions` | List partitions with a replica on **this node** (not cluster-wide) |
| GET | `/v1/partitions/local_summary` | `get_partitions_local_summary` | Node-local summary: count, leaderless, under_replicated |
| GET | `/v1/partitions/{namespace}/{topic}/{partition}` | `get_partition` | Detailed partition info |
| GET | `/v1/partitions/{namespace}/{topic}` | `get_topic_partitions` | All partitions of a topic |
| POST | `/v1/partitions/{namespace}/{topic}/{partition}/replicas` | `set_partition_replicas` | Move replicas to new nodes/cores |
| POST | `/v1/partitions/{namespace}/{topic}/{partition}/replicas/{node}` | `set_partition_replica_core` | Update a single replica's core assignment |
| POST | `/v1/partitions/{namespace}/{topic}/{partition}/transfer_leadership` | `kafka_transfer_leadership` | Transfer partition leadership (optional `target` node) |
| POST | `/v1/partitions/{namespace}/{topic}/{partition}/cancel_reconfiguration` | `cancel_partition_reconfiguration` | Cancel ongoing reconfiguration |
| POST | `/v1/partitions/{namespace}/{topic}/{partition}/unclean_abort_reconfiguration` | `unclean_abort_partition_reconfiguration` | Forcibly abort reconfiguration |
| GET | `/v1/partitions/reconfigurations` | `get_partition_reconfigurations` | List ongoing reconfigurations |
| POST | `/v1/partitions/rebalance` | `trigger_partitions_rebalance` | On-demand partition rebalance |
| POST | `/v1/partitions/rebalance_cores` | `trigger_partitions_shard_rebalance` | Trigger core placement rebalance on this broker |
| GET | `/v1/partitions/{namespace}/{topic}/{partition}/transactions` | `get_transactions` | Get transactions for a partition |
| POST | `/v1/partitions/{namespace}/{topic}/{partition}/mark_transaction_expired` | `mark_transaction_expired` | Force-expire a transaction (by producer_id + epoch) |
| GET | `/v1/partitions/majority_lost` | `majority_lost` | List partitions with majority loss given dead node IDs |
| POST | `/v1/partitions/force_recover_from_nodes` | `force_recover_from_nodes` | Force recover partitions from a set of nodes |
| GET | `/v1/debug/partitions/{topic}/{partition}/offset_for_leader_epoch` | `offset_for_leader_epoch` | Query offset for a specific leader epoch |
| POST | `/v1/debug/partitions/{namespace}/{topic}/{partition}/force_replicas` | `force_update_partition_replicas` | Force-set a partition's replicas (last resort); controller partition requires `evil_mode=true` (v26.1.12+) |

### Namespace Convention

Kafka topics use namespace `kafka`. Internal Redpanda topics use namespace `redpanda`. Always pass the namespace in the path:
```
/v1/partitions/kafka/my-topic/0
```

### `partition` Response Schema

```json
{
  "ns": "kafka",
  "topic": "my-topic",
  "partition_id": 0,
  "status": "done",
  "leader_id": 1,
  "raft_group_id": 5,
  "replicas": [
    {"node_id": 1, "core": 0},
    {"node_id": 2, "core": 1},
    {"node_id": 3, "core": 0}
  ],
  "disabled": false
}
```

### `reconfiguration` Response Schema (from `/v1/partitions/reconfigurations`)

```json
{
  "ns": "kafka",
  "topic": "my-topic",
  "partition": 0,
  "previous_replicas": [...],
  "current_replicas": [...],
  "status": "in_progress",
  "bytes_left_to_move": 1048576,
  "bytes_moved": 512000,
  "partition_size": 1560576,
  "reconfiguration_policy": "full_local_retention",
  "reconciliation_statuses": [...]
}
```

---

## cluster.json — Cluster-Level

| Method | Path | Nickname | Description |
|--------|------|----------|-------------|
| GET | `/v1/cluster/health_overview` | `get_cluster_health_overview` | Cluster health summary |
| GET | `/v1/cluster/partition_balancer/status` | `get_partition_balancer_status` | Partition autobalancer status |
| POST | `/v1/cluster/cancel_reconfigurations` | `cancel_all_partitions_reconfigurations` | Cancel all in-progress reconfigurations |
| GET | `/v1/cluster/uuid` | `get_cluster_uuid` | Internal cluster UUID |
| GET | `/v1/cluster/metrics_uuid` | `get_metrics_uuid` | Metrics-system cluster UUID |
| GET | `/v1/cluster/partitions` | `get_cluster_partitions` | Cluster-wide partition metadata |
| GET | `/v1/cluster/partitions/{namespace}/{topic}` | `get_cluster_partitions_topic` | Cluster-wide partitions for a topic |
| POST | `/v1/cluster/partitions/{namespace}/{topic}` | `post_cluster_partitions_topic` | Enable/disable all partitions of a topic |
| POST | `/v1/cluster/partitions/{namespace}/{topic}/{partition}` | `post_cluster_partitions_topic_partition` | Enable/disable a single partition |

### `cluster_health_overview` Response Schema

```json
{
  "is_healthy": true,
  "unhealthy_reasons": [],
  "controller_id": 1,
  "all_nodes": [1, 2, 3],
  "nodes_down": [],
  "high_disk_usage_nodes": [],
  "nodes_in_recovery_mode": [],
  "leaderless_partitions": [],
  "leaderless_count": 0,
  "under_replicated_partitions": [],
  "under_replicated_count": 0,
  "bytes_in_cloud_storage": 123456789
}
```

### `partition_balancer_status` Response Schema

```json
{
  "status": "ready",
  "violations": {
    "unavailable_nodes": [],
    "over_disk_limit_nodes": []
  },
  "seconds_since_last_tick": 5,
  "current_reassignments_count": 0,
  "partitions_pending_force_recovery_count": 0,
  "partitions_pending_force_recovery_sample": []
}
```

Balancer `status` values: `off`, `ready`, `in_progress`, `stalled`.

---

## cluster_config.json — Cluster Configuration

| Method | Path | Nickname | Description |
|--------|------|----------|-------------|
| GET | `/v1/cluster_config` | `get_cluster_config` | Read cluster config |
| PUT | `/v1/cluster_config` | `patch_cluster_config` | Alter cluster config |
| GET | `/v1/cluster_config/status` | `get_cluster_config_status` | Per-node config status (restart needed?) |
| GET | `/v1/cluster_config/schema` | `get_cluster_config_schema` | Full config schema with property metadata |

Query parameters for `GET /v1/cluster_config`:
- `key=<name>` — read a single property
- `include_defaults=true` — include properties at their default value
- `suppress_pending=true` — report active runtime values (hide pending-restart values)

Query parameters for `GET /v1/cluster_config/status`:
- `show_pending=true` — include per-node lists of config properties awaiting restart to apply pending values

Query parameters for `PUT /v1/cluster_config`:
- `force=1` — skip validation, allow unknown properties
- `dry_run=1` — validate only, do not apply

Request body for `PUT`:
```json
{
  "upsert": {"property_name": "value"},
  "remove": ["property_to_reset_to_default"]
}
```

### `cluster_config_property_metadata` Schema Fields

Each property in the schema has:
- `description` — human-readable explanation
- `type` — value type (string, integer, boolean, array, etc.)
- `nullable` — whether null is allowed
- `needs_restart` — whether changing this property requires a broker restart
- `visibility` — `user`, `tunable`, or `deprecated`
- `is_secret` — whether the value should be hidden in logs
- `units` — optional (e.g., `ms`, `bytes`)
- `example` — example value string
- `enum_values` — allowed values for enum properties
- `aliases` — legacy names accepted in requests

---

## features.json — Features and Licensing

| Method | Path | Nickname | Description |
|--------|------|----------|-------------|
| GET | `/v1/features` | `get_features` | List all features with their state |
| GET | `/v1/features/license` | `get_license` | Get loaded license info |
| PUT | `/v1/features/license` | `put_license` | Upload a new license |
| PUT | `/v1/features/{feature_name}` | `put_feature` | Activate or deactivate a feature |
| GET | `/v1/features/enterprise` | `get_enterprise` | License status + enterprise features in use |

### Feature `state` Values

`active`, `preparing`, `available`, `unavailable`, `disabled`

### `license_response` Schema

```json
{
  "loaded": true,
  "license": {
    "format_version": 1,
    "org": "acme-corp",
    "type": "enterprise",
    "products": ["redpanda"],
    "expires": 1893456000,
    "sha256": "abc123..."
  }
}
```

### `enterprise_response` Schema

```json
{
  "license_status": "valid",
  "violation": false,
  "features": [
    {"name": "fips_compliance", "enabled": false},
    {"name": "tiered_storage", "enabled": true}
  ]
}
```

`license_status` values: `valid`, `expired`, `not_present`.

---

## security.json — Security / Users

| Method | Path | Operation | Description |
|--------|------|-----------|-------------|
| POST | `/v1/security/users` | `create_user` | Create a SASL user |
| GET | `/v1/security/users` | `list_users` | List SASL users |
| DELETE | `/v1/security/users/{user}` | `delete_user` | Delete a SASL user |
| PUT | `/v1/security/users/{user}` | `update_user` | Update user (change password) |
| GET | `/v1/security/users/roles` | `list_user_roles` | List roles for a user |
| GET | `/v1/security/oidc/whoami` | `oidc_whoami` | Inspect JWT bearer token principal |

---

## transaction.json — Transactions

| Method | Path | Nickname | Description |
|--------|------|----------|-------------|
| GET | `/v1/transactions` | `get_all_transactions` | List all transactions cluster-wide |
| GET | `/v1/transaction/{transactional_id}/find_coordinator` | `find_coordinator` | Find coordinator by transactional ID |
| POST | `/v1/transaction/{transactional_id}/delete_partition` | `delete_partition` | Remove a partition from a transaction |
| POST | `/v1/transaction/unsafe_abort_group_transaction/{group_id}` | `unsafe_abort_group_transaction` | Force-abort a group transaction |

---

## shadow_indexing.json (cloud_storage) — Tiered Storage

| Method | Path | Operation | Description |
|--------|------|-----------|-------------|
| POST | `/v1/cloud_storage/sync_local_state/{topic}/{partition}` | `sync_local_state` | Sync bucket with local partition metadata |
| POST | `/v1/cloud_storage/automated_recovery` | `initialize_cluster_recovery` | Initialize cluster recovery from tiered storage |
| GET | `/v1/cloud_storage/automated_recovery` | `get_cluster_recovery` | Get cluster recovery status |
| POST | `/v1/cloud_storage/topic_recovery` | `initiate_topic_scan_and_recovery` | Scan bucket and start topic recovery |
| GET | `/v1/cloud_storage/topic_recovery` | `query_automated_recovery` | Query topic recovery status |
| GET | `/v1/cloud_storage/status/{topic}/{partition}` | `get_partition_cloud_storage_status` | Cloud storage status for a partition |
| GET | `/v1/cloud_storage/manifest/{topic}/{partition}` | `get_manifest` | In-memory partition manifest as JSON |
| GET | `/v1/cloud_storage/lifecycle` | `get_cloud_storage_lifecycle` | Lifecycle markers for topics pending deletion |

---

## debug.json — Debug Endpoints

See [debug-endpoints.md](debug-endpoints.md) for full detail. Key paths:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/debug/cpu_profile` | CPU profiler samples (optional `shard`, `wait_ms`) |
| GET | `/v1/debug/storage/disk_stat/{type}` | Disk statistics (`{type}` must be exactly `data` or `cache`) |
| GET | `/v1/debug/controller_status` | Controller log offsets |
| GET | `/v1/debug/partition/{namespace}/{topic}/{partition}` | Low-level replica state for a partition |
| GET | `/v1/debug/producers/{namespace}/{topic}/{partition}` | Producer debug state |
| GET | `/v1/debug/sampled_memory_profile` | Sampled live memory allocations |
| POST | `/v1/debug/self_test/start` | Start disk/network self-test |
| POST | `/v1/debug/self_test/stop` | Stop self-test |
| GET | `/v1/debug/self_test/status` | Query self-test results |
| GET | `/v1/debug/partition_leaders_table` | Leaders table snapshot |
| GET | `/v1/debug/is_node_isolated` | Whether this node appears isolated |
| GET | `/v1/debug/peer_status/{id}` | Milliseconds since last contact with peer |
| GET | `/v1/debug/local_storage_usage` | Local storage usage breakdown |
| GET | `/v1/debug/cloud_storage_usage` | Total bytes in cloud storage across all partitions |
| POST | `/v1/debug/refresh_disk_health_info` | Force refresh disk health info |

---

## debug_bundle.json — Debug Bundle

| Method | Path | Operation | Description |
|--------|------|-----------|-------------|
| POST | `/v1/debug/bundle` | `post_debug_bundle` | Start a debug bundle collection process |
| GET | `/v1/debug/bundle` | `get_debug_bundle` | Get status of a running/completed bundle |
| DELETE | `/v1/debug/bundle/{jobid}` | `delete_debug_bundle` | Abort a running bundle process |
| GET | `/v1/debug/bundle/file/{filename}` | `get_debug_bundle_file` | Download the completed bundle ZIP |
| DELETE | `/v1/debug/bundle/file/{filename}` | `delete_debug_bundle_file` | Delete the bundle file |

---

## ConnectRPC Endpoints (v25.3+)

New endpoints introduced in Redpanda v25.3 use ConnectRPC:

- URL pattern: `http://<broker>:9644/<service>/<method>`
  - Example: `redpanda.core.admin.v2.ShadowLinkService/FailOver`
- Method: always **POST**
- Content-Type: `application/json` (JSON body) or `application/proto` (binary Protobuf)
- Optional headers: `Connect-Protocol-Version`, `Connect-Timeout-Ms`
- SDK generation via Buf CLI from `buf.build/redpandadata/core`

Legacy `/v1` endpoints remain fully supported and are unchanged.
