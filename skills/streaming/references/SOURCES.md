# streaming Skill Source Map

Maps each file in `skills/streaming/` to the source paths it derives from, so future syncs
and human maintainers know exactly where to verify claims.

The `streaming` skill documents the Kafka-API surface and behavior of the Redpanda broker
plus cluster/topic/broker properties and enterprise streaming features. It is grounded in
the **public** repo `redpanda-data/redpanda` (broker is C++ under `src/v/`; config under
`src/v/config/`) and the auto-generated reference + feature pages in the **public** repo
`redpanda-data/docs`. Both are public — read them via the Redpanda-Github-Read MCP
connector (`search_code`, `get_file_contents`), or `gh` for verification.

**Property grounding:** all cluster/topic/broker property claims are grounded in the
auto-generated partials under `modules/reference/partials/properties/`
(`cluster-properties.adoc`, `topic-properties.adoc`, `broker-properties.adoc`,
`object-storage-properties.adoc`, `topic-property-mappings.adoc`), regenerated per release;
their upstream source of truth is `src/v/config/configuration.cc` (cluster) and
`src/v/config/node_config.cc` (listener/broker). Do not pin property defaults to hardcoded
values. Streaming is versioned: verify against the **current stable release tag**, not
`dev`/`main`.

## File-to-source table

| Skill file | redpanda source paths | docs sources |
|---|---|---|
| `SKILL.md` | `src/v/kafka/server/handlers/`, `src/v/config/configuration.cc`, `src/v/config/node_config.cc` | `modules/reference/partials/properties/cluster-properties.adoc`, `topic-properties.adoc`, `broker-properties.adoc` |
| `references/core-concepts.md` | `src/v/kafka/server/handlers/` (per-API `.h`/`.cc`: `produce.cc`, `fetch.cc`, `list_offsets.cc`, `metadata.cc`, `offset_commit.h`, `offset_fetch.h`, `find_coordinator.cc`, `join_group.h`, `sync_group.h`, `create_topics.cc`, `init_producer_id.h`), `handler_interface.cc`, `src/v/config/configuration.cc` (`minimum_topic_replications`) | `modules/reference/partials/properties/cluster-properties.adoc` |
| `references/produce-data.md` | `src/v/kafka/server/handlers/produce.cc`, `produce_validation.cc`, `src/v/config/configuration.cc` (`enable_idempotence`, `write_caching_default`) | `modules/develop/pages/produce-data/configure-producers.adoc`, `idempotent-producers.adoc`, `modules/reference/partials/properties/topic-properties.adoc` |
| `references/consume-data.md` | `src/v/kafka/server/handlers/fetch.cc`, `src/v/kafka/server/group_manager.cc`, `handlers/offset_commit.h`, `offset_fetch.h`, `find_coordinator.cc`, `src/v/config/configuration.cc` (`enable_rack_awareness`) | `modules/develop/pages/consume-data/consumer-offsets.adoc`, `follower-fetching.adoc`, `modules/manage/pages/rack-awareness.adoc` |
| `references/transactions.md` | `src/v/cluster/rm_stm.cc`, `tx_gateway_frontend.cc`, `src/v/kafka/server/rm_group_frontend.cc`, `handlers/{init_producer_id.h,add_partitions_to_txn.h,add_offsets_to_txn.h,end_txn.h}`, `src/v/config/configuration.cc` (`enable_transactions`, `enable_idempotence`, `max_concurrent_producer_ids`, `transactional_id_expiration_ms`, `max_transactions_per_coordinator`, `transaction_coordinator_delete_retention_ms`, `transaction_coordinator_partitions`) | `modules/develop/pages/transactions.adoc`, `modules/reference/partials/properties/cluster-properties.adoc` |
| `references/topic-management.md` | `src/v/kafka/server/handlers/topics/types.cc`, `create_topics.cc`, `create_partitions.cc`, `alter_configs.cc`, `incremental_alter_configs.cc`, `describe_configs.cc`, `delete_records.cc`, `handlers/configs/storage_mode_properties.h`, `src/v/model/metadata.h`, `src/v/config/configuration.cc` (`default_topic_partitions`, `default_topic_replications`, `minimum_topic_replications`, `write_caching_default`, `default_leaders_preference`), `src/v/config/leaders_preference.cc` | `modules/develop/pages/manage-topics/config-topics.adoc`, `modules/manage/pages/cluster-maintenance/topic-property-configuration.adoc`, `modules/develop/pages/produce-data/leader-pinning.adoc`, `modules/reference/partials/properties/topic-properties.adoc` |
| `references/clients-and-compatibility.md` | `src/v/kafka/server/handlers/api_versions.cc`, `handler_interface.cc`, `handlers/{alter_client_quotas.h,describe_client_quotas.h}` | `modules/develop/pages/kafka-clients.adoc` |
| `references/tls-and-auth.md` | `src/v/config/node_config.cc` (`kafka_api`, `kafka_api_tls`, `advertised_kafka_api`), `src/v/config/configuration.cc` (`kafka_mtls_principal_mapping_rules`), `tls_config.cc`, `broker_authn_endpoint.cc`, `handlers/{sasl_handshake.h,sasl_authenticate.h}` | `modules/manage/pages/security/authentication.adoc`, `encryption.adoc`, `listener-configuration.adoc`, `authorization/` (ACLs), `modules/reference/partials/properties/broker-properties.adoc`, `cluster-properties.adoc` |
| `references/kafka-client-metadata.md` | `src/v/kafka/server/handlers/metadata.cc` (server-side metadata refresh / `NOT_LEADER_OR_FOLLOWER`). Client-side keys are external client libraries — no redpanda path. | `modules/manage/pages/cluster-maintenance/configure-client-connections.adoc`, `modules/develop/pages/kafka-clients.adoc` |
| `references/tiered-storage.md` | `src/v/config/configuration.cc` (`cloud_storage_enabled`, `cloud_storage_enable_remote_read`/`write`, `default_redpanda_storage_mode`), `handlers/configs/storage_mode_properties.h`, `src/v/model/metadata.h` | `modules/manage/pages/tiered-storage.adoc`, `remote-read-replicas.adoc`, `modules/reference/partials/properties/topic-properties.adoc`, `object-storage-properties.adoc`, `topic-property-mappings.adoc` |
| `references/enterprise-features.md` | `src/v/config/configuration.cc` (`cloud_storage_enabled`, `cloud_topics_enabled`, `iceberg_enabled`, `partition_autobalancing_mode`, `core_balancing_continuous`, `enable_shadow_linking`, `cloud_storage_enable_remote_read`, `enable_schema_id_validation`, `delete_topic_enable`, `default_leaders_preference`) | `modules/reference/partials/properties/cluster-properties.adoc`, `topic-properties.adoc` (+ per-feature pages in the rows below) |
| `references/iceberg-topics.md` | `src/v/datalake/` (`datalake_manager.cc`, `partition_spec_parser.cc`, `record_translator.cc`, `record_schema_resolver.cc`, `catalog_schema_manager.cc`), `src/v/config/configuration.cc` (`iceberg_enabled`, `iceberg_default_catalog_namespace`, `iceberg_delete`, `iceberg_invalid_record_action`, `iceberg_default_partition_spec`, `iceberg_target_lag_ms`, `iceberg_catalog_*`) | `modules/manage/pages/iceberg/about-iceberg-topics.adoc`, `use-iceberg-catalogs.adoc`, `iceberg-topics-aws-glue.adoc`, `specify-iceberg-schema.adoc`, `modules/reference/partials/properties/cluster-properties.adoc`, `topic-properties.adoc` |
| `references/cloud-topics.md` | `src/v/cloud_topics/`, `src/v/config/configuration.cc` (`cloud_topics_enabled`, `default_redpanda_storage_mode`), `handlers/configs/storage_mode_properties.h` | `modules/develop/pages/manage-topics/cloud-topics.adoc`, `configure-producers-for-cloud-topics.adoc`, `modules/reference/partials/properties/cluster-properties.adoc`, `topic-properties.adoc` |
| `references/continuous-balancing.md` | `src/v/config/configuration.cc` (`partition_autobalancing_mode`, `partition_autobalancing_node_availability_timeout_sec`, `partition_autobalancing_node_autodecommission_timeout_sec`, `partition_autobalancing_max_disk_usage_percent`, `core_balancing_continuous`, `core_balancing_on_core_count_change`), `src/v/model/metadata.h` | `modules/manage/pages/cluster-maintenance/continuous-data-balancing.adoc`, `cluster-balancing.adoc`, `modules/reference/partials/properties/cluster-properties.adoc` |
| `references/shadow-linking.md` | `src/v/cluster_link/` (`service.h`/`service.cc`, `frontend`, `shadow_linking_rpc.json`, `model/`), `src/v/cluster/cluster_link/frontend.cc` (`cluster_linking_enabled()`), `src/v/redpanda/admin/services/shadow_link/` (Admin API v2 service), `src/v/config/configuration.cc`/`configuration.h` (`enable_shadow_linking`, `shadow_link_failover_batch_size`), `src/v/features/enterprise_features.h` + `src/v/cluster/feature_manager.cc` (license gating) | `modules/manage/pages/disaster-recovery/shadowing/` (`overview.adoc`, `setup.adoc`, `monitor.adoc`, `failover.adoc`, `failover-runbook.adoc`), `modules/reference/partials/properties/cluster-properties.adoc` |

## Deferred to live introspection (NOT drift — do not pin or hardcode)

- **Kafka API handler version ranges** (`core-concepts.md`, `consume-data.md`, `transactions.md`, `topic-management.md` — e.g. `Produce 0–7`, `Fetch 4–13`, `InitProducerId 0–3`): version-specific, change per release. Source them from the handler templates (`single_stage_handler<...>`) at the target ref, not a fixed line.
- **Transaction/producer metrics** (`transactions.md`, e.g. `vectorized_cluster_producer_state_manager_*`): release-specific metric names — from generated metrics docs / live `/metrics`, not a source path.
- **Third-party client library config keys/defaults** (`kafka-client-metadata.md`, `produce-data.md`, `consume-data.md`, `clients-and-compatibility.md`, `tls-and-auth.md` — Java, librdkafka, franz-go, KafkaJS, kafka-python-ng): live in external client repos, not redpanda. Only server-side behavior maps here (`metadata.cc`, error code 6).

## Naming note

Shadow Linking is the **user-facing** name; internally the broker module is named
**`cluster_link`** / "cluster linking" (`src/v/cluster_link/`, `src/v/cluster/cluster_link/`,
`shadow_linking_rpc.json`, `feature::shadow_linking`). Search the source for `cluster_link`
and `shadow_link`, not `shadow-link`.

## TODO / re-verify

- **Iceberg / Cloud Topics per-topic property parsing:** grounded via `topic-properties.adoc` + the feature modules (`src/v/datalake/`, `src/v/cloud_topics/`). The exact C++ file registering the `redpanda.iceberg.*` / `redpanda.cloud_topic.*` topic-property strings is not pinned; `handlers/topics/types.cc` and `handlers/configs/storage_mode_properties.h` are the verified entry points.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm
every claim still matches. Verify against the current stable release tag of
`redpanda-data/redpanda`; prefer the generated property partials for property facts, and
re-confirm exact property keys / handler version ranges before writing any new fact.
