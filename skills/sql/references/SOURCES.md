# Redpanda SQL (`sql`) Skill Source Map

Scope gate: the published Redpanda Cloud docs; the engine source is used only to
confirm behavior of documented surfaces, never to add undocumented ones.

The published docs live in the private `redpanda-data/cloud-docs` repo and are
served at https://docs.redpanda.com/cloud-data-platform/. Read them with
`git -C <cloud-docs clone> show origin/main:<path>` or the Redpanda-Github-Read
connector. The published statement set is exactly the files under
`modules/reference/pages/sql/sql-statements/`; list it with
`git ls-tree -r --name-only origin/main modules/reference/pages/sql/`.

## File-to-source table

All paths are in `redpanda-data/cloud-docs`.

| Skill file | Published sources |
|---|---|
| `SKILL.md` | `modules/reference/pages/sql/sql-statements/index.adoc` (read-only note, statement set), `modules/sql/pages/query-data/tables-and-views.adoc`, `modules/reference/pages/sql/sql-statements/{create-view,drop-view}.adoc`, `modules/sql/pages/get-started/sql-quickstart.adoc`, `modules/sql/pages/connect-to-sql/authenticate.adoc`, `modules/sql/pages/query-data/sql-editor.adoc`, `modules/sql/pages/manage/manage-access.adoc`, `modules/sql/pages/get-started/redpanda-sql-vs-postgresql.adoc`, `modules/reference/pages/sql/sql-statements/{copy-to,grant,revoke,create-user,alter-user,drop-user,show-tables,show-catalogs,describe,create-table}.adoc`, `modules/reference/pages/sql/sql-data-types/{index,numeric-type/numeric,numeric-type/numeric-data-type-aliases}.adoc`, `modules/reference/pages/sql/transactions.adoc`, `modules/reference/pages/sql/system-catalogs/index.adoc`, `modules/reference/partials/sql-managed-catalog-note.adoc` |
| `references/connect-and-types.md` | `modules/sql/pages/connect-to-sql/authenticate.adoc`, `modules/sql/pages/connect-to-sql/language-clients/{psycopg2,java-jdbc,php-pdo,dotnet-dapper}.adoc`, `modules/sql/pages/get-started/sql-quickstart.adoc`, `modules/reference/pages/sql/sql-data-types/**` (all type pages, incl. `time-type/time-operators.adoc`), `modules/sql/pages/get-started/redpanda-sql-vs-postgresql.adoc` |
| `references/statements.md` | `modules/reference/pages/sql/sql-statements/{index,select,create-view,drop-view,copy-to,set-show,describe,show-catalogs,show-tables,show-nodes,show-queries,show-execs,grant,revoke,create-user,alter-user,drop-user}.adoc`, `modules/reference/pages/sql/sql-clauses/**`, `modules/reference/pages/sql/sql-operators/index.adoc`, `modules/reference/pages/sql/{transactions,schema,comment-support,information-schema,system-virtual-tables}.adoc`, `modules/reference/pages/sql/system-catalogs/index.adoc`, `modules/reference/pages/sql/system-catalogs/catalogs/{pg_views,pg_class}.adoc`, `modules/sql/pages/query-data/tables-and-views.adoc`, `modules/sql/pages/manage/manage-access.adoc` |
| `references/functions-and-analytics.md` | `modules/reference/pages/sql/sql-functions/**` (every category index and function page), `modules/reference/pages/sql/sql-clauses/over-window.adoc`, `modules/reference/pages/sql/sql-data-types/{geometry,geography,uuid}.adoc`, `modules/reference/pages/sql/sql-statements/set-show.adoc` (`oxla.enable_fast_math`) |

Views (`create-view`, `drop-view`, `pg_views`, and the view half of
`modules/sql/pages/query-data/tables-and-views.adoc`) belong to this skill: a view
lives in a SQL schema, not in a catalog. The topic-backed-table half of that page
is owned by `sql-federated-queries`.

Catalog, storage, topic-mapping, and Iceberg statements (`create-redpanda-catalog`,
`create-storage`, `create-iceberg-catalog`, `create-table`, `alter-table`,
`drop-table`, and `modules/sql/pages/query-data/**`) are owned by
`sql-federated-queries`; this skill only points to it.

## Deferred to live introspection (not drift)

- Host, port, and connection string: read from the Cloud Console **How to connect**
  panel, never pinned beyond what the quickstart shows.
- Session setting values (`SHOW <option>`), result rows, and `pg_typeof` output.
- Which statements SQL Studio blocks: the published page states the block exists
  but not the list; do not enumerate it.
- `pg_views.definition` text and the set of views on a cluster: query them.

## Known inconsistencies in the published docs (do not copy into the skill)

- Many type, clause, and function pages illustrate with `CREATE TABLE (...)` plus
  `INSERT`, and the language-client pages create and insert into tables, although
  the statements index says Redpanda SQL is read-only. The skill uses
  `default_redpanda_catalog=>table` examples instead.
- `grant.adoc` now documents the table level as "a table or a view" and states
  that `INSERT`/`UPDATE`/`DELETE` on a view are accepted but have no effect. The
  skill documents the table level for views only, since a view is the sole
  object of that level a user can create. `revoke.adoc` defers the levels to
  `grant.adoc`.
- `pg_class.adoc` lists `relkind` `r` for tables and `i` for indexes, with a
  `CREATE TABLE` / `CREATE INDEX` example; those kinds come only from native
  tables and indexes, which users cannot create. The kind reported for
  topic-backed tables is not documented yet, so the skill states only `v` for a
  view.
- The `CREATE VIEW` page states that `information_schema.tables` and `psql`'s
  `\d` / `\dv` do not list views, while the information-schema page describes
  `information_schema.tables` as covering tables and views. The skill follows the
  statement page and points at `pg_views` for listing views.
- `timestamp-with-time-zone.adoc` says values are returned "exactly as stored"
  but its example output is converted to UTC; the skill follows the example and
  `timestamp-without-time-zone.adoc` (display time zone fixed to UTC).
- The window-functions index says frames are restricted to `ROWS`; the
  `over-window.adoc` clause page and the function pages document `ROWS` and
  `RANGE`. The skill follows the clause page.
- `has-database-privilege.adoc` examples use a database named `redpanda`, while
  `grant.adoc` says the single database is `oxla`.

## Usage

Before changing a claim, re-read the cited page at `origin/main`. Add a statement,
function, type, or option only when a published page documents it; if a needed
behavior is only in engine source, leave it out or flag it as a TODO for human
review.
