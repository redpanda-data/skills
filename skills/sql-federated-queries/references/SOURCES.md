# sql-federated-queries Skill Source Map

Maps each file in `skills/sql-federated-queries/` to the published Redpanda Cloud docs it
derives from. The skill serves Redpanda Cloud users of Redpanda SQL (the managed engine on
BYOC and BYOVPC clusters): querying Redpanda topics through Redpanda catalogs, including the
Iceberg history of Iceberg-enabled topics through a linked Iceberg catalog.

**Scope gate: the published Redpanda Cloud docs; the engine source is used only to confirm
behavior of documented surfaces, never to add undocumented ones.** Anything a user cannot
reach on the managed engine (operator settings, gated features, self-hosted deployment,
direct reads or writes against an Iceberg catalog's own tables) stays out of the skill.

Read the docs from the private `redpanda-data/cloud-docs` repo at `origin/main`
(`git -C <cloud-docs> show origin/main:<path>`) or the live site
(https://docs.redpanda.com/cloud-data-platform/). Pages under `modules/manage/` and
`modules/reference/pages/properties/` are single-sourced from the private
`redpanda-data/docs` repo; read the included source there and keep only the
`ifdef::env-cloud[]` branches and the `redpanda-cloud`-tagged properties.

Verified 2026-10-27.

## File-to-source table

All paths are in `redpanda-data/cloud-docs` unless noted.

| Skill file | Published source paths |
|---|---|
| `SKILL.md` | `modules/sql/pages/query-data/{redpanda-catalogs,query-streaming-topics,query-iceberg-topics,query-nested-fields,tables-and-views}.adoc` (the topic-backed-table half of `tables-and-views`; views belong to `/redpanda:sql`), `modules/reference/partials/sql-managed-catalog-note.adoc`, `modules/reference/pages/sql/sql-statements/{index,create-table,alter-table,drop-table,refresh,describe,show-catalogs,show-tables}.adoc`, `modules/reference/pages/sql/system-virtual-tables.adoc`, `modules/sql/pages/manage/manage-access.adoc`, `modules/sql/pages/get-started/sql-quickstart.adoc` (connection panel) |
| `references/redpanda-catalogs.md` | `modules/reference/pages/sql/sql-statements/{create,alter,drop}-redpanda-catalog.adoc`, `{create,alter,drop}-table.adoc`, `refresh.adoc`, `modules/sql/pages/query-data/{redpanda-catalogs,query-streaming-topics,query-nested-fields,query-iceberg-topics}.adoc`, `modules/reference/partials/sql-managed-catalog-note.adoc`, `modules/sql/pages/manage/manage-access.adoc`, `modules/reference/pages/sql/sql-data-types/{row,map,uuid,bytea,numeric-type/numeric}.adoc` |
| `references/iceberg.md` | `modules/sql/pages/query-data/{query-iceberg-topics,redpanda-catalogs,query-nested-fields}.adoc`, `modules/reference/pages/sql/sql-statements/refresh.adoc`, `modules/reference/partials/sql-managed-catalog-note.adoc`, `modules/reference/pages/sql/sql-statements/{create,alter,drop}-iceberg-catalog.adoc`, `{create,alter,drop}-storage.adoc`, `alter-redpanda-catalog.adoc`, `create-table.adoc`, `describe.adoc`, `modules/reference/pages/sql/sql-data-types/{map,uuid,numeric-type/numeric}.adoc` |
| `references/files-and-system-tables.md` | `modules/reference/pages/sql/system-virtual-tables.adoc` (catalog-metadata tables only: `system.catalogs`, `system.kafka_connections`, `system.kafka_sources`, `system.iceberg_catalogs`, `system.iceberg_tables`), `modules/reference/pages/sql/sql-statements/{show-catalogs,show-tables,describe,copy-to,index}.adoc`, `modules/sql/pages/manage/manage-access.adoc` |
| `references/redpanda-iceberg-source-config.md` | `modules/manage/pages/iceberg/{about-iceberg-topics,use-iceberg-catalogs,specify-iceberg-schema}.adoc`, `modules/manage/pages/iceberg/rest-catalog/index.adoc`, `modules/manage/pages/schema-reg/schema-id-validation.adoc`, `modules/reference/pages/properties/{cluster-properties,topic-properties}.adoc`, `modules/sql/pages/query-data/query-iceberg-topics.adoc`. Single-sourced content: `redpanda-data/docs` `modules/manage/pages/iceberg/*.adoc`, `modules/manage/pages/schema-reg/schema-id-validation.adoc`, `modules/reference/partials/properties/{cluster-properties,topic-properties}.adoc` (Cloud view only) |

## Deferred to live introspection (not drift)

- Names of the managed storage connection and Iceberg catalog: read from
  `system.kafka_connections.iceberg_catalog`, `SHOW ICEBERG CATALOGS`, `DESCRIBE`.
- Topic and table contents, catalog contents, `system.*` rows.
- Cluster and topic property defaults: the Cloud Console and Cloud property references.
- Supported cloud providers and REST catalog providers: the published pages.
- The connection options that `ALTER REDPANDA CATALOG ... RESET` accepts beyond the
  ones `create-redpanda-catalog.adoc` documents: the skill resets only documented
  options, and `DESCRIBE REDPANDA CATALOG` shows what a catalog currently has.
- Which schema holds the managed catalog connections: read it from `DESCRIBE`.

## Open questions for human review

- `system-virtual-tables.adoc` says Iceberg schemas are auto-loaded "when you `CREATE TABLE`
  against an Iceberg catalog", while `create-table.adoc` requires a Redpanda catalog and
  `create-iceberg-catalog.adoc` says standalone Iceberg querying is not supported. The skill
  says only "automatically when the table is created".
- The managed Iceberg catalog is named `default_iceberg_catalog` in
  `create-iceberg-catalog.adoc` but shown as `lakehouse_catalog` / `iceberg_storage` in
  `query-iceberg-topics.adoc`. The skill avoids hardcoding either name.
- `alter-redpanda-catalog.adoc` dropped its "Relink to a different Iceberg catalog"
  example on 2026-10-23 but kept `USING CATALOG <name>` in the syntax, described as
  linking to an existing Iceberg catalog. The skill still says a relink is done by
  running `USING CATALOG <other>` again; re-check whether the removal was meant to
  withdraw that.
- `copy-to.adoc` examples write to server-side paths (`'/path/to/...'`); on the managed engine
  the useful targets are `STDOUT` and cloud storage. The skill keeps the documented syntax and
  examples only for `STDOUT`, S3, and GCS.
