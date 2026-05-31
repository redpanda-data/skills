# Data Loading

Oxla loads data via `COPY FROM` (into a table) and exports via `COPY TO` (from
a table or query). All grounded in
`tests/UT/query_planner/cases/copy_from/` and
`tests/UT/query_planner/cases/copy_to/`.

---

## COPY FROM

### Syntax

```sql
COPY table_name FROM 'path_or_source' (FORMAT format_name [, options ...]);
COPY table_name FROM STDIN (FORMAT format_name [, options ...]);
```

### Supported formats

| FORMAT | Test case | Notes |
|--------|-----------|-------|
| `CSV` | `predefined_copy_csv_from_stdin` | Standard comma-separated values |
| `PARQUET` | `predefined_copy_from_parquet` | Apache Parquet columnar format |
| `ORC` | `predefined_copy_from_orc` | Apache ORC columnar format |

### CSV from STDIN

```sql
COPY orders FROM STDIN (FORMAT CSV);
```

Used with `psql`'s `\COPY` or by piping data:

```bash
# psql meta-command (client-side, recommended)
\COPY orders FROM '/local/path/orders.csv' (FORMAT CSV)

# Or with STDIN pipe
cat orders.csv | psql -h localhost -p 5432 -U oxla oxla \
  -c "COPY orders FROM STDIN (FORMAT CSV);"
```

With CSV options:

```sql
COPY orders FROM STDIN
     (FORMAT CSV, DELIMITER ',', HEADER ON, NULL '');
```

### Parquet file

```sql
COPY orders FROM 'my_file.parquet' (FORMAT PARQUET);
```

For S3 paths, include AWS credentials in the path or use environment variables
(see S3 section below).

### ORC file

```sql
COPY tb FROM 'my_file.orc' (FORMAT ORC);
```

### Multi-node copy (three_nodes configuration)

The same `COPY FROM` syntax works in multi-node clusters. Oxla distributes
the load automatically:

```sql
-- Same syntax, works on a 3-node cluster
COPY tb FROM STDIN (FORMAT CSV);
```

---

## COPY TO

### Syntax

```sql
COPY table_name TO 'path_or_destination' (FORMAT format_name [, options ...]);
COPY (SELECT ...) TO 'path' (FORMAT format_name [, options ...]);
COPY table_name TO STDOUT (FORMAT format_name [, options ...]);
```

### CSV to STDOUT

```sql
COPY orders TO STDOUT (FORMAT CSV);
```

With options:

```sql
COPY orders TO 'my_file.csv' (NULL '', DELIMITER ',', HEADER ON);
```

Capturing output from psql:

```bash
psql -h localhost -p 5432 -U oxla oxla \
  -c "COPY orders TO STDOUT (FORMAT CSV, DELIMITER ',', HEADER ON);" \
  > orders.csv
```

### Parquet file

```sql
-- Full table
COPY orders TO 'my_file.parquet' (FORMAT parquet);

-- Query result
COPY (SELECT i0, i1 FROM tb WHERE b0)
TO 'my_file.parquet' (FORMAT parquet);
```

### ORC file

```sql
-- Full table
COPY orders TO 'my_file.orc' (FORMAT ORC);

-- Query result
COPY (SELECT i0, i1 FROM tb WHERE b0)
TO 'my_file.orc' (FORMAT ORC);
```

### CSV with query filter

```sql
COPY (SELECT i0, i1 FROM tb WHERE b0)
TO 'my_file.csv'
     (NULL '', DELIMITER ',', HEADER ON);
```

Multi-node:

```sql
COPY (SELECT i0, i1 FROM tb WHERE b0)
TO 'my_file.csv'
     (NULL '', DELIMITER ',', HEADER ON);
-- Works the same on 3-node cluster
```

---

## SELECT INTO (file export form)

`SELECT INTO` in Oxla supports two forms. When the INTO target is a quoted path
with a **parenthesized option list**, it writes query results to a file (S3, local, etc.).
When the target is a bare table name (no option list), it creates a new table —
exactly like PostgreSQL's `SELECT INTO new_table`. See ddl-dml.md for the table-destination form.

`CREATE TABLE AS SELECT` (CTAS) is the recommended way to materialize query results
as a named table and is explicitly supported (`CREATE TABLE [IF NOT EXISTS] t AS SELECT ...`).

### CSV export (file destination)

```sql
SELECT i0, i1
INTO 'my_file.csv'
     (NULL '', DELIMITER ',', HEADER ON)
FROM tb
WHERE b0;
```

### CSV export with HEADER OFF

```sql
SELECT i0, i1
INTO 'my_file.csv'
     (NULL '', DELIMITER ',', HEADER OFF,
      aws_cred(aws_region 'A',
               aws_key_id 'B',
               aws_private_key 'C',
               endpoint 'D'))
FROM tb1;
```

The `aws_cred(...)` block provides S3-compatible credentials inline.

---

## S3 / Cloud Storage

For files on S3 or S3-compatible object storage, provide credentials via
`aws_cred(...)` in the file path options:

```sql
-- COPY FROM S3 Parquet
COPY orders FROM 's3://my-bucket/data/orders.parquet'
     (FORMAT PARQUET,
      aws_cred(aws_region 'eu-central-1',
               aws_key_id 'AKID...',
               aws_private_key 'secret...',
               endpoint 'https://s3.eu-central-1.amazonaws.com'));

-- COPY TO S3 CSV
COPY orders TO 's3://my-bucket/exports/orders.csv'
     (NULL '', DELIMITER ',', HEADER ON,
      aws_cred(aws_region 'eu-central-1',
               aws_key_id 'AKID...',
               aws_private_key 'secret...'));

-- SELECT INTO S3 CSV
SELECT order_id, amount
INTO 's3://my-bucket/exports/out.csv'
     (NULL '', DELIMITER ',', HEADER ON,
      aws_cred(aws_region 'eu-central-1',
               aws_key_id 'AKID...',
               aws_private_key 'secret...',
               endpoint 'https://s3.amazonaws.com'))
FROM orders
WHERE order_date >= DATE '2024-01-01';
```

S3 global config (in `default_config.yml`):

```yaml
storage:
  s3:
    http: "https"
    endpoint: ""          # custom endpoint if not AWS
    enable_discovery: true
    use_dual_stack: true
    requests: 0           # max concurrent TCP connections (0 = default)
    read_bitrate: 0       # bandwidth limit for reads (0 = unlimited)
    write_bitrate: 0      # bandwidth limit for writes (0 = unlimited)
```

Override via env:

```bash
OXLA__STORAGE__S3__ENDPOINT=https://minio.example.com
```

---

## GCS / Azure

Storage config is also in `default_config.yml`:

```yaml
storage:
  gcs:
    no_cache: false
    write_buffer_size: 8M
    read_buffer_size: 1M
  azure:
    account_name: ""
    no_cache: false
    max_retries: 3
```

Use GCS paths (e.g., `gs://bucket/path.parquet`) or Azure Blob paths
in `COPY FROM/TO`.

---

## Bulk loading patterns

### Pattern 1: Stream CSV from shell pipeline

```bash
# Generate data and stream into Oxla
python generate_data.py | \
  psql -h localhost -p 5432 -U oxla oxla \
  -c "COPY orders FROM STDIN (FORMAT CSV, DELIMITER ',', HEADER ON);"
```

### Pattern 2: Load Parquet from a directory listing

```sql
-- Load a single large Parquet file
COPY orders FROM '/data/orders_2024.parquet' (FORMAT PARQUET);

-- Load from S3
COPY orders FROM 's3://data-lake/orders/2024/orders.parquet'
     (FORMAT PARQUET,
      aws_cred(aws_region 'us-east-1',
               aws_key_id 'AKID...',
               aws_private_key 'secret...'));
```

### Pattern 3: ETL via INSERT INTO ... SELECT with aggregation

```sql
-- Aggregate on load
INSERT INTO daily_summary
SELECT order_date,
       region,
       COUNT(*)       AS order_count,
       SUM(amount)    AS revenue
FROM orders
GROUP BY order_date, region;
```

### Pattern 4: Export a query result for downstream use

```sql
-- Export filtered parquet to S3
COPY (
    SELECT o.order_id,
           o.amount,
           c.name AS customer_name,
           r.label AS region_label
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    JOIN regions   r ON o.region_code = r.code
    WHERE o.order_date >= DATE '2024-01-01'
)
TO 's3://exports/enriched_orders.parquet'
     (FORMAT parquet,
      aws_cred(aws_region 'eu-central-1',
               aws_key_id 'AKID...',
               aws_private_key 'secret...'));
```

---

## COPY options reference

| Option | Applies to | Description |
|--------|-----------|-------------|
| `FORMAT CSV` | FROM / TO | CSV format |
| `FORMAT PARQUET` | FROM / TO | Apache Parquet |
| `FORMAT ORC` | FROM / TO | Apache ORC |
| `DELIMITER ','` | CSV | Field delimiter character |
| `HEADER ON` / `HEADER OFF` | CSV | Include/exclude header row |
| `NULL ''` | CSV | String representation of NULL |
| `aws_cred(...)` | S3 paths | Inline AWS credentials block |

For `aws_cred(...)` parameters:

| Parameter | Description |
|-----------|-------------|
| `aws_region 'region'` | AWS region code |
| `aws_key_id 'AKID...'` | AWS access key ID |
| `aws_private_key 'secret'` | AWS secret access key |
| `endpoint 'url'` | Custom endpoint URL (S3-compatible) |

---

## Insertion buffer tuning

From `default_config.yml`, Oxla buffers small insertions in memory before flushing:

```yaml
insertion:
  buffer_size_limit: 42M          # small insertions (<4 MB)
  buffer_timeout: 100 ms
  large_copy_buffer_size_limit: 128M  # large COPY (>4 MB)
  large_insert_into_buffer_size_limit: 128M
```

For bulk loads, the large buffer path is used automatically.
