# sql-federated-queries Skill Source Map

Maps each file in `skills/sql-federated-queries/` to the source paths it derives from, so
future syncs and human maintainers know exactly where to verify claims.

This skill documents **Oxla** (Redpanda's SQL query engine) querying external data — Kafka
topic catalogs, Apache Iceberg REST catalogs, and object-store parquet/ORC/CSV files. The
Oxla engine is C++ in the **PRIVATE** repo `redpanda-data/oxla`; read it **only** via the
Redpanda-Github-Read MCP connector (`get_file_contents`, `search_code`) — never `gh`, never
clone. The one exception is `redpanda-iceberg-source-config.md`, which documents the
**Redpanda producer side** (the Iceberg tables/Tiered-Storage/validated schemas Oxla reads):
its grounding is the **public** repos `redpanda-data/redpanda` (`src/v/datalake/`, `iceberg_*`
cluster properties in `src/v/config/`) and `redpanda-data/docs` (Iceberg + licensing pages).
Before writing or changing any fact, re-open the cited source and confirm exact SQL keywords,
option names, proto field names, and property keys.

All Oxla paths below were verified to exist via the connector (`redpanda-data/oxla`, default
branch); all redpanda/docs paths against `redpanda-data/redpanda` and `redpanda-data/docs`.

## File-to-source table

| Skill file | Source paths (all `redpanda-data/oxla` unless noted) |
|---|---|
| `SKILL.md` | Aggregates all reference sources below. Grammar/keywords: `src/sqlparser/bison_parser/bison_parser.y`, `src/sqlparser/sql/connection_option_names.h`, `src/sqlparser/sql/CreateStatement.h`, `CreateCatalogStatement.h`, `AlterKafkaCatalogStatement.h`, `AlterKafkaTableStatement.h`, `RefreshStatement.h`, `ImportStatement.h`. Metastore system tables: `src/metastore/system_{kafka_connections,kafka_sources,iceberg_catalogs,iceberg_tables}.cpp`, `metastore.cpp`. Enterprise/producer section grounded in `redpanda-data/redpanda` + `redpanda-data/docs` (see last row). |
| `references/kafka-catalogs.md` | `src/catalog/kafka/conversions.cpp`, `src/sqlparser/sql/CreateStatement.h`, `AlterKafkaCatalogStatement.h`, `connection_option_names.h`, `src/kafka/types.h`, `src/kafka/metadata_columns.h`, `src/kafka/decoders/schema_lookup_policy.h`, `src/kafka/decoders/logical_types.h`, `src/external_schema/protobuf/protobuf_sql_mapping.h`, `src/external_schema/json/`, `tests/MT/query_planner/cases/predefined_transparent_kafka_iceberg_*/` |
| `references/iceberg.md` | `src/sqlparser/sql/CreateCatalogStatement.h`, `connection_option_names.h`, `src/catalog/iceberg_catalog_parser.cpp`, `src/iceberg_client/rest_catalog_config.h`, `src/iceberg_client/apache_iceberg_client/apache_iceberg_client.h`, `src/metastore/system_iceberg_catalogs.cpp`, `src/metastore/system_iceberg_tables.cpp`, `tests/MT/query_planner/cases/predefined_iceberg_*/` |
| `references/files-and-system-tables.md` | `src/filesystem/path/protocol.{h,cpp}`, `src/filesystem/proto/credentials.proto`, `src/filesystem/providers/{s3,gcs,azure}/proto/credentials.proto`, `src/sqlparser/sql/connection_option_names.h` (storage namespace), `src/sqlparser/bison_parser/bison_parser.y` (`AWS_CRED`/`GCS_CRED`/`AZURE_CRED` import options), `src/metastore/system_{kafka_connections,kafka_sources,iceberg_catalogs,iceberg_tables}.cpp`, `src/metastore/metastore.cpp` (`createSystemTables`), `tests/UT/query_planner/cases/copy_from/`, `copy_to/` |
| `references/redpanda-iceberg-source-config.md` | **`redpanda-data/redpanda`:** `src/v/datalake/` (producer side — `partition_spec_parser.cc`, `record_schema_resolver.cc`, `table_definition.cc`, `schema_registry.cc`), `iceberg_*` cluster properties in `src/v/config/configuration.{cc,h}` (`iceberg_catalog_type`, `iceberg_rest_catalog_endpoint`, `iceberg_rest_catalog_*`), `src/v/config/validators.{h,cc}`. **`redpanda-data/docs`:** `modules/manage/pages/iceberg/about-iceberg-topics.adoc`, `use-iceberg-catalogs.adoc`, `modules/reference/partials/properties/topic-properties.adoc` (auto-generated), `modules/reference/attachments/redpanda-properties-v26.1.10.json` (see TODO — skill cites v26.1.8), `modules/get-started/pages/licensing/overview.adoc`, `disable-enterprise-features.adoc` |

## Deferred to live introspection (NOT drift — do not pin or hardcode)

- **External catalog contents** — namespaces/tables in a live Iceberg REST catalog, and topics on a Kafka/Redpanda broker. Discovered at runtime via `ApacheIcebergClient` + the Schema Registry; inspect via `system.iceberg_tables` / `system.kafka_sources` after `REFRESH`.
- **Runtime query results** — row counts, `system.*` contents, partition-pruning plans.
- **Version-specific defaults / accepted values** for Redpanda cluster/topic properties (`redpanda.iceberg.*`, `iceberg_rest_catalog_*`, schema-validation knobs) — broker config, not Oxla; docs property partials + `configuration.cc` are the citation of record and move with the release.
- **Oxla deployment config** — `network.postgresql.port` (conventional 5432) is set at deploy time.

## TODO / re-verify

- **Attachment version drift**: `redpanda-iceberg-source-config.md` cites `modules/reference/attachments/redpanda-properties-v26.1.8.json`, but the file present in `redpanda-data/docs` is now `redpanda-properties-v26.1.10.json`. Update the citation (or drop the version pin).
- **`topic-properties.adoc` is auto-generated** (>55 KB). Upstream source of truth for `redpanda.iceberg.*` / schema-validation topic properties is `redpanda-data/redpanda` (`src/v/config/configuration.cc`, `src/v/datalake/`). Per-property defaults not each line-verified this pass.
- **Oxla PostgreSQL wire / `network.postgresql.port`** (SKILL quickstart) not verified against an Oxla config source path this pass — locate/cite the Oxla network-config definition or mark as deploy-time config.
- **Oxla is on the private repo's default branch, unversioned here** — if Oxla adopts release tags, re-verify against the shipped tag.
- Individual SQL option **defaults and accepted-value enums** (e.g. `struct_mapping_policy` `FLATTEN`/`VARIANT` "parsed but rejected", `schema_lookup_policy` naming) come from `conversions.cpp` / `schema_lookup_policy.h` / the metastore `.cpp` files — re-open and confirm exact string literals before editing.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm every claim
still matches. Read Oxla sources **only** through the Redpanda-Github-Read connector (`redpanda-data/oxla`
is private). For `redpanda-iceberg-source-config.md`, verify producer-side facts against
`redpanda-data/redpanda` (`src/v/datalake/`, `src/v/config/configuration.cc`) and the
`redpanda-data/docs` Iceberg + licensing pages. Re-confirm exact SQL keywords, option names, proto
field names, and property keys before writing any new fact.
