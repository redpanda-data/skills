# Connector Catalog: Tiers and Notable Components

What exists in the Redpanda Connect component catalog, by support tier — so
you know a connector exists and whether it needs a license, without
duplicating its config (per-field config is auto-generated; see the deferral
note at the end).

## Support tiers

Each component carries a support tier in the catalog
(`internal/plugins/info.csv` in `redpanda-data/connect`; also shown on each
component's reference page and filterable at
https://docs.redpanda.com/redpanda-connect/components/catalog/):

| Tier | Meaning |
|---|---|
| `enterprise` | Requires a Redpanda Enterprise license at runtime |
| `certified` | Supported by Redpanda; no license required |
| `community` | Community-maintained, best-effort |

> **Tier vs. runtime gate caveat:** the tier label and the runtime license
> check don't always agree. Known discrepancies at v4.99.0: `jira`
> (processor) is tiered `certified` but its source calls the enterprise
> license check; `aws_dynamodb_cdc` is tiered `enterprise` but has no runtime
> gate in source. When licensing matters for a decision, verify the specific
> component (its docs page, or a dry run without a license).

## Enterprise components (complete at Connect v4.99.0)

All 33 enterprise-tier components, grouped by family. This list changes
between releases — re-verify against `info.csv` at the current stable tag
before relying on it.

### CDC inputs (8 enterprise + 1 certified)

`postgres_cdc`, `mysql_cdc`, `mongodb_cdc`, `microsoft_sql_server_cdc`,
`oracledb_cdc`, `gcp_spanner_cdc`, `aws_dynamodb_cdc`, `salesforce_cdc` —
each has a dedicated deep-dive skill (`connect-cdc-<source>`). The 9th CDC
input, `tigerbeetle_cdc`, is **certified** (no license) and CGO-only; see
`connect-cdc-tigerbeetle`.

### Snowflake

- `snowflake_streaming` (output) — ingest via Snowpipe Streaming; the
  preferred Snowflake path (better performance and cost than `snowflake_put`).
- `snowflake_put` (output) — legacy stage-file loading; the docs recommend
  `snowflake_streaming` instead.

### BigQuery

- `gcp_bigquery_write_api` (output) — streams into BigQuery using the Storage
  Write API. (The older `gcp_bigquery` output and the `gcp_bigquery_select`
  input/processor are certified, not enterprise.)

### Iceberg

- `iceberg` (output) — fan out topics to Apache Iceberg tables via the REST
  catalog API. (Distinct from Redpanda's broker-side Iceberg Topics feature.)

### Splunk

- `splunk` (input) — consume messages from Splunk.
- `splunk_hec` (output) — publish to a Splunk HTTP Event Collector.

### OpenTelemetry

- `otlp_grpc`, `otlp_http` (input **and** output) — receive/send OTel traces,
  logs, and metrics over OTLP.
- `open_telemetry_collector` (metrics exporter **and** tracer) — pipeline
  observability components.

### Slack

- `slack` (input) — Socket Mode events/interactions (bot building).
- `slack_users` (input) — full user-profile listing.
- `slack_post` (output) — `chat.postMessage`.
- `slack_reaction` (output) — add/remove emoji reactions.
- `slack_thread` (processor) — read a thread's replies.

### Google Drive

- `google_drive_search`, `google_drive_download`,
  `google_drive_list_labels` (processors) — search/fetch Drive content
  (common in RAG ingestion pipelines).

### Salesforce (beyond CDC)

- `salesforce` (input) — SOQL query via the REST API, one message per record.
- `salesforce_graphql` (input) — GraphQL query against the UIAPI.
- `salesforce_sink` (output) — write to sObjects, per-topic routing.

### In catalog but undocumented (flagged — do not recommend without checking)

- `gateway` (input) and `a2a_message` (processor) are enterprise-tier in
  `info.csv` at v4.99.0 but have **no reference page** in rp-connect-docs.
  They appear to be ADP/agent-related surfaces; confirm status before
  documenting or recommending them.

## AI/ML processors — certified, NOT license-gated

All 16 AI inference processors are **certified** tier at v4.99.0 with no
runtime license check (Apache-2.0 source): `openai_chat_completion`,
`openai_embeddings`, `openai_image_generation`, `openai_speech`,
`openai_transcription`, `openai_translation`, `aws_bedrock_chat`,
`aws_bedrock_embeddings`, `cohere_chat`, `cohere_embeddings`,
`cohere_rerank`, `gcp_vertex_ai_chat`, `gcp_vertex_ai_embeddings`,
`ollama_chat`, `ollama_embeddings`, `ollama_moderation`.

(Earlier versions of this skill described these as enterprise connectors —
that was wrong at v4.99.0.) Vector-store companions (also certified):
`pinecone` (output), `qdrant` (output + query processor), and the
`text_chunker` processor for embedding prep.

## Notable certified components (non-exhaustive)

The full certified catalog is ~215 components; discover it live rather than
from this list. Families worth knowing exist:

- **Messaging/streaming:** `mqtt` (in/out), `nats_jetstream` (in/out),
  `nats_kv` (in/out/cache/processor), `nats_request_reply` (processor),
  `amqp_0_9` (in/out — RabbitMQ), `websocket` (in/out), `sftp` (in/out).
  (`amqp_1` in/out exists but is community tier.)
- **Azure:** `azure_cosmosdb` (in/out/processor), `azure_data_lake_gen2`
  (out), `azure_queue_storage` (in/out), `azure_table_storage` (in/out),
  plus the already-covered `azure_blob_storage` family.
- **Analytics/DB:** `gcp_bigquery_select` (in/processor), `questdb` (out),
  `aws_dynamodb_partiql` (processor), the `sql_*` family (insert/select/raw).
- **Compute/integration:** `aws_lambda` (processor), `jira` (processor —
  see the tier-vs-gate caveat above), `git` (input — poll a repo for
  commits).
- **Redpanda-native:** `redpanda_data_transform` (processor) — run a
  broker-style Wasm Data Transform inside a Connect pipeline (see the
  `rpk-transform` skill for authoring transforms).

## Discover live (always preferred over static lists)

```bash
rpk connect list                        # every component in your build
rpk connect list --format json          # machine-readable, includes status
rpk connect create <component>          # scaffold full config for a component
```

Catalog with tier filters:
https://docs.redpanda.com/redpanda-connect/components/catalog/?support=enterprise

> **Durability note:** this file names families and tiers so an agent knows
> what exists; it deliberately contains no per-field config. Field lists,
> defaults, and examples are auto-generated into the component reference
> pages — always defer to those and to `rpk connect create`.
