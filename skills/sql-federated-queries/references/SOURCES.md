# sql-federated-queries Skill Source Map

Scope gate: what a Redpanda Cloud user of Redpanda SQL (the managed engine on BYOC and BYOVPC
clusters) can do when querying Redpanda topics through Redpanda catalogs, including the Iceberg
history of Iceberg-enabled topics through a linked Iceberg catalog. The published Redpanda Cloud
docs are the scope gate; the engine source only confirms documented behavior.

The skill is thin and carries no "How to work" line: no procedure from the full skill passed the
test of a behavioral eval case that the baseline fails (see below). It sends the agent to the
docs for everything. Its eval suite is `evals/suites/sql-federated-queries.eval.json`.

## Docs that cover the skill

The Redpanda SQL docs are published under https://docs.redpanda.com/cloud-data-platform/ from the
private `redpanda-data/cloud-docs` repo (`platform: "cloud"` in the Docs MCP). Pages under
`modules/manage/` and `modules/reference/pages/properties/` are single-sourced from the private
`redpanda-data/docs` repo. Paths are in `redpanda-data/cloud-docs`:

- `modules/sql/pages/query-data/{redpanda-catalogs,query-streaming-topics,query-iceberg-topics,query-nested-fields,tables-and-views}.adoc`
- `modules/reference/pages/sql/sql-statements/{create,alter,drop}-table.adoc`, `refresh.adoc`,
  `{create,alter,drop}-redpanda-catalog.adoc`, `{create,alter,drop}-iceberg-catalog.adoc`,
  `{create,alter,drop}-storage.adoc`, `describe.adoc`, `show-catalogs.adoc`, `show-tables.adoc`
- `modules/reference/pages/sql/system-virtual-tables.adoc`
- `modules/manage/pages/iceberg/{about-iceberg-topics,use-iceberg-catalogs,specify-iceberg-schema}.adoc`,
  `modules/manage/pages/iceberg/rest-catalog/index.adoc`

Engine behavior is checked against the SQL engine source at the release that Redpanda Cloud
runs. Read the pinned release; do not copy it here.

## Claims in SKILL.md

| Claim | Source |
|---|---|
| Topics are mapped to tables through a Redpanda catalog; with an Iceberg REST catalog the same table also returns the Iceberg history | cloud-docs `modules/sql/pages/query-data/{redpanda-catalogs,query-iceberg-topics}.adoc` |
| Connection details come from the **SQL** tab of **How to connect** | cloud-docs `modules/sql/pages/get-started/sql-quickstart.adoc` |
| Docs URLs | served at https://docs.redpanda.com/cloud-data-platform/ from cloud-docs |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) |

## Lines removed: no failing baseline

Tested for a "How to work" line on 2026-11-10 (3 runs per arm). The baseline handled it, so the
skill carries no line for it.

- **After a REST catalog secret rotates, update the cluster-side secret, not the SQL engine's
  managed Iceberg catalog.** Redpanda Cloud writes the managed catalog's options again when the
  cluster's Iceberg configuration changes. Case `rotated-catalog-secret-fixed-on-cluster`:
  baseline 3/3, skill 3/3, installed 3/3 (rerun after the case fix below, eval archive run folder
  `sql-federated-queries`, 2026-11-10). Not kept as a safety guardrail: changing a managed
  catalog is overwritten on the next sync and loses no data. Source: cloud-docs
  `modules/reference/pages/sql/sql-statements/{alter-iceberg-catalog,alter-redpanda-catalog}.adoc`
  (warnings); rpk `src/go/rpk/pkg/cli/security/secret/update.go` in `redpanda-data/redpanda`.

The full skill's facts (managed catalogs, `CREATE TABLE` options, metadata columns, decoding,
`REFRESH`, Iceberg mode matching and type limits, system tables, Iceberg Topics properties) were
sampled in 13 fact cases. The docs arm passed every one 3/3 (2026-11-10), so none is carried.

## Corrections after the eval run

- `rotated-catalog-secret-fixed-on-cluster` rejected legitimate commands: its mocks did not match a
  secret name in double quotes, and its expected call did not match a secret value in double
  quotes. Both now accept quoted arguments. The rerun did not change the verdict: the baseline
  still passes, so no line is kept.

## Docs gaps reported (not skill claims; do not re-verify here)

- `DESCRIBE REDPANDA CATALOG` output. `modules/reference/pages/sql/sql-statements/describe.adoc`
  (https://docs.redpanda.com/cloud-data-platform/reference/sql/sql-statements/describe/) says it
  lists the catalog's tables and topic mappings and shows `table_name` and `topic_name` columns.
  The engine runs `SELECT * FROM system.kafka_connections` for the named catalog, so it returns
  the connection row, including the linked `iceberg_catalog`. Source: the SQL
  engine's query planner (`SHOW_KAFKA_CATALOG`) at the pinned release.
  `redpanda-catalogs.adoc` correctly says the statement shows the linked catalog, but the docs
  arm could not say which column holds it.

