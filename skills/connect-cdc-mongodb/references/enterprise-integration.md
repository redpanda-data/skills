# Enterprise Integration: mongodb_cdc → Redpanda

This connector is itself a Redpanda **Enterprise** feature, and the topics it
feeds typically pair with other Redpanda enterprise differentiators. This page
documents the relevant enterprise features and their nested config keys,
grounded in the licensing docs and the topic/cluster property reference under
`/tmp/redpanda-skills-src`. Every key below is verified against source — none
are invented.

> License note: features marked **(Enterprise)** require a valid Redpanda
> Enterprise license. See `get-started/licensing/overview.adoc`. On license
> expiration the cluster keeps running, but the listed feature enters a
> restricted state (you cannot create/modify topics with that property).

---

## 1. The `mongodb_cdc` input (Enterprise connector)

The `mongodb_cdc` input is gated by `license.CheckRunningEnterprise` and is
listed under "Redpanda Connect enterprise features → Enterprise connectors" in
`licensing/overview.adoc`. Without a valid license the connector is blocked
(after the 30-day trial). See [config-reference.md](config-reference.md) for
every input field.

Applying a license to Redpanda Connect (any of):

```bash
# Environment variable
export REDPANDA_LICENSE="<license-key-contents>"

# CLI flag at run time
rpk connect run --redpanda-license-path /path/to/redpanda.license pipeline.yaml
```

In a `redpanda{}` config block / Redpanda Cloud pipeline the license is supplied
by the platform. Other Connect enterprise features that pair with CDC pipelines:
secrets management, FIPS-compliant `rpk`, allow/deny component lists, and the
Connect configuration service (`redpanda{}` block) — see sections 5 and 6.

---

## 2. Iceberg Topics (Enterprise) — land CDC events as a queryable table

CDC output topics are a natural fit for Iceberg Topics: point `mongodb_cdc` at a
Redpanda topic, enable Iceberg mode on that topic, and the change events become a
queryable Iceberg table with no second pipeline. **Enterprise license required**;
topics cannot be created/modified with `redpanda.iceberg.mode` once a license
expires.

Cluster prerequisite:

```bash
# Cluster property — must be true before any topic-level Iceberg mode takes effect
rpk cluster config set iceberg_enabled true
```

Topic properties (all grounded in `reference/partials/properties/topic-properties.adoc`):

| Topic property | Type | Default | Values / notes |
|---|---|---|---|
| `redpanda.iceberg.mode` | string | `null` (disabled) | `disabled`, `key_value`, `value_schema_id_prefix`, `value_schema_latest` |
| `redpanda.iceberg.delete` | boolean | `true` | Cluster default: `iceberg_delete`. `false` keeps the Iceberg table after the topic is deleted. |
| `redpanda.iceberg.invalid.record.action` | string (enum) | `dlq_table` | `drop`, `dlq_table`. Cluster default: `iceberg_invalid_record_action`. `dlq_table` writes bad records to `<topic-name>~dlq`. |
| `redpanda.iceberg.partition.spec` | string | `(hour(redpanda.timestamp))` | Iceberg partition spec, e.g. `(col1)`, `(col1, col2)`, `(year(ts1), col1)`. Cluster default: `iceberg_default_partition_spec`. |
| `redpanda.iceberg.target.lag.ms` | integer (ms) | `null` | How often the table is refreshed with new topic data. Cluster default: `iceberg_target_lag_ms`. |

### Iceberg modes — choosing for CDC

- `key_value`: two-column table (record metadata incl. key + binary value).
  Works with any payload, including the raw JSON `mongodb_cdc` emits. No schema
  registration needed.
- `value_schema_id_prefix`: structured table matching the registered schema;
  producers must write the Schema Registry wire format (magic byte + schema ID).
  If you serialize CDC events with a schema, use this.
- `value_schema_latest`: structured table matching the latest registered subject
  schema (`redpanda.iceberg.mode=value_schema_latest:subject=<subject>` to
  override the default subject).
- `disabled` (default): no Iceberg translation.

```bash
# CDC topic with key_value mode (raw mongodb_cdc JSON), custom partitioning + lag
rpk topic create mongo.cdc.orders -p 6 -r 3 \
  -c redpanda.iceberg.mode=key_value \
  -c "redpanda.iceberg.partition.spec=(hour(redpanda.timestamp))" \
  -c redpanda.iceberg.target.lag.ms=60000

# Or alter an existing CDC output topic
rpk topic alter-config mongo.cdc.orders --set redpanda.iceberg.mode=key_value
```

DLQ inspection (when `invalid.record.action=dlq_table`): query the
`<topic-name>~dlq` table; watch the `redpanda_iceberg_translation_dlq_files_created`
metric — a non-zero, increasing value means records are failing to translate.

> Tip for structured Iceberg from CDC: configure a `$jsonSchema` validator on the
> watched MongoDB collections (see [setup-mongodb.md](setup-mongodb.md)) so the
> `schema` metadata is stable, serialize events to a registered schema in the
> pipeline, then use `value_schema_id_prefix`.

---

## 3. Server-side Schema ID Validation (Enterprise)

If you serialize CDC events into the Schema Registry wire format before writing
to Redpanda (e.g. for `value_schema_id_prefix` Iceberg mode or downstream
consumers), server-side schema ID validation makes brokers detect and drop
records carrying unregistered schema IDs — before a consumer ever sees them.
**Enterprise license required**; topics with validation settings cannot be
created/modified after expiry.

Cluster property (grounded in `schema-reg/schema-id-validation.adoc`):

```bash
# Default is `none`; set to `redpanda` (Redpanda strategy) or `compat` (Confluent-compatible)
rpk cluster config set enable_schema_id_validation redpanda
```

Per-topic properties:

| Topic property | Default | Confluent equivalent |
|---|---|---|
| `redpanda.key.schema.id.validation` | `false` | `confluent.key.schema.validation` |
| `redpanda.key.subject.name.strategy` | `TopicNameStrategy` | `confluent.key.subject.name.strategy` |
| `redpanda.value.schema.id.validation` | `false` | `confluent.value.schema.validation` |
| `redpanda.value.subject.name.strategy` | `TopicNameStrategy` | `confluent.value.subject.name.strategy` |

```bash
rpk topic alter-config mongo.cdc.orders \
  --set redpanda.value.schema.id.validation=true \
  --set redpanda.value.subject.name.strategy=TopicNameStrategy
```

Because `mongodb_cdc` uses the MongoDB `_id` as the natural Kafka key, enable key
validation only if you also serialize the key with a registered schema.

---

## 4. Tiered Storage (Enterprise) — long-term retention of CDC topics

CDC streams are append-heavy and often need long retention for replay/audit.
Tiered Storage offloads CDC topic data to object storage. **Enterprise license
required**; topics cannot be created/modified to enable Tiered Storage after
expiry, and partitions cannot be added.

Cluster prerequisites (one of the cloud backends configured), then enable remote
read/write. Per-topic properties (grounded in topic-properties.adoc):

| Topic property | Purpose | Cluster default property |
|---|---|---|
| `redpanda.remote.write` | Upload (archive) topic data to object storage | `cloud_storage_enable_remote_write` |
| `redpanda.remote.read` | Fetch topic data back from object storage | `cloud_storage_enable_remote_read` |
| `redpanda.remote.delete` | Delete objects when the topic is deleted | — |
| `retention.local.target.bytes` | Max local (on-disk) size per partition before cleanup | — |
| `retention.local.target.ms` | Max local (on-disk) age per partition before cleanup | — |
| `retention.bytes` / `retention.ms` | Total retention (local + remote) | `retention_bytes` |

> Setting both `redpanda.remote.read=true` and `redpanda.remote.write=true`
> enables Tiered Storage for the topic.

```bash
# CDC topic: long total retention, small local footprint
rpk topic create mongo.cdc.orders -p 6 -r 3 \
  -c redpanda.remote.write=true \
  -c redpanda.remote.read=true \
  -c retention.ms=-1 \
  -c retention.local.target.ms=86400000   # keep 1 day local, rest in object storage
```

Related enterprise features (same object-storage substrate): **Remote Read
Replicas** (read-only DR copy of a CDC topic in another cluster) and **Topic
Recovery** (`redpanda.remote.recovery=true`) — both require a license.

---

## 5. Securing the Redpanda sink: TLS + SASL (Enterprise auth mechanisms)

The `redpanda`/`kafka_franz` output that receives CDC events supports TLS and
SASL. SCRAM/PLAIN are available in all editions; **OAUTHBEARER/OIDC and Kerberos
(GSSAPI) authentication require an Enterprise license** on the broker side
(per `licensing/overview.adoc`). Output fields grounded in
`connect/.../components/pages/redpanda/about.adoc`:

```yaml
output:
  redpanda:
    seed_brokers: ["redpanda:9092"]
    topic: ${! meta("topic") }
    tls:
      enabled: true
      client_certs:
        - cert_file: /etc/certs/client.crt
          key_file:  /etc/certs/client.key
      # root_cas_file: /etc/certs/ca.crt
      # skip_cert_verify: false   # never true in production
    sasl:
      - mechanism: SCRAM-SHA-512     # PLAIN | SCRAM-SHA-256 | SCRAM-SHA-512 | OAUTHBEARER
        username: "${REDPANDA_USER}"
        password: "${REDPANDA_PASSWORD}"
      # OAUTHBEARER (Enterprise OIDC on broker):
      # - mechanism: OAUTHBEARER
      #   token: "${OAUTH_TOKEN}"
      #   extensions: {}            # key/value pairs added to the OAUTHBEARER request
```

`sasl[].mechanism` accepted values (from source): `PLAIN`, `SCRAM-SHA-256`,
`SCRAM-SHA-512`, `OAUTHBEARER`. `tls.client_certs[]` supports inline
`cert`/`key` (+ `password`) or `cert_file`/`key_file`.

When the CDC user/principal writes to the sink, gate it with **RBAC**
(Enterprise): create a role, grant write ACLs on the CDC topics, and bind the
producer principal to that role (`rpk security role` / `rpk security acl`).

---

## 6. Connect-side enterprise hardening for the pipeline

- **Secrets management (Enterprise)**: instead of plaintext, resolve the MongoDB
  password and the Redpanda SASL password from a remote secret store at runtime.
  Both the input `password` and output `sasl[].password` are flagged secret in
  source and should use `${SECRET}` interpolation rather than literals. See
  `connect/configuration:secrets.adoc`.
- **FIPS compliance (Enterprise)**: run the pipeline with a FIPS-compliant build
  of `rpk connect` when FedRAMP/FIPS cryptography is required.
- **Allow/deny lists (Enterprise)**: restrict which Connect components a shared
  instance may run — pin a CDC instance to just `mongodb_cdc` + the output.
- **Configuration service (`redpanda{}` block, Enterprise)**: ship pipeline logs
  and status events to a Redpanda topic for centralized observability.

---

## Quick reference: which keys belong to which feature

| Feature | License | Keys |
|---|---|---|
| mongodb_cdc input | Enterprise | (see config-reference.md) |
| Iceberg Topics | Enterprise | cluster `iceberg_enabled`; topic `redpanda.iceberg.mode` / `.delete` / `.invalid.record.action` / `.partition.spec` / `.target.lag.ms` |
| Schema ID Validation | Enterprise | cluster `enable_schema_id_validation`; topic `redpanda.{key,value}.schema.id.validation`, `redpanda.{key,value}.subject.name.strategy` |
| Tiered Storage | Enterprise | topic `redpanda.remote.{read,write,delete}`, `retention.local.target.{bytes,ms}`, `retention.{bytes,ms}` |
| Output OAUTHBEARER / Kerberos auth | Enterprise (broker) | output `sasl[].mechanism=OAUTHBEARER`, `sasl[].token`, `sasl[].extensions` |
| RBAC | Enterprise | `rpk security role` / `acl` on CDC topics |
| Connect secrets / FIPS / allow-deny / config service | Enterprise | `${SECRET}` interpolation; FIPS `rpk`; `redpanda{}` block |
