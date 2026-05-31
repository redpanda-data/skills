# Setup: Google Cloud Spanner for CDC

This reference covers everything you need to prepare a Spanner database before
connecting the `gcp_spanner_cdc` input.

---

## 1. Create a Change Stream

A Spanner **change stream** tracks mutations (INSERT, UPDATE, DELETE) on a set
of tables or columns and exposes them via a streaming API. Change streams must
be created with DDL before the connector can read from them.

### Track all tables

```sql
CREATE CHANGE STREAM AllChanges FOR ALL;
```

### Track specific tables

```sql
CREATE CHANGE STREAM OrderChanges FOR orders, customers;
```

### Track specific columns within tables

```sql
CREATE CHANGE STREAM ProfileChanges
  FOR users(email, display_name),
      settings(theme, notifications_enabled);
```

### Value capture type

Spanner change streams default to `value_capture_type = 'OLD_AND_NEW_VALUES'`,
meaning the `old_values` field in the Mod payload is populated by default for
UPDATE events.

To opt into a leaner capture that omits old values, create the stream with
`NEW_VALUES`:

```sql
CREATE CHANGE STREAM OrderChanges FOR orders
  OPTIONS (value_capture_type = 'NEW_VALUES');
```

With `NEW_VALUES`, `old_values` is always empty. Other valid types defined by
Spanner include `NEW_ROW` (full new row, no old values) and
`NEW_ROW_AND_OLD_VALUES` (full new row plus changed old values). The connector
emits whatever Spanner provides in the change record payload.

### Check stream retention

Spanner change stream data is retained for a configurable window (default 1 day,
maximum 7 days). Records older than the retention window cannot be replayed.
If the connector is down longer than the retention window, it will miss changes.

View the current retention setting:

```sql
-- GoogleSQL dialect
SELECT option_value
FROM information_schema.change_stream_options
WHERE change_stream_name = 'OrderChanges'
  AND option_name = 'retention_period';
```

Set a longer retention period:

```sql
ALTER CHANGE STREAM OrderChanges
  SET OPTIONS (retention_period = '7d');
```

---

## 2. IAM Permissions

The service account (or identity) used by the connector needs the following
Spanner permissions:

| Action | Required Role / Permission |
|--------|---------------------------|
| Read data from tables | `roles/spanner.databaseReader` |
| Read change stream | Included in `roles/spanner.databaseReader` |
| Create/validate the metadata table (every startup) | `roles/spanner.databaseAdmin` or `spanner.databases.updateDdl` |

The `roles/spanner.databaseReader` predefined role covers reading data and
querying change streams. The connector issues a `CREATE TABLE IF NOT EXISTS`
DDL call on **every startup** to create or validate the partition metadata
table. This means DDL permission (`roles/spanner.databaseAdmin` or a custom
role granting `spanner.databases.updateDdl`) must remain in place permanently.
Revoking DDL permission after the first run will cause every subsequent
restart to fail with a permission-denied error at Setup.

### Assign roles via gcloud

```bash
# Replace placeholders with your values
PROJECT=my-gcp-project
SA=redpanda-spanner-cdc@${PROJECT}.iam.gserviceaccount.com

# Grant database-level reader access
gcloud spanner databases add-iam-policy-binding my-database \
  --instance=my-spanner-instance \
  --project=${PROJECT} \
  --member="serviceAccount:${SA}" \
  --role="roles/spanner.databaseReader"

# Grant DDL permission — required permanently (connector issues DDL on every startup)
gcloud spanner databases add-iam-policy-binding my-database \
  --instance=my-spanner-instance \
  --project=${PROJECT} \
  --member="serviceAccount:${SA}" \
  --role="roles/spanner.databaseAdmin"
```

### Application Default Credentials (ADC)

If you run the connector on GCE, GKE, Cloud Run, or Cloud Functions, you can
omit `credentials_json` entirely and rely on the service account attached to
the compute resource. Ensure that service account has the IAM roles above.

```bash
# On GCE, attach the service account at instance creation or update:
gcloud compute instances set-service-account my-vm \
  --service-account=redpanda-spanner-cdc@MY_PROJECT.iam.gserviceaccount.com \
  --scopes=https://www.googleapis.com/auth/spanner.data

# On GKE, use Workload Identity:
gcloud iam service-accounts add-iam-policy-binding \
  redpanda-spanner-cdc@MY_PROJECT.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:MY_PROJECT.svc.id.goog[NAMESPACE/KSA_NAME]"
```

---

## 3. The Metadata Table

On first connect, the `gcp_spanner_cdc` connector automatically creates a
metadata table in the **same database** as the change stream. This table persists
partition state and watermarks to enable resumption after restarts.

### Default table name

```
cdc_metadata_<stream_id>
```

For example, with `stream_id: OrderChanges`, the table is named
`cdc_metadata_OrderChanges`.

Override with the `metadata_table` config field:

```yaml
metadata_table: "my_custom_metadata_table"
```

### GoogleSQL table schema (auto-created)

The connector issues `CREATE TABLE IF NOT EXISTS` (not just on first run — on
every startup), so the exact DDL shown below is re-submitted each time. The
connector also creates two secondary indexes. The full set of statements issued
is illustrated below (simplified column list — actual DDL may vary by version):

```sql
CREATE TABLE IF NOT EXISTS cdc_metadata_OrderChanges (
  PartitionToken  STRING(MAX) NOT NULL,
  ParentTokens    ARRAY<STRING(MAX)> NOT NULL,
  StartTimestamp  TIMESTAMP NOT NULL,
  EndTimestamp    TIMESTAMP NOT NULL,
  HeartbeatMillis INT64 NOT NULL,
  State           STRING(MAX) NOT NULL,
  Watermark       TIMESTAMP NOT NULL,
  CreatedAt       TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true),
  ScheduledAt     TIMESTAMP OPTIONS (allow_commit_timestamp=true),
  RunningAt       TIMESTAMP OPTIONS (allow_commit_timestamp=true),
  FinishedAt      TIMESTAMP OPTIONS (allow_commit_timestamp=true)
) PRIMARY KEY (PartitionToken),
ROW DELETION POLICY (OLDER_THAN(FinishedAt, INTERVAL 1 DAY));

-- Watermark index (STORING State) — used to find the minimum unfinished watermark
CREATE INDEX IF NOT EXISTS ... ON cdc_metadata_OrderChanges (Watermark) STORING (State);

-- CreatedAt/StartTimestamp index — used to discover new partitions
CREATE INDEX IF NOT EXISTS ... ON cdc_metadata_OrderChanges (CreatedAt, StartTimestamp);
```

The `ROW DELETION POLICY` automatically purges FINISHED partition rows after 1
day, keeping the table small. If you need to pre-create the metadata table
manually (e.g. to grant tighter permissions), ensure you include both indexes.

### PostgreSQL dialect table schema (auto-created)

For databases using the PostgreSQL dialect, the connector creates an equivalent
table with `timestamptz` columns, quoted identifiers, and `TTL INTERVAL '1 days'
ON "FinishedAt"`.

### Partition states

| State | Meaning |
|-------|---------|
| `CREATED` | Partition discovered, not yet scheduled |
| `SCHEDULED` | Assigned to a processing goroutine |
| `RUNNING` | Actively being queried |
| `FINISHED` | Fully consumed; eligible for deletion |

On restart, the connector queries for SCHEDULED and RUNNING rows and resumes
those partitions from their last `Watermark` value.

---

## 4. Spanner Dialect Support

The connector auto-detects the database dialect:

- **GoogleSQL** — the default Spanner dialect (uses standard SQL syntax).
- **PostgreSQL** — Spanner's PostgreSQL-compatible dialect (uses `$1/$2`
  parameter placeholders, `text` types, quoted identifiers, etc.).

No configuration change is needed; the connector selects the correct query style
automatically.

---

## 5. Retention and Replay Considerations

- Spanner change stream data is retained for the stream's `retention_period`
  (default 1 day, configurable up to 7 days).
- If the connector is stopped and `start_timestamp` is not set, on restart it
  reads from the watermark stored in the metadata table.
- If the metadata table is lost or the `metadata_table` name is changed, the
  connector performs a cold restart from the current time (or from
  `start_timestamp` if set).
- To replay a historical window, set `start_timestamp` to a timestamp within
  the stream's retention window and optionally set `end_timestamp` as a bound.
- Mutations committed before the change stream was created cannot be replayed.

---

## 6. Change Stream Scope Options

| DDL | Scope |
|-----|-------|
| `FOR ALL` | All tables in the database, now and in the future |
| `FOR TableA, TableB` | Specific tables |
| `FOR TableA(col1, col2)` | Specific columns within a table |

Combining table-level and column-level tracking in a single stream is supported:

```sql
CREATE CHANGE STREAM Mixed
  FOR orders,
      users(email, last_login);
```
