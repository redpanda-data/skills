# Redpanda Agent Skills

Agent Skills for Redpanda's five products — **Streaming** (the Kafka-compatible engine),
**SQL** (Oxla), **Connect**, **Cloud** (Serverless, BYOC, Dedicated), and the **Agentic
Data Plane** (ADP) — unified by the **rpk** command-line experience. Each skill is grounded
in Redpanda's own source code, documentation, and APIs.

## Installation

**One command** (from your shell):

```bash
claude plugin marketplace add redpanda-data/skills && claude plugin install redpanda@redpanda-skills
```

Or **inside a Claude Code session**, as two separate slash commands (run one at a time —
don't paste them together):

```
/plugin marketplace add redpanda-data/skills
/plugin install redpanda@redpanda-skills
```

Once installed, invoke any skill with its `/redpanda:<skill>` name (e.g.
`/redpanda:streaming`). Each skill's `SKILL.md` frontmatter `description` tells the agent
when to load it automatically.

## What is this?

This repo is a Claude Code **plugin** named `redpanda`. When installed, every skill is
available to the agent as `/redpanda:<skill>` (for example `/redpanda:streaming`).
A skill is a focused, on-demand reference: a `SKILL.md` the agent loads when relevant,
plus `references/` files it pulls in for depth. Skills are self-contained and contain
copy-pasteable commands, configs, and code.

## Available Skills

Redpanda has five public products — Streaming, SQL, Connect, Cloud, and the Agentic
Data Plane (ADP) — with `rpk` as the unifying CLI across all of them.

### 🌊 Streaming
The Kafka-compatible streaming engine (the Redpanda broker).
- [**streaming**](./skills/streaming) — The Kafka API: produce/consume, consumer groups, transactions & idempotence, topic management, client compatibility, tiered storage, Iceberg topics, cloud topics, continuous balancing, and shadow linking.
- [**streaming-admin-api**](./skills/streaming-admin-api) — Operate the cluster via the HTTP Admin API (port 9644): brokers, partitions, cluster config, features, licensing, transactions, debug, and debug bundles.
- [**streaming-debugging**](./skills/streaming-debugging) — Diagnose a broker/cluster: debug bundles, metrics endpoints, logs, CPU profiling, partition/raft health, and failure-mode playbooks.

### 🧮 SQL
Redpanda SQL — the distributed, columnar, PostgreSQL-compatible analytical database (Oxla).
- [**sql**](./skills/sql) — Write SQL: connection (PostgreSQL wire protocol), data types, DDL/DML, functions, and analytical queries.
- [**sql-admin-api**](./skills/sql-admin-api) — Operate a cluster: configuration, node roles and ports, leader election, storage backends, memory limits, and the gRPC admin service.
- [**sql-federated-queries**](./skills/sql-federated-queries) — Query external data: Kafka topics via catalogs, Apache Iceberg tables, and S3/GCS/Azure parquet/ORC files.
- [**sql-debugging**](./skills/sql-debugging) — Diagnose: system catalog tables, Prometheus metrics, log levels, memory/OOM monitoring, and query troubleshooting.

### 🔌 Connect
Redpanda Connect — declarative stream processing (formerly Benthos).
- [**connect**](./skills/connect) — Build pipelines (inputs, processors, outputs, Bloblang), the config structure, and running pipelines.
- [**connect-debugging**](./skills/connect-debugging) — Debug pipelines: linting, log levels, metrics, tracing, health endpoints, dry-runs, and common failure modes.

**Change Data Capture (one per connector):**
- [**connect-cdc-postgres**](./skills/connect-cdc-postgres) — PostgreSQL (`postgres_cdc`, logical replication / WAL).
- [**connect-cdc-mysql**](./skills/connect-cdc-mysql) — MySQL/MariaDB (`mysql_cdc`, binlog).
- [**connect-cdc-mongodb**](./skills/connect-cdc-mongodb) — MongoDB (`mongodb_cdc`, change streams).
- [**connect-cdc-sqlserver**](./skills/connect-cdc-sqlserver) — Microsoft SQL Server (`microsoft_sql_server_cdc`).
- [**connect-cdc-oracle**](./skills/connect-cdc-oracle) — Oracle (`oracledb_cdc`, LogMiner).
- [**connect-cdc-spanner**](./skills/connect-cdc-spanner) — Google Cloud Spanner (`gcp_spanner_cdc`, change streams).
- [**connect-cdc-dynamodb**](./skills/connect-cdc-dynamodb) — AWS DynamoDB (`aws_dynamodb_cdc`, DynamoDB Streams).
- [**connect-cdc-salesforce**](./skills/connect-cdc-salesforce) — Salesforce (`salesforce_cdc`, Pub/Sub API).
- [**connect-cdc-tigerbeetle**](./skills/connect-cdc-tigerbeetle) — TigerBeetle (`tigerbeetle_cdc`, ledger change events; cgo builds only).

### ☁️ Cloud
Redpanda Cloud — the managed control plane and per-cluster data plane.
- [**cloud-serverless**](./skills/cloud-serverless) — Serverless clusters (multi-tenant, pay-per-use) via the Control Plane API, plus the per-cluster Data Plane API.
- [**cloud-byoc**](./skills/cloud-byoc) — BYOC (Bring Your Own Cloud) clusters in your own AWS/GCP/Azure account: networks/VPCs, provider setup, and the `rpk` BYOC agent flow.
- [**cloud-dedicated**](./skills/cloud-dedicated) — Dedicated clusters (fully Redpanda-managed, single-tenant, in Redpanda's cloud account) via the Control Plane API.

### 🤖 Agentic Data Plane (ADP)
Redpanda's governance infrastructure for AI agents and MCP servers — its own product surface that runs on Redpanda, provisioning its own ADP environment.
- [**adp**](./skills/adp) — Build and operate AI on Redpanda: AI agents, MCP servers (managed catalog + code mode), the AI Gateway (LLM providers and models), governance (budgets, guardrails, Cedar policies, OAuth), and observability (transcripts) — driven through the `rpk ai` CLI and the ADP API.

### ⌨️ rpk — the unifying CLI
One CLI across every product.
- [**rpk**](./skills/rpk) — Install rpk, configure connections with profiles and `-X` flags, and target self-hosted or Redpanda Cloud clusters. Start here.
- [**rpk-topic**](./skills/rpk-topic) — Create, describe, alter, and delete topics; produce and consume records.
- [**rpk-cluster**](./skills/rpk-cluster) — Health/metadata, brokers, cluster config, partition balancing/movement, maintenance mode, quotas, storage (mountable topics / whole-cluster restore), and self-tests.
- [**rpk-redpanda**](./skills/rpk-redpanda) — Operate a self-managed broker node: start/stop the process, production/dev/recovery mode, the autotuner and `rpk iotune`, node config bootstrap, and broker decommission/recommission via the admin listener. Self-managed only.
- [**rpk-group**](./skills/rpk-group) — List/describe consumer groups, inspect lag and members, reset/seek offsets, and delete groups or offsets.
- [**rpk-security**](./skills/rpk-security) — Manage SASL/SCRAM users, Kafka ACLs, RBAC roles, and secrets.
- [**rpk-cloud**](./skills/rpk-cloud) — Authenticate to Redpanda Cloud, manage credentials, select clusters, manage resource groups, drive BYOC provisioning, and run the `rpk cloud mcp` server that exposes Redpanda Cloud management to AI agents.
- [**rpk-debug**](./skills/rpk-debug) — Collect local and remote debug bundles and inspect local process info.
- [**rpk-registry**](./skills/rpk-registry) — Manage Schema Registry subjects, schemas, compatibility, and modes.
- [**rpk-transform**](./skills/rpk-transform) — Build, deploy, and manage Redpanda Data Transforms (in-broker WebAssembly functions).

## How these skills were built

Each skill was drafted from a grounded spec (source paths into the Redpanda, Connect,
and Oxla repositories plus the docs), then put through an **adversarial review at maximum
model effort** that cross-checks every command, flag, config field, endpoint, and code
example against the actual source — fixing hallucinated or outdated details — followed by
a dedicated **enterprise-feature coverage** pass (the key differentiators, with their
nested settings) and a final verification pass.

## How these skills stay current

The skills are kept in sync with Redpanda's source by a fleet of scheduled maintenance
routines — a **generator → critic → human-merge** loop per product, plus a monthly drift
audit — covering all five products. See **[MAINTAINING.md](./MAINTAINING.md)** for how the
process works and how to operate it, and **[skills-sync-routine.md](./skills-sync-routine.md)**
for the exact routine definitions. Each source-grounded skill carries a
`references/SOURCES.md` that maps its claims to the upstream source.

## License

Distributed under the Apache 2.0 license. See the [LICENSE](./LICENSE) file.

## Acknowledgements

Structure and format modeled on [google/skills](https://github.com/google/skills).
