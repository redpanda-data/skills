# Debugging the Redpanda Iceberg / Kafka Source

Oxla ingests data from external systems registered in `system.catalogs`, where the
`type` column is either `iceberg` (an Apache Iceberg catalog) or `redpanda` (a
Kafka-protocol connection to a Redpanda cluster). When ingestion stalls, the root
cause often lives on the **Redpanda side** — specifically in Redpanda's
**Iceberg Topics** integration, which is the producer of the Iceberg tables Oxla
reads. This reference grounds the Redpanda-side configuration so you can correlate
an Oxla symptom (no new rows, stale Iceberg snapshot, missing records) with the
upstream Redpanda setting that controls it.

> **Enterprise license required.** Redpanda's Iceberg Topics integration is a
> Redpanda Enterprise Edition feature. Without a valid license, topics cannot be
> created or modified with the `redpanda.iceberg.mode` property, and existing
> Iceberg translation stops being configurable. Verify with
> `rpk cluster license info` on the Redpanda cluster. Tiered Storage (also
> Enterprise) is a hard prerequisite — Iceberg tables are written alongside the
> Tiered Storage log segments in object storage.

Sources (Redpanda docs, verified): `manage/iceberg/about-iceberg-topics.adoc`,
`manage/iceberg/use-iceberg-catalogs.adoc`, `manage/iceberg/iceberg-troubleshooting.adoc`,
`reference/properties/topic-properties.adoc`, `get-started/licensing/overview.adoc`.

---

## How Oxla sees the integration

```sql
-- Which external catalogs are registered, and of what type?
SELECT name, namespace_name, type FROM system.catalogs;
-- type = 'iceberg'  -> an Iceberg REST/object-storage catalog Oxla reads tables from
-- type = 'redpanda' -> a Kafka-protocol connection to a Redpanda cluster
```

If a `redpanda` catalog is registered but `oxla_kafka_messages_consumed_total` is
flat, the stall is on the Kafka path. If an `iceberg` catalog is registered but a
table shows no new rows, the stall is in Redpanda's Iceberg translation — check the
Redpanda-side properties below before assuming the problem is in Oxla.

---

## Redpanda cluster-level config (enables the integration)

These are set on the **Redpanda** cluster (via `rpk cluster config set`), not in
Oxla. They are the gate for everything downstream.

| Cluster property | Purpose | Default | License |
|---|---|---|---|
| `iceberg_enabled` | Master switch for the Iceberg integration on the cluster. Must be `true` before any topic produces Iceberg data. Changing it on a running cluster requires a restart. | `false` | Enterprise |
| `iceberg_catalog_type` | Catalog backend: `object_storage` (filesystem/HadoopCatalog in the same bucket) or `rest`. | `object_storage` | Enterprise |
| `iceberg_default_catalog_namespace` | Iceberg namespace for created tables. Each cluster writing to a shared catalog (e.g. AWS Glue) must use a distinct namespace. Cannot be changed after enabling Iceberg. | `redpanda` | Enterprise |
| `iceberg_delete` | Cluster-wide default for `redpanda.iceberg.delete`. | `true` | Enterprise |
| `iceberg_invalid_record_action` | Cluster-wide default for `redpanda.iceberg.invalid.record.action`. | `dlq_table` | Enterprise |
| `iceberg_default_partition_spec` | Cluster-wide default for `redpanda.iceberg.partition.spec`. | `(hour(redpanda.timestamp))` | Enterprise |

### REST catalog connection (`iceberg_catalog_type: rest`)

When Redpanda writes to a REST catalog that Oxla also reads, the auth/endpoint
must line up. Nested REST catalog keys:

| Property | Purpose |
|---|---|
| `iceberg_rest_catalog_endpoint` | Catalog endpoint URL. Required when `iceberg_catalog_type=rest` (set both together). |
| `iceberg_rest_catalog_authentication_mode` | `oauth2`, `aws_sigv4`, `bearer`, or `none` (default). Use `aws_sigv4` for AWS Glue. |
| `iceberg_rest_catalog_oauth2_server_uri` | OAuth token endpoint URI (for `oauth2`). |
| `iceberg_rest_catalog_client_id` | OAuth client ID (for `oauth2`). |
| `iceberg_rest_catalog_client_secret` | OAuth client secret (for `oauth2`; store as a secret). |
| `iceberg_rest_catalog_token` | Bearer token (for `bearer` mode; not auto-refreshed). |
| `iceberg_rest_catalog_warehouse` | Catalog warehouse name (e.g. for Snowflake Open Catalog/Polaris). |
| `iceberg_rest_catalog_trust` / `iceberg_rest_catalog_trust_file` | Trusted certificate chain (contents / file path) for self-signed REST catalogs. |
| `iceberg_rest_catalog_crl` / `iceberg_rest_catalog_crl_file` | Certificate revocation list (contents / file path). |

If Oxla's `iceberg` catalog points at the same REST endpoint, an auth/endpoint
mismatch shows up as Oxla failing to load tables while Redpanda's
`redpanda_iceberg_rest_client_num_*_requests_failed` counters climb.

---

## Redpanda topic-level config (per topic that feeds Oxla)

Set per topic on the Redpanda cluster:
`rpk topic alter-config <topic> --set redpanda.iceberg.mode=<mode>`.
All are restored on Whole Cluster Restore.

| Topic property | Type | Accepted values / default | Meaning |
|---|---|---|---|
| `redpanda.iceberg.mode` | string | `key_value`, `value_schema_id_prefix`, `value_schema_latest`, `disabled`; default `null`/`disabled` | Enables and shapes the Iceberg table. `key_value` = 2-column semi-structured table; `value_schema_id_prefix` = structured columns from the wire-format schema ID; `value_schema_latest` = structured from latest registered subject schema; `disabled` = no Iceberg writes. |
| `redpanda.iceberg.delete` | boolean | default `true` | If `true`, the Iceberg table is deleted when the topic is deleted. Set `false` to keep the table (and its history) available to Oxla after the topic is gone. |
| `redpanda.iceberg.invalid.record.action` | string (enum) | `drop`, `dlq_table`; default `dlq_table` | What happens to records that fail translation. `dlq_table` writes them to `<topic-name>~dlq`; `drop` discards them. |
| `redpanda.iceberg.partition.spec` | string | default `(hour(redpanda.timestamp))` | Iceberg partition spec for the table. Affects how Oxla/query engines prune partitions. |
| `redpanda.iceberg.target.lag.ms` | integer (ms) | default `null` | How often Redpanda commits new topic data into the Iceberg table. **This is the single biggest lever for "Oxla sees stale data."** A large value (or unset/under-resourced) means the latest produced records are not yet committed to the table Oxla queries. |

### Schema-based modes depend on Schema Registry + Schema ID Validation

`value_schema_id_prefix` and `value_schema_latest` require a registered schema and
producers using the Schema Registry wire format (magic byte + schema ID). If
producers do not use the wire format, records cannot be translated. This intersects
with Redpanda's **Server-Side Schema ID Validation** (Enterprise:
`enable_schema_id_validation`, plus topic-level `redpanda.key.schema.id.validation`
/ `redpanda.value.schema.id.validation`) — when validation is on, unregistered-schema
records are dropped at the broker and never reach the Iceberg table, so they will
never appear in Oxla either.

---

## Stale-data / missing-rows checklist (Oxla symptom -> Redpanda cause)

| Oxla symptom | Likely Redpanda-side cause | Where to look |
|---|---|---|
| Iceberg table exists but no new rows | `redpanda.iceberg.target.lag.ms` too high, or translation paused | Redpanda metric `redpanda_iceberg_pending_commit_lag`, `redpanda_iceberg_pending_translation_lag` |
| Rows silently missing | Invalid records dropped (`redpanda.iceberg.invalid.record.action=drop`) or sent to DLQ | Query `<topic-name>~dlq`; metric `redpanda_iceberg_translation_invalid_records`, `redpanda_iceberg_translation_dlq_files_created` |
| Oxla cannot load the table at all | REST catalog auth/endpoint mismatch | Redpanda metric `redpanda_iceberg_rest_client_num_commit_table_update_requests_failed`, `*_num_load_table_requests_failed` |
| Table disappeared after topic delete | `redpanda.iceberg.delete=true` (default) deleted it with the topic | Topic config on Redpanda |
| Topic never produced any Iceberg data | `iceberg_enabled=false`, no Enterprise license, or Tiered Storage not enabled | `rpk cluster license info`; `rpk cluster config get iceberg_enabled` |

### Dead-letter queue (DLQ)

When translation fails in the schema modes, Redpanda writes the record to a DLQ
Iceberg table named `<topic-name>~dlq` (always `key_value` schema: one metadata
column + one binary `value` column). The DLQ table follows the same persistence
rules as the main table. From Oxla / any Iceberg query engine:

```sql
-- Inspect failed records (binary value)
SELECT value FROM <catalog-name>."<topic-name>~dlq";
```

A non-empty DLQ with `redpanda_iceberg_translation_invalid_records` climbing means
the gap between what producers send and what Oxla can read is caused by
translation failures (missing schema ID, untranslatable type, or wire-format not
used) — not by Oxla.

---

## Cross-references

- Oxla side of the catalog: [system-tables.md](system-tables.md) (`system.catalogs`, `system.tables`).
- Kafka ingestion metrics on the Oxla side: [metrics-and-logging.md](metrics-and-logging.md) (`oxla_kafka_*`).
- Kafka ingestion stall playbook: [troubleshooting.md](troubleshooting.md) (Playbook 4).
