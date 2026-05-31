# MySQL / MariaDB Setup for CDC

This reference covers every prerequisite for running the `mysql_cdc` input against MySQL 5.7+, MySQL 8.x, MariaDB, and managed cloud variants (AWS RDS, Aurora, Google Cloud SQL, Azure Database for MySQL).

---

## 1. Enable binary logging in ROW format

The `mysql_cdc` connector uses binlog replication. Binlog must be enabled and set to `ROW` format. Verify the current state:

```sql
SHOW VARIABLES LIKE 'log_bin';        -- must be: ON
SHOW VARIABLES LIKE 'binlog_format';  -- must be: ROW
SHOW VARIABLES LIKE 'server_id';      -- must be non-zero (e.g. 1)
```

### Self-managed MySQL (my.cnf / my.ini)

Add to `[mysqld]`:

```ini
[mysqld]
# Binary logging
log_bin         = mysql-bin
binlog_format   = ROW
# MySQL 8.0+: use binlog_expire_logs_seconds (expire_logs_days is deprecated in 8.0, removed in 8.4)
binlog_expire_logs_seconds = 604800   # 7 days
# MySQL 5.7 only:
# expire_logs_days = 7
server_id       = 1           # any unique non-zero integer in the replication topology

# Optional but recommended
binlog_row_image = FULL       # ensures all columns are written for every row event
max_binlog_size  = 100M
```

Restart MySQL after editing `my.cnf`.

### Self-managed MariaDB (my.cnf)

```ini
[mysqld]
log_bin         = mariadb-bin
binlog_format   = ROW
server_id       = 1
binlog_row_image = FULL
expire_logs_days = 7          # MariaDB uses expire_logs_days (not binlog_expire_logs_seconds)
```

### Verify after restart

```sql
-- MySQL 5.7 / 8.0 / MariaDB:
SHOW MASTER STATUS;
-- MySQL 8.4+ (SHOW MASTER STATUS was removed in 8.4):
SHOW BINARY LOG STATUS;
-- Must show a non-empty File and Position, e.g.:
-- +------------------+----------+
-- | File             | Position |
-- +------------------+----------+
-- | mysql-bin.000001 |      154 |
-- +------------------+----------+
```

> **Note:** The connector itself tries `SHOW BINARY LOG STATUS` first, then falls back to `SHOW MASTER STATUS`. On MySQL 8.4+, only `SHOW BINARY LOG STATUS` works.

---

## 2. Create a replication user

The CDC user needs:
- `REPLICATION SLAVE` — to receive binlog events
- `REPLICATION CLIENT` — to call `SHOW MASTER STATUS` (MySQL 5.7/8.0) or `SHOW BINARY LOG STATUS` (MySQL 8.4+)
- `SELECT` — to read rows during the snapshot phase
- `LOCK TABLES` — required for `FLUSH TABLES <tables> WITH READ LOCK` during snapshot (SELECT alone does not grant locking ability)

```sql
-- MySQL 5.7 / MariaDB
CREATE USER 'cdc_user'@'%' IDENTIFIED BY 'StrongPassword123!';
GRANT REPLICATION SLAVE  ON *.* TO 'cdc_user'@'%';
GRANT REPLICATION CLIENT ON *.* TO 'cdc_user'@'%';
GRANT SELECT             ON mydb.* TO 'cdc_user'@'%';
GRANT LOCK TABLES        ON mydb.* TO 'cdc_user'@'%';
FLUSH PRIVILEGES;

-- MySQL 8.x (same grants, but password auth plugin differs)
CREATE USER 'cdc_user'@'%' IDENTIFIED WITH mysql_native_password BY 'StrongPassword123!';
GRANT REPLICATION SLAVE  ON *.* TO 'cdc_user'@'%';
GRANT REPLICATION CLIENT ON *.* TO 'cdc_user'@'%';
GRANT SELECT             ON mydb.* TO 'cdc_user'@'%';
GRANT LOCK TABLES        ON mydb.* TO 'cdc_user'@'%';
FLUSH PRIVILEGES;
```

Verify the grants:

```sql
SHOW GRANTS FOR 'cdc_user'@'%';
```

---

## 3. Snapshot-specific requirements

During snapshot the connector issues a **table-scoped** lock — `FLUSH TABLES <tables> WITH READ LOCK` — against only the tables in the `tables` list (not the entire server). This requires:

- `LOCK TABLES` privilege (granted above) — SELECT alone is insufficient for the lock; SELECT is required for reading rows
- Brief write pause on the locked tables — the lock is held only long enough to start consistent-snapshot transactions on all worker connections and read the binlog position, then released immediately

If `FLUSH TABLES <tables> WITH READ LOCK` is not acceptable (e.g. on a heavily loaded primary), point the **entire connector** (snapshot and binlog streaming both use the single `dsn`) at a read replica that has `log_slave_updates = ON` (MySQL 5.7/8.0) or `log_replica_updates = ON` (MySQL 8.x). Both the snapshot and the binlog stream will come from the replica. The connector cannot split snapshot and streaming across two different hosts — `dsn` is a single address.

---

## 4. GTID (optional)

GTID-based replication is **not required** by the `mysql_cdc` connector. The connector tracks binlog positions by filename and offset (`mysql-bin.000001@00000154`). GTIDs are supported by the underlying `go-mysql` canal library but the connector does not expose a GTID-specific configuration.

If your cluster uses GTID mode, the connector works transparently — no additional configuration is needed.

---

## 5. AWS RDS / Aurora MySQL

RDS and Aurora do not allow editing `my.cnf` directly. Configure binlog via a **parameter group**:

| Parameter | Value |
|---|---|
| `binlog_format` | `ROW` |
| `log_bin_trust_function_creators` | `1` |
| `binlog_row_image` | `FULL` (recommended) |
| `binlog_expire_logs_seconds` | `604800` (7 days) |

Apply the parameter group to the DB instance and **reboot** to apply (some parameters are dynamic, `binlog_format` requires reboot on older RDS).

Verify:
```sql
CALL mysql.rds_show_configuration;
SHOW VARIABLES LIKE 'binlog_format';
```

### RDS replication user

RDS uses the stored procedure `mysql.rds_set_configuration` for some settings. The user setup is the same as self-managed:

```sql
CREATE USER 'cdc_user'@'%' IDENTIFIED BY 'StrongPassword123!';
GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'cdc_user'@'%';
GRANT SELECT ON mydb.* TO 'cdc_user'@'%';
GRANT LOCK TABLES ON mydb.* TO 'cdc_user'@'%';
FLUSH PRIVILEGES;
```

### AWS IAM authentication (RDS / Aurora)

Instead of a static password you can use IAM database authentication:

1. Enable IAM DB authentication on the RDS instance (console or CLI: `--enable-iam-database-authentication`).
2. Create the user with `AWSAuthenticationPlugin`:
   ```sql
   CREATE USER 'cdc_user'@'%' IDENTIFIED WITH AWSAuthenticationPlugin AS 'RDS';
   GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'cdc_user'@'%';
   GRANT SELECT ON mydb.* TO 'cdc_user'@'%';
   GRANT LOCK TABLES ON mydb.* TO 'cdc_user'@'%';
   ```
3. Attach the IAM policy to the Connect task/role:
   ```json
   {
     "Effect": "Allow",
     "Action": "rds-db:connect",
     "Resource": "arn:aws:rds-db:us-east-1:123456789012:dbuser:db-ABCDE/cdc_user"
   }
   ```
4. Configure the connector with the `aws` block (omit the password from the DSN):
   ```yaml
   input:
     mysql_cdc:
       dsn: cdc_user@tcp(mydb.abc123.us-east-1.rds.amazonaws.com:3306)/mydb
       aws:
         enabled: true
         endpoint: mydb.abc123.us-east-1.rds.amazonaws.com
         region: us-east-1
       max_reconnect_attempts: 3
   ```

IAM tokens expire after 15 minutes. Keep `max_reconnect_attempts` low (e.g. `3`) so the connector reconnects and refreshes the token promptly.

---

## 6. Google Cloud SQL for MySQL

In the Cloud Console, enable binary logging:
- Navigate to your instance → **Edit** → **Data Protection** → enable **Enable point-in-time recovery** (this enables binary logging).

Or via CLI:
```bash
gcloud sql instances patch MY_INSTANCE \
  --enable-bin-log \
  --backup-start-time=02:00
```

Create the user with the same grants as self-managed MySQL. Connect via the Cloud SQL Auth Proxy:
```yaml
dsn: cdc_user:password@tcp(127.0.0.1:3306)/mydb
```

---

## 7. Azure Database for MySQL

Enable binary logging in the **Server parameters** blade:
- `binlog_row_image` = `FULL`
- `binlog_expire_logs_seconds` = `604800`

`binlog_format` is automatically set to `ROW` on Azure Database for MySQL Flexible Server and cannot be changed. On Single Server, set `binlog_format = ROW` in server parameters.

User grants are the same as self-managed MySQL.

---

## 8. MariaDB specifics

MariaDB uses its own binlog format for GTID events. Always set `flavor: mariadb` in the connector config.

MariaDB 10.1+ supports `binlog_row_image` (default `FULL`), which is what the connector needs. No explicit setting is required on 10.1+.

```sql
-- MariaDB replication user
CREATE USER 'cdc_user'@'%' IDENTIFIED BY 'StrongPassword123!';
GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'cdc_user'@'%';
GRANT SELECT ON mydb.* TO 'cdc_user'@'%';
GRANT LOCK TABLES ON mydb.* TO 'cdc_user'@'%';
FLUSH PRIVILEGES;
```

---

## 9. Verifying the setup

Run these checks as the `cdc_user` before starting the connector:

```sql
-- 1. Can the user read binlog status?
-- MySQL 5.7 / 8.0 / MariaDB:
SHOW MASTER STATUS;
-- MySQL 8.4+ (SHOW MASTER STATUS removed; use this instead):
SHOW BINARY LOG STATUS;

-- 2. Can the user read tables?
SELECT COUNT(*) FROM mydb.orders;

-- 3. Check max_allowed_packet (affects large row events)
SHOW VARIABLES LIKE 'max_allowed_packet';
-- Increase if you see "packet too large" errors: set to at least 64M
```

From the Connect host, verify TCP connectivity:
```bash
nc -zv localhost 3306
# or — use SHOW BINARY LOG STATUS on MySQL 8.4+
mysql -u cdc_user -p -h localhost mydb -e "SHOW MASTER STATUS;"
```

---

## Summary checklist

- [ ] `log_bin = ON`
- [ ] `binlog_format = ROW`
- [ ] `server_id` is a non-zero unique integer
- [ ] Replication user has `REPLICATION SLAVE` + `REPLICATION CLIENT` on `*.*`
- [ ] Replication user has `SELECT` + `LOCK TABLES` on the target database
- [ ] `SHOW MASTER STATUS` (MySQL 5.7/8.0/MariaDB) or `SHOW BINARY LOG STATUS` (MySQL 8.4+) returns a valid binlog filename and position
- [ ] TCP port 3306 (or custom) is reachable from the Connect host
