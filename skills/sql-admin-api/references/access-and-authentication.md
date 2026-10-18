Source: cloud-docs `modules/sql/pages/connect-to-sql/authenticate.adoc`, `modules/sql/pages/manage/manage-access.adoc`, `modules/reference/pages/sql/sql-statements/alter-user.adoc` (Cloud user sync note), `modules/sql/pages/get-started/deploy-sql-cluster.adoc` (bearer-token connect), `modules/get-started/pages/cluster-overview.adoc` (How to connect panel). Verified 2026-10-18. File-by-file mapping in [SOURCES.md](SOURCES.md).

# Redpanda SQL: Authentication and Access

Published guides:
- [Authenticate to Redpanda SQL](https://docs.redpanda.com/cloud-data-platform/sql/connect-to-sql/authenticate/)
- [Manage access to Redpanda SQL](https://docs.redpanda.com/cloud-data-platform/sql/manage/manage-access/)

Redpanda Cloud preconfigures the SQL engine's OIDC settings when SQL is enabled. Users do not configure an identity provider, TLS, or password policy for the engine. It accepts bearer tokens minted by Redpanda Cloud, whether the user signs in to Cloud with email and password or with SSO.

---

## Connection details

Find the host and port on the cluster overview, in the *How to connect* panel, on the *SQL* tab. This tab appears only when Redpanda SQL is enabled. With Terraform, `redpanda_cluster.<name>.rpsql.url` holds the endpoint. On private clusters, including all BYOVPC clusters, the endpoint is private, so connect from inside the connected network. The published examples use `dbname=oxla`.

**TLS is mandatory.** The SQL endpoint on BYOC rejects connections without TLS. Always set `sslmode=require`, because every auth mode sends its credential in the password field.

---

## Authentication modes

The connection-string `options` parameter selects the mode:

| Mode | `options` | `user=` | Password field | Use for |
|------|-----------|---------|----------------|---------|
| Bearer token | `auth_method=bearer` | ignored | JWT from Redpanda Cloud | Humans |
| Client credentials | `auth_method=client_secret` | service account client ID | client secret | Jobs, BI tools, services |
| SCRAM | (omit `options`) | Cloud account or service-account email | password set with `ALTER USER` | Legacy clients without OIDC support |

If you put a bearer token in the password field without `auth_method=bearer`, the engine treats it as a SCRAM password and the connection fails.

### Bearer token

```bash
rpk cloud login
PGPASSWORD=$(rpk cloud auth token) \
  psql "host=<sql-host> port=<sql-port> dbname=oxla user=ignored options='auth_method=bearer' sslmode=require"
```

The session identity comes from the token's principal claim, so `SELECT current_user` returns that principal, not `ignored`. This needs a recent `rpk` and `psql`: the quickstart gives the minimum versions.

```python
import os, psycopg2
conn = psycopg2.connect(
    host="<sql-host>", port=<sql-port>, dbname="oxla",
    user="ignored", password=os.environ["BEARER_TOKEN"],   # export BEARER_TOKEN=$(rpk cloud auth token)
    options="auth_method=bearer", sslmode="require",
)
```

### Client credentials

```bash
PGPASSWORD="$CLIENT_SECRET" \
  psql "host=<sql-host> port=<sql-port> dbname=oxla user=<client-id> options='auth_method=client_secret' sslmode=require"
```

Redpanda SQL exchanges the Redpanda Cloud service account's client ID and secret for a token at Redpanda Cloud's token endpoint. The resolved principal becomes the session identity.

### SCRAM for legacy clients

Auto-provisioned users get an internal password that you never see. To let a legacy client sign in:

1. Create or choose a Redpanda Cloud service account and assign it a role with *SQL: Access* (or *SQL: Manage*). Cloud provisions the user in the engine.
2. As a *SQL: Manage* user, set a known password. The username is the service account's email:
   ```sql
   ALTER USER "service-account@example.com" WITH PASSWORD 'shared_secret';
   ```
3. Connect without `auth_method`:
   ```bash
   PGPASSWORD='shared_secret' \
     psql "host=<sql-host> port=<sql-port> dbname=oxla user=service-account@example.com sslmode=require"
   ```

The password survives cluster operations: Cloud's user reconciler never resets it. If the account loses its *SQL: Access* or *SQL: Manage* role, the reconciler revokes `CONNECT` and the client can no longer sign in.

### Token expiry

Bearer tokens are short-lived. The engine validates a token once, at connect time. An open session keeps running after the token expires, but new connections need a fresh token, so run `rpk cloud auth token` again and reconnect.

---

## Access model

### Cloud roles provision SQL users

Assign roles in *Organization IAM* > *Roles*. SQL permissions are on the *Data Plane* tab when you create or edit a role. See [Configure RBAC in the Data Plane](https://docs.redpanda.com/cloud-data-platform/security/authorization/rbac/rbac_dp/).

| Permission | In the SQL engine |
|------------|-------------------|
| *SQL: Manage* | Superuser. Reads every topic, creates catalogs and tables, and grants access to others. |
| *SQL: Access* | Regular user. Can connect, but reads only what it owns or has been granted. Owns nothing by default. |

Assigning either permission provisions a matching SQL user automatically, so no `CREATE USER` is needed. The SQL user identifier is the email on the Redpanda Cloud account or service account. Viewing SQL connection details and creating catalogs, tables, and grants requires cluster admin access in the Console or *SQL: Manage*.

Manage superuser status through these Cloud roles, not with `ALTER USER ... SUPERUSER` / `NOSUPERUSER`. Cloud synchronizes SQL users from Organization IAM and can revert attribute changes that do not match the role assignment. Setting a password with `ALTER USER ... WITH PASSWORD` is the supported exception (see [SCRAM for legacy clients](#scram-for-legacy-clients)).

### Kafka ACLs do not gate queries

Every query reaches the underlying topics through one internal SASL credential, associated with the default Redpanda catalog `default_redpanda_catalog`, no matter which SQL user runs the query. This credential is created automatically when SQL is enabled and is not a user-facing role.

- **Kafka ACLs do not limit what a SQL user can read.**
- **`GRANT` and `REVOKE` inside Redpanda SQL are the access boundary.**

When a user asks "how do I stop user X from reading topic Y through SQL", the answer is a SQL `REVOKE` or not granting the topic in the first place. Changing Kafka ACLs does not help.

### Grants

A *SQL: Manage* user gives *SQL: Access* users `SELECT` on a topic, a topic pattern (with `*` only at the end), or a whole catalog. For example: `GRANT SELECT ON EXTERNAL SOURCE default_redpanda_catalog => 'orders' TO "alice@example.com";`. Behavior to know:

- `SELECT` is the only privilege that has any effect on a Redpanda catalog. `GRANT ALL PRIVILEGES` on a catalog resolves to `SELECT`.
- `REVOKE ... => 'pattern'` errors if the pattern matches no existing grant. The catalog-level `REVOKE` (no pattern) is idempotent, so it is safe in cleanup scripts.
- Schema privileges are separate. `USAGE` on the schema (`public` by default) is needed to see catalogs in `SHOW CATALOGS` and `system.catalogs` and to reference objects by name. `CREATE` on the schema lets a non-superuser run `CREATE REDPANDA CATALOG` or `CREATE STORAGE` there.

Full `GRANT` / `REVOKE` / `ALTER USER` syntax: `/redpanda:sql`. Catalog and table mapping: `/redpanda:sql-federated-queries`.

### Inspect grants

```sql
-- Which roles have grants on which catalogs and relations
SELECT * FROM information_schema.role_external_relation_grants;

-- Catalog-level grants also appear here, with table_name = the catalog name
SELECT * FROM information_schema.role_table_grants;
```

Disabling Redpanda SQL clears all roles and grants, and re-enabling does not restore them. Export these results before you disable if you plan to rebuild.
