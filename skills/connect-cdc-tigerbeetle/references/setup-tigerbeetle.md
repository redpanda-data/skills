# TigerBeetle Setup for CDC

This page covers everything you need before running the `tigerbeetle_cdc` connector: the right Redpanda Connect build, TigerBeetle version requirements, cluster connection parameters, and the progress cache.

---

## 1. Get a cgo-enabled Redpanda Connect build

The `tigerbeetle_cdc` input exists **only in cgo-enabled builds** of Redpanda Connect (the component is compiled behind `//go:build cgo` because it links the native TigerBeetle client). It is **not** included in:

- the `rpk connect` CLI, or
- the standard Redpanda Connect Docker image, or
- the standard (non-cgo) prebuilt binary.

If a pipeline fails with an error that `tigerbeetle_cdc` is not a recognized input, you are on a non-cgo build.

### Option A: prebuilt cgo-enabled binary (Linux AMD64 only)

```bash
# Note the -cgo suffix in the archive name; replace <VERSION> with a release from
# https://github.com/redpanda-data/connect/releases
wget https://github.com/redpanda-data/redpanda-connect/releases/download/v<VERSION>/redpanda-connect-cgo_<VERSION>_linux_amd64.tar.gz
tar -xzf redpanda-connect-cgo_<VERSION>_linux_amd64.tar.gz
sudo mv redpanda-connect /usr/local/bin/
redpanda-connect --version
```

The standard (non-cgo) archive is named `redpanda-connect_<VERSION>_<os>_<arch>.tar.gz`; the cgo one is `redpanda-connect-cgo_...` and is published for Linux AMD64 only.

### Option B: build from source with cgo

Build Redpanda Connect from the `redpanda-data/connect` repository with `CGO_ENABLED=1`. See the rp-connect-docs page `modules/install/pages/build-from-source.adoc` for the supported procedure.

### Verify the component is present

```bash
redpanda-connect list inputs | grep tigerbeetle
# or print the full config spec:
redpanda-connect create tigerbeetle_cdc
```

---

## 2. TigerBeetle cluster requirements

- **Cluster version 0.16.57 or later.** TigerBeetle's CDC support (see the [TigerBeetle CDC docs](https://docs.tigerbeetle.com/operating/cdc/)) is the upstream surface this input consumes.
- **Client/cluster compatibility:** the TigerBeetle client bundled in your Connect build must **not be newer than the cluster version** — the connection fails with an error if it is. When in doubt, upgrade TigerBeetle before upgrading the Connect binary.
- For a local development cluster, follow the [TigerBeetle documentation](https://docs.tigerbeetle.com/).

The window of past events available for streaming is governed by the TigerBeetle cluster, not by this connector — consult the TigerBeetle CDC documentation for its retention semantics.

---

## 3. Cluster connection parameters

| Parameter | What to supply |
|---|---|
| `cluster_id` | The unique 128-bit cluster ID chosen when the cluster was formatted, as a base-10 string. Small integers are valid — `"1"` represents the 128-bit value 1. |
| `addresses` | The `host:port` of **every** replica, in replica order (the order must correspond to the order of replicas). A standard cluster has three replicas. |

```yaml
input:
  tigerbeetle_cdc:
    cluster_id: "1"
    addresses:
      - "192.168.1.10:3000"
      - "192.168.1.11:3000"
      - "192.168.1.12:3000"
    progress_cache: redis_cache
```

Connection troubleshooting:

- Verify each address is reachable from the Connect host (network path, firewall).
- Confirm `cluster_id` matches the ID used when creating the cluster — a mismatch fails the connection.
- The first change-event query doubles as the connection check: `Connect()` returns only after the first request succeeds or times out (`timeout_seconds`, default 15s).

---

## 4. Choose and configure the progress cache

The connector's only durable state is the last acknowledged event timestamp, stored in a Connect cache resource under the key `timestamp_last_<cluster_id>` (8-byte little-endian unsigned integer). Pick the cache by durability requirement:

| Cache | Use when |
|---|---|
| `redis` | Standard choice; the cookbook examples use it |
| `aws_dynamodb` | Already on AWS; serverless durability |
| `sql` | An existing relational database is the system of record |
| `memory` | Testing only — progress lost on every restart, all available events re-streamed |

```yaml
cache_resources:
  - label: redis_cache
    redis:
      url: redis://localhost:6379
```

Operational rules:

- **Do not share one cache key across pipelines reading the same cluster** — they would overwrite each other's checkpoints. The key is derived from `cluster_id` only, so two pipelines on the *same* cluster need separate cache resources (e.g., different Redis DBs or key-prefixed cache configs).
- **To force a full re-stream**, delete the `timestamp_last_<cluster_id>` key (or point `progress_cache` at a fresh cache).
- **To start from a known position** on a fresh cache, set `timestamp_initial` — it is inclusive and ignored once the cache holds a more recent acknowledged timestamp.

---

## 5. Consumer-side requirement: idempotency

Delivery is at-least-once. During crash recovery the connector may replay events that were already delivered but not yet checkpointed. Downstream consumers must implement idempotency — the nanosecond-resolution `timestamp` metadata field is unique per event and is the recommended deduplication key.
