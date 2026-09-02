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
| `references/kafka-catalogs.md` | `src/catalog/kafka/conversions.cpp`, `src/sqlparser/sql/CreateStatement.h`, `AlterKafkaCatalogStatement.h`, `connection_option_names.h`, `src/kafka/types.h`, `src/kafka/metadata_columns.h`, `src/kafka/decoders/schema_lookup_policy.h`, `src/kafka/decoders/logical_types.h`, `src/external_schema/avro/avro_sql_mapping.cpp` (Avro logical→SQL type map; `uuid` on either `string` or `fixed(16)` backing → `SQL_UUID`), `src/external_schema/protobuf/protobuf_sql_mapping.h`, `src/external_schema/json/`, `tests/MT/query_planner/cases/predefined_transparent_kafka_iceberg_*/`. **Map columns**: `src/external_schema/avro/avro_user_type_builder.cpp` (`buildNode` — an `AVRO_MAP` leaf becomes a map node under `StructMappingPolicy::Compound`, with the key tag from the map's key leaf and the value built recursively (nullable-union unwrap, arrays, records); under `Json` it collapses to the `RecordAsJson` sentinel, i.e. one json column), `src/external_schema/avro/avro_sql_mapping.cpp` (`AvroLogicalType::Map` is not a scalar — maps never reach the scalar mapper), `src/external_schema/protobuf/protobuf_user_type_builder.cpp` (`field.is_map()` — key from the synthetic `*Entry` message's `map_key()`, value from `map_value()`; a non-COMPOUND policy emits one json column), `src/catalog/stored_schema_resolver.cpp` (`resolveMapNode` — the alias-tagged array-of-entry-composites shape, validated via `checkValid`), `src/query_planner/visitors/transparent_query_expansion.cpp` + `src/query_planner/visitors/plan_generator/select/cast.cpp` (map columns unify across the two legs of a transparent source; map casts exist only inside that expansion). Behavior goldens: `tests/blackbox/pit/kafka/test_redpanda_integration_avro.py` and `test_redpanda_integration_proto.py` (`test_queries_compound_map_columns` — the resolved types per format, record-/array-valued hits, empty maps, duplicate-key entry lists), `tests/blackbox/pit/kafka/test_transparent_kafka_iceberg.py` (map columns through all three legs), `tests/blackbox/kafka_protos/map_types.proto`. **Metadata-predicate read pruning**: `src/query_planner/visitors/kafka_offset_pruner.{h,cpp}` (`resolveAndPublishBounds` — batched parallel broker timequeries for a `(redpanda).timestamp` bound; a resolution failure degrades the scans to reading without timestamp bounds, keeps offset/partition pruning, and logs a warning with the query ID) |
| `references/iceberg.md` | `src/sqlparser/sql/CreateCatalogStatement.h`, `connection_option_names.h`, `src/catalog/iceberg_catalog_parser.cpp`, `src/iceberg_client/rest_catalog_config.h`, `src/iceberg_client/apache_iceberg_client/apache_iceberg_client.h`, `src/metastore/system_iceberg_catalogs.cpp`, `src/metastore/system_iceberg_tables.cpp`, `tests/MT/query_planner/cases/predefined_iceberg_*/`. **Iceberg table/namespace DDL** (`CREATE/DROP TABLE`, `CREATE/DROP NAMESPACE`, `PARTITION BY`, `PURGE`, SQL→Iceberg type mapping): `src/sqlparser/bison_parser/bison_parser.y` (`create_namespace_statement`, `create_table_body`, `iceberg_partition_term`, `drop_statement` `DROP_EXTERNAL_TABLE`/`DROP_NAMESPACE`, `opt_purge`/`opt_drop_behavior`), `src/sqlparser/sql/{CreateStatement.h,DropStatement.h,PartitionTerm.h}`, `src/external_schema/iceberg/iceberg_schema_builder.cpp` (type mapping + `IcebergSchemaIncompatible` rejections), `src/catalog/catalog_manager_scheduler.cpp`, `tests/blackbox/pit/iceberg/test_iceberg_ddl.py` (authoritative behavior golden). **`map` columns**: `src/db/iceberg_table.cpp` (`fieldTypeToLogicalColumn`'s map arm — key and value converted by the same field rules, lowered to the array-of-entries shape and tagged `TypeAlias::Kind::Map`, with `checkValid` turning an unrepresentable shape into an `IcebergSchemaIncompatible` error), `tests/UT/iceberg_client/to_logical_schema_test.cpp`, `tests/blackbox/pit/iceberg/test_iceberg_maps.py` (`pg_typeof` → `map(text,bigint)`, whole-map text form, last-duplicate/tombstone/revive lookup over a hand-seeded Parquet entry list). **Commit conflicts / SQLSTATE `40001`**: `src/error/proto/error.proto` + `src/error/error.cpp` (`IcebergCommitIsConflicting` and its message), `src/iceberg_client/apache_iceberg_client/error_translator.h` (which iceberg-cpp error kinds map to it), `src/iceberg_client/client.h` (retry-then-conflict contract), `src/net/postgres/session.cpp` (→ `SerializationFailure`, i.e. SQLSTATE `40001`, for SQL clients), `tests/UT/iceberg_client/error_translator_test.cpp` |
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
