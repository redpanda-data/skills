# Redpanda SQL (`sql`) Skill Source Map

Scope gate: what a Redpanda Cloud user can do with the Redpanda SQL engine that Cloud runs.
The thin `SKILL.md` restates nothing the published docs cover; it keeps procedures and the
facts the docs lack or state wrongly. Each claim below maps to the source that confirms it.

Engine claims are checked against `redpanda-data/oxla` at the release tag that the Cloud
install pack pins (`vars.redpanda_oxla_version` in `redpanda-data/cloudv2`
`install-pack/<version>.yml`; read the pin, do not copy it here). User-sync claims are checked
against `redpanda-data/cloudv2` at the `redpanda_oxla_api_version` the same install pack pins.
Read both private repos with the GitHub API; do not clone them.

## Claim-to-source table

| `SKILL.md` claim | Source |
|---|---|
| `catalog=>table` references, `SHOW REDPANDA TABLES`, `DESCRIBE TABLE`, unqualified `SHOW TABLES` is an error | cloud-docs `modules/reference/pages/sql/sql-statements/{show-tables,describe}.adoc` |
| Read-only engine; topics mapped through catalogs | cloud-docs `modules/reference/pages/sql/sql-statements/index.adoc` |
| Login follows the IAM role; **Organization IAM > Roles** | cloud-docs `modules/sql/pages/manage/manage-access.adoc` |
| `has_database_privilege(<user>, current_database(), 'CONNECT')` as the login check | cloudv2 `apps/redpanda-oxla-api/internal/controller/user_sync_db.go` (`queryCurrentUsersSQL`) |
| User sync owns `CONNECT` and superuser for email-named users; revokes a manual grant for a user with no SQL role; never drops users; manages only names containing `@` that hold `CONNECT` | cloudv2 `apps/redpanda-oxla-api/internal/controller/user_sync_db.go` (`queryCurrentOxlaUsersDB`, `buildUserOpSQL`), `reconcile_users.go` (`computeUserDiff`) |
| Role removal revokes only `CONNECT` and superuser; grants survive; re-assigning restores `CONNECT` on the existing user | cloudv2 `user_sync_db.go` (`opRevoke`, `applyCreateBatchWithRepair`, `repairExistingUser`) |
| `GRANT SELECT ON EXTERNAL SOURCE`, `USAGE` on schema, Kafka ACLs do not apply | cloud-docs `modules/sql/pages/manage/manage-access.adoc` |
| `REVOKE` with a pattern that matches no stored grant is an error | oxla `src/access_control/grant_revoke.cpp`; cloud-docs `manage-access.adoc` |
| Catalog-wide grant listed in `information_schema.role_table_grants` (`table_name` = catalog) | oxla `src/metastore/information_schema_role_table_grants.cpp`, `src/metastore/information_schema_role_external_relation_grants.cpp` |
| Revoking the catalog-wide grant removes per-topic grants | oxla `tests/blackbox/pit/kafka/test_redpanda_source_grants.py` (`test_revoke_metadata_grant_cascades_to_external_relation_grants`) |
| `timestamp with time zone` rendered in the session time zone after `SET TIMEZONE` | oxla `tests/blackbox/pit/timestamps/test_set_timezone.py` |
| `bytea` ordering operators, `IN`, `ORDER BY`, `GROUP BY`, `DISTINCT`, joins, `min`/`max`, `\|\|`, `substr`, `position` | oxla `tests/blackbox/pit/types/test_bytea.py` |
| `uuid` column compares with a string literal | oxla `tests/blackbox/pit/operators/test_compare_uuid.py` (`test_uuid_column_compared_with_string_literal`), `tests/blackbox/pit/join/test_uuid_join.py` |
| `GROUP BY` on an array: `could not identify an equality operator for type text[]` | oxla `tests/blackbox/pit/arrays/test_array_group_by.py` |
| Docs URLs | served at https://docs.redpanda.com/cloud-data-platform/ from cloud-docs |

## Known docs errors the skill corrects

- `sql-data-types/timestamp-with-time-zone.adoc` says a `SELECT` ignores the session time zone
  and returns values as stored.
- `sql-data-types/bytea.adoc` lists only `=` and `<>` among comparisons.
- `sql-data-types/uuid.adoc` says a `uuid` does not cast implicitly and filters with an explicit
  cast; the cast works, but comparison with a string literal also works.
- `sql-data-types/array.adoc` shows only the `ORDER BY` error for array keys.

## Checked and left out

- GCS through `AWS_CRED` with an `ENDPOINT` (HMAC keys): the docs show a `gs://` destination.
  The engine picks the provider from the credential type, not the path scheme, so a `gs://`
  path with `AWS_CRED` appears to reach the S3 client; the only test uses `s3://` (with
  `COPY FROM`). Whether `s3://` is required for `COPY TO` is unconfirmed. TODO for human review.
- `COPY TO` writes CSV only; the docs cover it, so the skill does not restate it.
