# Oxla: Kafka Catalogs

Oxla can query Kafka and Redpanda topics as tables using named catalog objects.
The Kafka catalog stores connection details (broker addresses, Schema Registry URL,
optional PandaProxy URL) and a set of registered topic sources. Both `CREATE KAFKA CATALOG`
and `CREATE REDPANDA CATALOG` are accepted synonyms.

Sources grounded in: `oxla/src/catalog/kafka/conversions.cpp`,
`oxla/src/sqlparser/sql/CreateStatement.h`,
`oxla/src/sqlparser/sql/AlterKafkaCatalogStatement.h`,
`oxla/src/sqlparser/sql/connection_option_names.h`,
`oxla/src/kafka/types.h`, `oxla/src/kafka/metadata_columns.h`,
`oxla/src/kafka/decoders/schema_lookup_policy.h`,
`oxla/tests/MT/query_planner/cases/predefined_transparent_kafka_iceberg_*/`.

---

## CREATE KAFKA CATALOG

```sql
CREATE [KAFKA | REDPANDA] CATALOG [IF NOT EXISTS] <catalog_name>
  [USING CATALOG <iceberg_catalog_name>]
  WITH ( <option> = <value> [, ...] );
```

**Required options:**

| Option | Type | Description |
|--------|------|-------------|
| `initial_brokers` | String | Bootstrap broker list (e.g. `'broker1:9092,broker2:9092'`) |
| `schema_registry_url` | String | Schema Registry URL (`http://` or `https://`). Port is parsed from the URL; defaults to 80/443. |

**Optional options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `pandaproxy_url` | String | — | Panda Proxy URL for transparent Kafka-Iceberg queries. Shares TLS/auth settings with the schema registry. |
| `sasl_mechanism` | String | — | `'SCRAM-SHA-256'` or `'SCRAM-SHA-512'` |
| `sasl_user` | String | — | SASL username (shared with schema registry credentials) |
| `sasl_password` | String | — | SASL password; stored AES-256-GCM encrypted |
| `truststore` | String | — | PEM-encoded CA bundle for TLS (applied to broker and schema registry) |
| `key_store_key` | String | — | PEM private key for mTLS client authentication |
| `key_store_cert` | String | — | PEM certificate for mTLS client authentication |
| `connection_timeout` | Integer | — | Timeout in milliseconds for all client operations |
| `rd_kafka_debug` | String | — | librdkafka debug context string (e.g. `'all'`, `'consumer,fetch'`) |

The `USING CATALOG` clause links this Kafka catalog to an Iceberg catalog for
transparent topic-as-Iceberg-table queries (see Transparent Queries below).

### Examples

```sql
-- Minimal: unauthenticated local broker
CREATE KAFKA CATALOG dev_kafka
WITH (
  initial_brokers     = 'localhost:9092',
  schema_registry_url = 'http://localhost:8081'
);

-- SASL/SCRAM authenticated Redpanda Cloud
CREATE REDPANDA CATALOG prod
WITH (
  initial_brokers     = 'seed.redpanda.example.com:9093',
  schema_registry_url = 'https://sr.redpanda.example.com:30081',
  sasl_mechanism      = 'SCRAM-SHA-256',
  sasl_user           = 'myuser',
  sasl_password       = 'mysecret'
);

-- With Panda Proxy (enables transparent Kafka-Iceberg).
-- NOTE: USING CATALOG comes BEFORE the WITH clause on CREATE.
CREATE KAFKA CATALOG rp_with_proxy
USING CATALOG my_iceberg_catalog
WITH (
  initial_brokers     = 'localhost:9092',
  schema_registry_url = 'http://localhost:8081',
  pandaproxy_url      = 'http://localhost:8082'
);
```

---

## CREATE TABLE catalog=>name (Register a Topic Source)

```sql
CREATE TABLE [IF NOT EXISTS] [<schema>.]<catalog_name>=><table_name>
WITH ( <option> = <value> [, ...] );
```

**Required options:**

| Option | Type | Description |
|--------|------|-------------|
| `topic` | String | Kafka topic name to consume |

**Optional options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `schema_subject` | String | `<topic>-value` | Schema Registry subject name. Defaults to `resolveSubjectName(topic, subject)` → `topic + "-value"` when not set. |
| `schema_lookup_policy` | String | `LATEST` | `LATEST` (pin to the latest registered schema version; cached at REFRESH time) or `SCHEMA_ID` (each incoming record carries its schema ID, enabling multi-version reads) |
| `error_handling_policy` | String | `FAIL` | `FAIL` (error on decode failure), `FILL_NULL` (null all fields), or `DROP_RECORD` (silently discard the message) |
| `struct_mapping_policy` | String | `COMPOUND` | `COMPOUND` (nested Avro/Protobuf records map to SQL STRUCT) or `JSON` (collapse nested records to SQL JSON scalar). Note: only `COMPOUND` and `JSON` are currently supported; `FLATTEN` and `VARIANT` are parsed but rejected. |
| `output_schema_message_full_name` | String | — | For Protobuf: fully qualified message name (e.g., `com.example.Order`). Selects the top-level message when the descriptor has multiple messages. |
| `confluent_wire_protocol` | String | `true` | `'true'` or `'false'`. Controls whether records have the 5-byte Confluent wire-format header (magic byte + 4-byte schema ID). Only meaningful with `schema_lookup_policy = 'LATEST'`. |

### Examples

```sql
-- Simple: topic with schema auto-discovered as "orders-topic-value"
CREATE TABLE my_kafka=>orders
WITH (topic = 'orders-topic');

-- Explicit schema subject, fill nulls on decode errors
CREATE TABLE my_kafka=>events
WITH (
  topic                = 'events-topic',
  schema_subject       = 'events-value',
  error_handling_policy = 'FILL_NULL'
);

-- Protobuf topic with explicit message type and per-record schema ID
CREATE TABLE my_kafka=>metrics
WITH (
  topic                          = 'metrics-topic',
  schema_lookup_policy           = 'SCHEMA_ID',
  output_schema_message_full_name = 'com.example.Metric'
);
```

---

## REFRESH

`REFRESH` pulls the current schema from the Schema Registry and stores it in
Oxla's internal catalog. It must be called after `CREATE TABLE` and whenever
the schema evolves.

```sql
-- Refresh a specific Kafka source
REFRESH my_kafka=>orders;

-- Refresh an Iceberg table
REFRESH my_iceberg_cat=>ns.my_table;
```

For `schema_lookup_policy = 'LATEST'`, REFRESH pins the latest schema version.
For `schema_lookup_policy = 'SCHEMA_ID'` (RecordSchemaId), REFRESH merges all
known schema versions so every schema ID encountered at read time is resolved.

---

## ALTER KAFKA TABLE

Modifies options on a registered topic source without dropping and recreating it.

```sql
ALTER TABLE [IF EXISTS] [<schema>.]<catalog_name>=><table_name>
WITH ( <option> = <value> [, ...] );
```

Any option accepted by `CREATE TABLE ... WITH` can be altered. The options not
specified are preserved.

```sql
-- Switch from FAIL to FILL_NULL on decode errors
ALTER TABLE my_kafka=>orders
WITH (error_handling_policy = 'FILL_NULL');

-- Change schema lookup policy
ALTER TABLE my_kafka=>orders
WITH (schema_lookup_policy = 'SCHEMA_ID');
```

---

## ALTER KAFKA CATALOG

Modifies connection-level options on an existing catalog.

```sql
ALTER [KAFKA | REDPANDA] CATALOG [IF EXISTS] [<schema>.]<catalog_name>
  WITH ( <option> = <value> [, ...] )
  [USING CATALOG <iceberg_catalog_name> | USING CATALOG NULL];
```

The `USING CATALOG` clause attaches or swaps the linked Iceberg catalog.
`USING CATALOG NULL` detaches the linked Iceberg catalog (clears the link).
Note: `DETACH` is not a SQL keyword; only `USING CATALOG NULL` is valid syntax.

```sql
-- Update timeout
ALTER KAFKA CATALOG my_kafka
WITH (connection_timeout = 30000);

-- Link to an Iceberg catalog (enables transparent topic queries via Iceberg)
ALTER KAFKA CATALOG my_kafka
USING CATALOG my_ice;

-- Detach the Iceberg link
ALTER KAFKA CATALOG my_kafka
USING CATALOG NULL;
```

---

## Querying Kafka Sources

Use the `catalog=>table` notation in any position where a table reference is valid.

```sql
-- Select all columns
SELECT * FROM my_kafka=>orders;

-- Project and filter
SELECT order_id, amount FROM my_kafka=>orders WHERE amount > 100;

-- Join with a native table
SELECT o.order_id, c.name, o.amount
FROM   my_kafka=>orders o
JOIN   customers c ON o.customer_id = c.id;
```

---

## The `redpanda` Metadata Struct

Every Kafka source exposes a hidden `redpanda` struct column containing Kafka
message metadata. It is not returned by `SELECT *` but can be accessed explicitly.

**`redpanda` struct fields** (grounded in `oxla/src/kafka/metadata_columns.h`):

| Field | SQL Type | Description |
|-------|----------|-------------|
| `partition` | INT (i32) | Kafka partition ID |
| `offset` | BIGINT (i64) | Kafka offset within the partition |
| `timestamp` | TIMESTAMPTZ (nullable) | Message timestamp |
| `headers` | ARRAY of STRUCT | Message headers array |
| `key` | BYTEA (nullable) | Raw message key bytes |
| `timestamp_type` | INT (nullable) | Kafka timestamp type integer |

`headers` is an array of structs with two fields: `key` (TEXT) and `value` (BYTEA).
Header keys are UTF-8 strings; header values are opaque bytes per the Kafka wire protocol.

There is also a `redpanda_raw` column with only `key` (BYTEA) and `value` (BYTEA)
for accessing the raw un-decoded message bytes.

```sql
-- Access partition and offset
SELECT order_id,
       (redpanda).partition,
       (redpanda)."offset"
FROM   my_kafka=>orders;

-- Filter by Kafka metadata
SELECT order_id, amount
FROM   my_kafka=>orders t
WHERE  (t.redpanda)."offset" > 0;

-- Filter by timestamp
SELECT *
FROM   my_kafka=>orders
WHERE  (redpanda).timestamp >= TIMESTAMP '2024-01-01 00:00:00';
```

Note: `offset` must be quoted as `"offset"` because it is a reserved SQL keyword.

---

## Schema Decoding: Avro, Protobuf, JSON

Schema type is determined automatically from the Schema Registry subject's registered
schema. Three schema types are supported (grounded in `oxla/kafka/types.h`):

```
enum class SchemaType : int32_t { Avro = 0, Protobuf = 1, Json = 2 };
```

### Avro type mappings (selected, from `oxla/src/kafka/decoders/logical_types.h`)

| Avro type | SQL type |
|-----------|----------|
| null | NULL target / nullable |
| boolean | BOOL |
| int (int32) | INT |
| long (int64) | BIGINT |
| float | FLOAT |
| double | DOUBLE |
| string | TEXT |
| bytes | BYTEA |
| record | STRUCT (COMPOUND policy) or JSON (JSON policy) |
| array | ARRAY |
| map | JSON |
| date (logical) | DATE |
| time-millis / time-micros | TIME |
| timestamp-millis / timestamp-micros | TIMESTAMP |
| decimal (logical) | NUMERIC |
| uuid (logical) | TEXT |

### Protobuf type mappings

Protobuf field types map via `pbTypeToSqlt` in `oxla/src/external_schema/protobuf/protobuf_sql_mapping.h`.
Nested messages become STRUCT fields (COMPOUND policy) or JSON (JSON policy).

### JSON schema mappings

JSON Schema types map via `oxla/src/external_schema/json/`: `string`→TEXT,
`integer`→BIGINT, `number`→DOUBLE, `boolean`→BOOL, `object`→STRUCT or JSON,
`array`→ARRAY.

---

## Schema Lookup Policies

Two policies control how schemas are resolved at read time
(grounded in `oxla/src/kafka/decoders/schema_lookup_policy.h`):

**`LATEST` (default):**
- Oxla fetches the latest schema version at `REFRESH` time and stores it.
- All incoming records are decoded with that fixed schema.
- The Confluent wire-format header (5-byte magic+schema-ID prefix) is used by
  default (`confluent_wire_protocol = 'true'`).
- Best for topics where the schema is stable or changes infrequently.

**`SCHEMA_ID`:**
- Each Kafka record carries its own Confluent schema ID in the 5-byte wire header.
- Oxla resolves the schema per-record from the registry.
- At `REFRESH` time, all known schema versions are merged into a widened type.
- Best for topics with multiple active schema versions.

---

## Transparent Kafka-Iceberg Queries

When a Kafka catalog is linked to an Iceberg catalog (via `USING CATALOG` or
`ALTER KAFKA CATALOG ... USING CATALOG`), Oxla can read Kafka topics through
their Iceberg table representation for time-travel and partition-aware scans.

```sql
-- Link the Kafka catalog to an Iceberg catalog
ALTER KAFKA CATALOG my_kafka USING CATALOG my_ice;

-- Now query the Kafka source as if it were an Iceberg table
-- (uses the catalog=>source syntax, but Oxla routes through Iceberg)
SELECT age, name FROM my_kafka=>users;
```

Transparent queries expose the full `redpanda` metadata struct including nested
struct fields with Iceberg-schema ordering:
`partition`, `offset`, `timestamp`, `headers` (array), `key`, `timestamp_type`.

Filter on Redpanda metadata fields works in transparent mode:

```sql
SELECT name, age
FROM   my_kafka=>users t
WHERE  (t.redpanda)."offset" > 0;
```

Schema superset handling: when the Kafka Avro/Protobuf schema is a strict
name-superset of the Iceberg table schema (i.e., additional fields exist in
Kafka that are not in Iceberg), Oxla widens the struct type to include both.

---

## Error Handling Policies

| Policy | Behaviour on decode failure |
|--------|-----------------------------|
| `FAIL` (default) | Query fails with an error |
| `FILL_NULL` | All fields of the failed record are set to NULL |
| `DROP_RECORD` | The record is silently discarded |

---

## Struct Mapping Policies

| Policy | Behaviour for nested records |
|--------|------------------------------|
| `COMPOUND` (default) | Nested Avro/Protobuf records become SQL STRUCT columns |
| `JSON` | Nested records are collapsed to a single SQL JSON scalar |

Note: `FLATTEN` and `VARIANT` are parsed by the grammar but currently rejected at
execution time with an error ("only JSON and COMPOUND struct mapping policy is
supported in current Oxla version").
