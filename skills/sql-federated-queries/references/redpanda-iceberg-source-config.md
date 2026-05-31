# Redpanda Enterprise Source Config (Producing the Data Oxla Queries)

This skill covers the **Oxla read side**: `CREATE KAFKA/REDPANDA CATALOG`,
`CREATE ICEBERG CATALOG`, transparent Kafka-Iceberg queries, and the Schema
Registry decoding that powers them. That data does not exist until it is
produced on the **Redpanda side** by enterprise features. This reference
documents the Redpanda cluster/topic configuration that creates the Iceberg
tables, Tiered Storage segments, and validated schemas that Oxla then reads.

> **Enterprise license required.** Iceberg Topics, Tiered Storage, and
> Server-Side Schema ID Validation are Redpanda **Enterprise Edition** features
> and require a valid license key (`rpk cluster license info`). Without a valid
> license, topics cannot be created or modified to enable these features.
> Source: `get-started/licensing/overview.adoc`,
> `get-started/licensing/disable-enterprise-features.adoc`.

Sources grounded in:
`docs/modules/manage/pages/iceberg/about-iceberg-topics.adoc`,
`docs/modules/manage/pages/iceberg/use-iceberg-catalogs.adoc`,
`docs/modules/reference/partials/properties/topic-properties.adoc`,
`docs/modules/reference/attachments/redpanda-properties-v26.1.8.json`,
`docs/modules/get-started/pages/licensing/overview.adoc`,
`docs/modules/get-started/pages/licensing/disable-enterprise-features.adoc`.

---

## How this maps to the Oxla side

| Oxla query path (this skill) | Redpanda enterprise feature that produces it |
|------------------------------|----------------------------------------------|
| `CREATE ICEBERG CATALOG` + `catalog=>ns.table` queries | **Iceberg Topics** (`redpanda.iceberg.mode`) writing Parquet + catalog metadata to object storage |
| Transparent Kafka-Iceberg (`USING CATALOG`, `pandaproxy_url`) | **Iceberg Topics** REST/filesystem catalog backing the topic |
| Schema decoding (Avro/Protobuf/JSON) via `schema_registry_url` | Schema Registry; optionally **Server-Side Schema ID Validation** guaranteeing only registered schemas land in the topic |
| Long-retention topic reads / object-store data files | **Tiered Storage** (`cloud_storage_enabled`), a prerequisite for Iceberg Topics |

When Oxla points an `CREATE ICEBERG CATALOG` at a REST catalog, that catalog is
the **same** catalog Redpanda writes to via `iceberg_rest_catalog_endpoint`. The
Oxla `uri` / `auth_type` options must match the catalog Redpanda is populating.

---

## Iceberg Topics (Enterprise)

Enabling Iceberg for a topic makes Redpanda write topic data to Apache Iceberg
v2 tables (Parquet data files) in object storage, in addition to the Tiered
Storage log segments. These are the tables Oxla reads with `CREATE ICEBERG
CATALOG` or transparent queries.

**Prerequisites** (from `about-iceberg-topics.adoc`):
- Enterprise license applied (`rpk cluster license info`).
- Tiered Storage enabled for the topic (`cloud_storage_enabled=true`).

### Cluster property to turn it on

```bash
# Enable the integration cluster-wide (Enterprise).
rpk cluster config set iceberg_enabled true

# Optional: custom catalog namespace (default "redpanda"); set BEFORE or AT THE
# SAME TIME as iceberg_enabled, never after. Value is a list.
rpk cluster config set iceberg_default_catalog_namespace '["<custom-namespace>"]'
```

### Per-topic Iceberg properties (`redpanda.iceberg.*`)

Grounded in `topic-properties.adoc`. Set with
`rpk topic alter-config <topic> --set <key>=<value>`.

| Topic property | Type | Default | Accepted values / notes | Cluster default property |
|----------------|------|---------|-------------------------|--------------------------|
| `redpanda.iceberg.mode` | string | `null` (disabled) | `key_value`, `value_schema_id_prefix`, `value_schema_latest`, `disabled` | — |
| `redpanda.iceberg.delete` | boolean | `true` | If `true`, the Iceberg table is dropped when the topic is deleted; `false` keeps the table | `iceberg_delete` |
| `redpanda.iceberg.invalid.record.action` | string (enum) | `dlq_table` | `drop` or `dlq_table` (writes bad records to `<topic>~dlq`) | `iceberg_invalid_record_action` |
| `redpanda.iceberg.partition.spec` | string | `(hour(redpanda.timestamp))` | Iceberg partition spec expression | `iceberg_default_partition_spec` |
| `redpanda.iceberg.target.lag.ms` | integer (ms) | `null` | How often the Iceberg table is refreshed with new topic data | `iceberg_target_lag_ms` |

### The four Iceberg modes

| Mode | Table structure | Schema Registry required |
|------|-----------------|--------------------------|
| `key_value` | Two columns: record metadata (incl. key) + a binary value column | No |
| `value_schema_id_prefix` | Columns match the Redpanda schema; producers must use Schema Registry wire format (5-byte prefix) | Yes |
| `value_schema_latest` | Columns match the latest registered schema for the subject | Yes |
| `disabled` (default) | No Iceberg table written | — |

`value_schema_id_prefix` / `value_schema_latest` produce the column-typed
Iceberg tables that Oxla projects with `SELECT col1, col2 FROM cat=>ns.table`.
`key_value` produces the two-column binary form.

### Enable example

```bash
rpk cluster config set iceberg_enabled true          # Enterprise, cluster-wide
rpk topic create clicks
rpk topic alter-config clicks --set redpanda.iceberg.mode=value_schema_id_prefix
rpk topic alter-config clicks --set redpanda.iceberg.target.lag.ms=60000
rpk topic alter-config clicks --set redpanda.iceberg.partition.spec='(hour(redpanda.timestamp))'
rpk registry schema create clicks-value --schema clicks.avsc --type avro
```

The DLQ table `<topic>~dlq` follows the same persistence rules as the main
table and is itself an Iceberg table Oxla can read.

---

## Iceberg catalog backing (must match the Oxla `CREATE ICEBERG CATALOG`)

Redpanda writes Iceberg metadata to one of two catalog types
(`use-iceberg-catalogs.adoc`). Whichever Redpanda uses, point Oxla's
`CREATE ICEBERG CATALOG` at the same catalog.

### REST catalog (recommended for production)

```bash
rpk cluster config set iceberg_catalog_type rest
rpk cluster config set iceberg_rest_catalog_endpoint http://catalog-service:8181
```

REST catalog cluster properties (grounded in
`redpanda-properties-v26.1.8.json` and `use-iceberg-catalogs.adoc`):

| Cluster property | Purpose |
|------------------|---------|
| `iceberg_catalog_type` | `rest` or `object_storage` (default) |
| `iceberg_rest_catalog_endpoint` | Catalog endpoint URL (set together with `iceberg_catalog_type=rest`) |
| `iceberg_rest_catalog_authentication_mode` | `oauth2`, `aws_sigv4`, `bearer`, or `none` (default) |
| `iceberg_rest_catalog_oauth2_server_uri` | OAuth token endpoint (oauth2 mode) |
| `iceberg_rest_catalog_client_id` | OAuth client ID (oauth2 mode) |
| `iceberg_rest_catalog_client_secret` | OAuth client secret (oauth2 mode) — store as a secret |
| `iceberg_rest_catalog_token` | Bearer token (bearer mode) |
| `iceberg_rest_catalog_aws_region` | AWS region (aws_sigv4 mode, e.g. AWS Glue) |
| `iceberg_rest_catalog_aws_access_key` / `iceberg_rest_catalog_aws_secret_key` | Static AWS creds (aws_sigv4) |
| `iceberg_rest_catalog_aws_service_name` | SigV4 service segment |
| `iceberg_rest_catalog_warehouse` | Warehouse identifier |
| `iceberg_rest_catalog_prefix` | Catalog prefix |
| `iceberg_rest_catalog_trust` / `iceberg_rest_catalog_trust_file` | CA chain (self-signed) |
| `iceberg_rest_catalog_crl` / `iceberg_rest_catalog_crl_file` | Certificate revocation list |
| `iceberg_rest_catalog_request_timeout_ms` | REST request timeout |

**Mapping note:** Redpanda's `iceberg_rest_catalog_authentication_mode=oauth2`
corresponds to Oxla's `auth_type='oauth2'`; `aws_sigv4` corresponds to Oxla's
`auth_type='aws_sigv4'`; `bearer`/`none` align with Oxla bearer/unauthenticated
catalogs. The Redpanda `iceberg_rest_catalog_endpoint` is the value you pass to
Oxla's `uri`.

### Filesystem (`object_storage`) catalog

```bash
rpk cluster config set iceberg_catalog_type object_storage   # default
rpk cluster config set iceberg_catalog_base_location redpanda-iceberg-catalog
```

With `object_storage`, Redpanda writes HadoopCatalog-format `metadata.json` into
the same bucket as the data files. Oxla typically consumes these via a REST
catalog layer or by transparent Kafka-Iceberg queries with a `pandaproxy_url`.

---

## Tiered Storage (Enterprise) — prerequisite

Iceberg Topics require Tiered Storage. Tiered Storage is itself an Enterprise
feature; disabling it removes the license requirement but also disables Iceberg.

```bash
# Enable Tiered Storage cluster-wide (Enterprise).
rpk cluster config set cloud_storage_enabled true
```

Per the licensing docs, on license expiration: topics cannot be created or
modified to enable Tiered Storage, and partitions cannot be added to topics with
Tiered Storage properties. Source: `licensing/overview.adoc`,
`licensing/disable-enterprise-features.adoc` (disable knob:
`cloud_storage_enabled=false`).

---

## Server-Side Schema ID Validation (Enterprise)

Oxla decodes records against the Schema Registry. Server-Side Schema ID
Validation guarantees, on the Redpanda side, that only records whose schema ID
is registered are accepted — records with unregistered schemas are dropped by
the broker rather than failing in Oxla's decoder. This keeps Oxla's
`error_handling_policy` from having to absorb malformed records.

**Enable knob** (cluster, Enterprise):

```bash
rpk cluster config set enable_schema_id_validation true
```

Disable knob (to drop the license requirement): `enable_schema_id_validation
false` (source: `licensing/disable-enterprise-features.adoc`).

Per-topic validation properties (grounded in `topic-properties.adoc`):

| Topic property | Type | Default | Accepted values |
|----------------|------|---------|-----------------|
| `redpanda.key.schema.id.validation` | boolean | `false` | `true` / `false` |
| `redpanda.value.schema.id.validation` | boolean | `false` | `true` / `false` |
| `redpanda.key.subject.name.strategy` | string | `TopicNameStrategy` | `TopicNameStrategy`, `RecordNameStrategy`, `TopicRecordNameStrategy` |
| `redpanda.value.subject.name.strategy` | string | `TopicNameStrategy` | `TopicNameStrategy`, `RecordNameStrategy`, `TopicRecordNameStrategy` |

Confluent-compatible aliases also exist: `confluent.key.schema.validation`,
`confluent.value.schema.validation`, `confluent.key.subject.name.strategy`,
`confluent.value.subject.name.strategy`.

The subject-name strategy here mirrors Oxla's `schema_subject` /
`schema_lookup_policy` table options: `TopicNameStrategy` matches the Oxla
default subject `<topic>-value`; `RecordNameStrategy` /
`TopicRecordNameStrategy` correspond to multi-schema topics where Oxla should
use `schema_lookup_policy='SCHEMA_ID'` to resolve per-record schema IDs.

---

## License expiration behavior (for the source cluster)

If the Redpanda cluster producing the data loses its Enterprise license
(`licensing/overview.adoc`):

| Feature | Behavior on expiration |
|---------|------------------------|
| Iceberg Topics | Topics cannot be created/modified with `redpanda.iceberg.mode`; existing tables remain queryable by Oxla |
| Tiered Storage | Topics cannot be created/modified to enable it; partitions cannot be added |
| Server-Side Schema ID Validation | Topics with validation settings cannot be created/modified |

Existing Iceberg tables stay readable from Oxla because the data files and
catalog metadata persist in object storage; only further enablement is blocked.
