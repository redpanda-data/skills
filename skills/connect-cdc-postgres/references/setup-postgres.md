# Setting Up PostgreSQL for Logical Replication (postgres_cdc)

This reference covers all the PostgreSQL-side prerequisites for the `postgres_cdc` Redpanda Connect input. Ground truth: `internal/impl/postgresql/pglogicalstream/logical_stream.go` and `pglogrepl.go`.

## PostgreSQL Version

PostgreSQL 10 or later is required (logical replication via `pgoutput` was introduced in PostgreSQL 10). The connector detects the server version at startup and enables the `messages` option for PostgreSQL 15+.

## Step 1: Set `wal_level = logical`

Logical replication requires the WAL to include enough information to reconstruct row changes. The default `wal_level` is `replica`; you must change it to `logical`.

```sql
-- Check current value
SHOW wal_level;

-- Set it (requires superuser, requires server restart)
ALTER SYSTEM SET wal_level = logical;
```

Then restart PostgreSQL. Verify after restart:

```bash
psql -U postgres -c "SHOW wal_level;"
# Should print: logical
```

**Note**: On managed services (RDS, Aurora, Cloud SQL, etc.) set `wal_level = logical` in the parameter group and reboot the instance.

## Step 2: Set Replication Slot and WAL Sender Limits

Ensure PostgreSQL has enough replication slot and WAL sender capacity:

```sql
-- Current limits
SHOW max_replication_slots;   -- default 10, must be >= number of CDC pipelines
SHOW max_wal_senders;         -- default 10, must be >= max_replication_slots

-- Increase if needed (requires restart)
ALTER SYSTEM SET max_replication_slots = 20;
ALTER SYSTEM SET max_wal_senders = 20;
```

## Step 3: Create a Replication User

The CDC user needs the `REPLICATION` attribute. Grant only the minimum required privileges.

```sql
-- Create user with REPLICATION attribute
CREATE USER cdc_user WITH REPLICATION LOGIN PASSWORD 'your-password';

-- Grant connection to the target database
GRANT CONNECT ON DATABASE mydb TO cdc_user;

-- Grant SELECT on the tables being replicated
GRANT SELECT ON TABLE public.orders TO cdc_user;
GRANT SELECT ON TABLE public.customers TO cdc_user;

-- Or grant SELECT on all tables in a schema (broader but simpler)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cdc_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT TO cdc_user;
```

The `REPLICATION` attribute allows the user to:
- Initiate replication connections (required)
- Create replication slots (unless `slot_name` references a pre-created slot)
- Create publications (unless pre-created — see Step 4)

## Step 4: Create Publication (Optional but Recommended)

The connector creates a publication named `pglog_stream_<slot_name>` automatically. To avoid granting `CREATE PUBLICATION` to the replication user, pre-create it:

```sql
-- For specific tables (recommended — principle of least privilege)
CREATE PUBLICATION pglog_stream_my_cdc_slot
  FOR TABLE public.orders, public.customers;

-- For all tables in the database
CREATE PUBLICATION pglog_stream_my_cdc_slot FOR ALL TABLES;

-- Verify
SELECT pubname, puballtables, pubinsert, pubupdate, pubdelete
FROM pg_publication
WHERE pubname = 'pglog_stream_my_cdc_slot';
```

The connector manages the publication after creation (adds/removes tables as the `tables` config changes).

## Step 5: Create Replication Slot (Optional)

The connector creates the replication slot automatically. To pre-create it:

```sql
-- Creates slot named 'my_cdc_slot' using the pgoutput plugin
SELECT pg_create_logical_replication_slot('my_cdc_slot', 'pgoutput');

-- Verify
SELECT slot_name, plugin, slot_type, active, confirmed_flush_lsn
FROM pg_replication_slots
WHERE slot_name = 'my_cdc_slot';
```

The connector uses the `pgoutput` logical decoding plugin (built into PostgreSQL 10+; no extension needed).

## Step 6: Verify Connectivity

```bash
# Test as the replication user
psql "postgres://cdc_user:your-password@localhost:5432/mydb?sslmode=disable" \
  -c "SELECT version();"

# Test replication connection explicitly
psql "postgres://cdc_user:your-password@localhost:5432/mydb?replication=database" \
  -c "IDENTIFY_SYSTEM;"
```

## REPLICA IDENTITY and TOAST Columns

PostgreSQL's `REPLICA IDENTITY` setting controls how much data is included in the WAL for `UPDATE` and `DELETE` operations.

| REPLICA IDENTITY | UPDATE includes | DELETE includes |
|---|---|---|
| `DEFAULT` (default) | New row: all column values; old row: primary-key columns only (used to locate the row) | Primary-key columns of deleted row |
| `FULL` | All column values (old + new) | All column values |
| `NOTHING` | Nothing | Nothing |
| `USING INDEX` | Indexed column values | Indexed column values |

For `UPDATE`/`DELETE` when `REPLICA IDENTITY` is not `FULL`, unchanged TOAST columns are omitted from the WAL. Set `unchanged_toast_value` in the connector config to a sentinel string to identify these cases.

To get full row data on every change:

```sql
ALTER TABLE public.orders REPLICA IDENTITY FULL;
```

## RDS and Aurora PostgreSQL

### Parameter Group

Set in the RDS parameter group (requires instance reboot):

```
rds.logical_replication = 1
```

This automatically sets `wal_level = logical` and `max_replication_slots` / `max_wal_senders` to at least 10.

### IAM Authentication (RDS/Aurora)

To use AWS IAM authentication instead of a static password:

**1. Enable IAM auth on the RDS instance:**

```bash
aws rds modify-db-instance \
  --db-instance-identifier mydb \
  --enable-iam-database-authentication \
  --apply-immediately
```

**2. Create the database user with the rds_iam role:**

```sql
CREATE USER cdc_user WITH LOGIN;
GRANT rds_iam TO cdc_user;
GRANT rds_replication TO cdc_user;
GRANT SELECT ON TABLE public.orders TO cdc_user;
```

**3. Grant the IAM principal permission to generate auth tokens:**

```json
{
  "Effect": "Allow",
  "Action": ["rds-db:connect"],
  "Resource": ["arn:aws:rds-db:us-east-1:123456789012:dbuser:db-ABCDEFGHIJKL01234/cdc_user"]
}
```

**4. Configure the connector:**

```yaml
input:
  postgres_cdc:
    dsn: postgres://cdc_user@mydb.abc123.us-east-1.rds.amazonaws.com:5432/mydb
    schema: public
    tables:
      - orders
    slot_name: my_cdc_slot
    aws:
      enabled: true
      region: us-east-1
      endpoint: mydb.abc123.us-east-1.rds.amazonaws.com
      # Credentials from EC2 instance role / ECS task role / environment (no id/secret needed)
```

The connector generates a new IAM authentication token at connect time and refreshes it on reconnect.

## Monitoring Replication Lag

Monitor slot health with these queries:

```sql
-- WAL lag in bytes for each slot
SELECT
  slot_name,
  pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) AS lag_bytes,
  active,
  confirmed_flush_lsn
FROM pg_replication_slots;

-- Active connections using the slot
SELECT pid, usename, application_name, state, sent_lsn, write_lsn, flush_lsn, replay_lsn
FROM pg_stat_replication;
```

The connector also exposes Prometheus metrics:
- `postgres_snapshot_progress{table=...}`: Fraction of snapshot complete per table (0.0–1.0)
- `postgres_replication_lag_bytes`: Replication lag in bytes from the WAL monitor

## Dropping a Replication Slot

If you permanently remove a pipeline, drop its slot to allow WAL reclamation:

```sql
SELECT pg_drop_replication_slot('my_cdc_slot');
```

If the slot is active (pipeline is running), stop the pipeline first.

## Minimal Privilege Summary

| Privilege | Required For |
|---|---|
| `REPLICATION LOGIN` | Initiating replication connections |
| `CONNECT` on database | Connecting to the database |
| `SELECT` on each table | Snapshot phase and WAL decoding |
| `CREATE PUBLICATION` | Auto-creating the publication (skip by pre-creating) |
| `CREATE REPLICATION SLOT` | Auto-creating the slot (skip by pre-creating) |
