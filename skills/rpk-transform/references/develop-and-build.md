# Develop and Build Data Transforms

Data transforms run as WebAssembly (Wasm) functions inside the Redpanda broker. This reference covers initializing a project, writing transform logic in each supported language, building the Wasm binary, and advanced patterns such as multi-topic routing and Schema Registry integration.

## Prerequisites

Install the appropriate language toolchain before running `rpk transform build`:

- **Go/TinyGo**: Go >= 1.20 (`https://go.dev/doc/install`). TinyGo is installed automatically by `rpk transform build` as a buildpack.
- **Rust**: latest stable Rust via `rustup` (`https://rustup.rs/`). The `wasm32-wasip1` target (`rustup target add wasm32-wasip1`) and SDK crate (`cargo add redpanda-transform-sdk`) are installed when `--install-deps` is passed to `rpk transform init`, or when the post-init interactive prompt is confirmed. Without `--install-deps`, install them manually before building.
- **JavaScript/TypeScript**: latest LTS Node.js (`https://nodejs.org/`). The npm dependencies (including `@redpanda-data/transform-sdk` and esbuild) are installed when `--install-deps` is passed or the prompt is confirmed (`npm install`). The Redpanda JS VM buildpack is fetched automatically at build time.

## Initializing a Project

```bash
rpk transform init [DIRECTORY] [flags]

  -l, --language string   tinygo-no-goroutines | tinygo-with-goroutines | rust | javascript | typescript
      --name string       Name of the transform (used as the .wasm filename)
      --install-deps      Automatically install language dependencies (default: prompt)
```

Running `rpk transform init` in a directory that already contains `transform.yaml` returns an error. Run it in a clean directory.

### Example

```bash
rpk transform init my-filter --language=tinygo-no-goroutines --name=my-filter --install-deps
```

This creates (TinyGo example):

```
my-filter/
├── transform.yaml  # project config (init writes name + language only)
├── transform.go    # boilerplate with OnRecordWritten callback
├── go.mod
└── README.md
```

`go.sum` is generated only after dependency installation (`go mod tidy`), which happens when `--install-deps` is passed or when the post-init prompt is confirmed.

Files generated per language:

| Language | Generated files |
|---|---|
| TinyGo | `transform.yaml`, `transform.go`, `go.mod`, `README.md` |
| Rust | `transform.yaml`, `Cargo.toml`, `README.md`, `src/main.rs`, `.cargo/config.toml` |
| JavaScript | `transform.yaml`, `package.json`, `README.md`, `esbuild.js`, `src/index.js` |
| TypeScript | `transform.yaml`, `package.json`, `README.md`, `esbuild.js`, `tsconfig.json`, `src/index.ts` |

### transform.yaml

`rpk transform init` writes only `name` and `language` to `transform.yaml`. The remaining fields — `input-topic`, `output-topics`, `env`, `description`, and `compression` — are added by the user (or supplied as CLI flags at deploy time). All file fields are overridable on the `rpk transform deploy` command line.

**Note**: `--from-offset` is a **deploy-time CLI flag only**. It is not a `transform.yaml` field — placing it in the file has no effect and is silently ignored.

```yaml
name: my-filter
language: tinygo-no-goroutines   # required — set during init
description: "Filter raw events"  # optional human-readable description
input-topic: raw-events
output-topics:
  - filtered-events
  - dead-letter-events            # up to 8 output topics total
env:
  MAX_VALUE: "1000"               # custom env vars — no REDPANDA_ prefix
compression: none                 # none | gzip | snappy | lz4 | zstd
```

## Language Templates

### Go (TinyGo)

`rpk transform init` generates this boilerplate `transform.go`:

```go
package main

import (
    "github.com/redpanda-data/redpanda/src/transform-sdk/go/transform"
)

func main() {
    // Register your transform function.
    // This is a good place to perform other setup too.
    transform.OnRecordWritten(doTransform)
}

// doTransform is where you read the record that was written, and then you can
// output new records that will be written to the destination topic
func doTransform(e transform.WriteEvent, w transform.RecordWriter) error {
    return w.Write(e.Record())
}
```

Key API:
- `transform.OnRecordWritten(fn)` — registers the callback; must be called from `main()`.
- `event.Record()` — returns the input `transform.Record` (Key, Value, Headers, Timestamp, Attrs).
- `writer.Write(record, ...opts)` — writes a record to the default (first) output topic.
- `writer.Write(record, transform.ToTopic("other-topic"))` — routes to a specific output topic (Go only).

Import path for the SDK: `github.com/redpanda-data/redpanda/src/transform-sdk/go/transform`

### Rust

Generated `src/main.rs`:

```rust
use redpanda_transform_sdk::*;
use std::error::Error;

fn main() {
    // Register your transform function.
    // This is a good place to perform other setup too.
    on_record_written(my_transform);
}

// my_transform is where you read the record that was written, and then you can
// return new records that will be written to the output topic
fn my_transform(event: WriteEvent, writer: &mut RecordWriter) -> Result<(), Box<dyn Error>> {
    writer.write(event.record)?;
    Ok(())
}
```

Generated `.cargo/config.toml`:

```toml
[build]
target = "wasm32-wasip1"

[target.wasm32-wasip1]
rustflags = ["-Ctarget-feature=+simd128"]
```

Key API:
- `on_record_written(fn)` — registers the callback.
- `event.record` — the input `BorrowedRecord` (key, value, headers).
- `writer.write(record)` — writes to the default output topic.
- `writer.write_with_options(record, WriteOptions::to_topic("other-topic"))` — routes to a specific topic (Rust only; requires SDK >= 1.1.0).

Add the SDK to Cargo.toml:

```toml
[dependencies]
redpanda-transform-sdk = "1.1.0"
```

### JavaScript

Generated `src/index.js`:

```js
import {onRecordWritten} from "@redpanda-data/transform-sdk";

onRecordWritten((event, writer) => {
  writer.write(event.record);
});
```

Key API:
- `onRecordWritten(fn)` — registers the callback.
- `event.record` — the input record.
- `writer.write(record)` — writes to the first output topic. Writing to a specific output topic is **not supported** in the JavaScript SDK.

Initialization code (outside the callback) runs once at startup; the callback runs per record.

### TypeScript

Generated `src/index.ts`:

```ts
import { onRecordWritten, OnRecordWrittenEvent, RecordWriter } from "@redpanda-data/transform-sdk"

onRecordWritten((event: OnRecordWrittenEvent, writer: RecordWriter) => {
  writer.write(event.record);
});
```

TypeScript is compiled via esbuild before packaging into Wasm.

## Building

```bash
rpk transform build [-- <extra-toolchain-flags>]
```

Run from the directory containing `transform.yaml`. The command:

1. Reads `transform.yaml` to detect the language.
2. Downloads and installs the buildpack (TinyGo or the JS Wasm VM) if not cached.
3. Runs the toolchain and produces `<name>.wasm` in the project root.

Language-specific build behavior:

| Language | Build command | Output |
|---|---|---|
| `tinygo-no-goroutines` | tinygo build `-target wasi -opt 2 -llvm-features +simd128 -no-debug -scheduler none` | `<name>.wasm` |
| `tinygo-with-goroutines` | Same with `-scheduler asyncify` (goroutine support, ~10x slower) | `<name>.wasm` |
| `rust` | `cargo build --release` (target `wasm32-wasip1` comes from generated `.cargo/config.toml`, not from the command line); artifact moved from `<target_dir>/wasm32-wasip1/release/<name>.wasm` | `<name>.wasm` |
| `javascript` / `typescript` | `npm run build` then merge JS bundle with Wasm VM via wasm-merge | `<name>.wasm` |

Pass extra toolchain flags after `--`:

```bash
# Enable TinyGo debug symbols (binary will be much larger)
rpk transform build -- -no-debug=false

# Pass extra Rust cargo flags
rpk transform build -- --features my-feature
```

## Error Handling

Transforms have at-least-once semantics. When an error escapes the Wasm VM, the VM restarts and reprocesses from the last committed offset.

**Strategy**: handle recoverable errors internally (log and skip); let write errors propagate.

```go
// Go
func doTransform(e transform.WriteEvent, w transform.RecordWriter) error {
    record := e.Record()
    if record.Value == nil {
        log.Println("skipping nil-value record")
        return nil              // do not crash the VM
    }
    return w.Write(record)     // propagate write errors
}
```

```rust
// Rust
fn my_transform(event: WriteEvent, writer: &mut RecordWriter) -> Result<(), Box<dyn Error>> {
    let record = event.record;
    if record.value().is_none() {
        // log and skip
        return Ok(());
    }
    writer.write(record)?;
    Ok(())
}
```

```js
// JavaScript
onRecordWritten((event, writer) => {
    if (!event.record.value) {
        console.error("skipping nil-value record");
        return;
    }
    writer.write(event.record);
});
```

## Accessing Environment Variables

Redpanda injects built-in variables and any custom variables from `transform.yaml` or `--var`:

```go
// Go — read in main(), runs once at startup
import "os"
inputTopic := os.Getenv("REDPANDA_INPUT_TOPIC")
firstOutput := os.Getenv("REDPANDA_OUTPUT_TOPIC_0")
myVal := os.Getenv("MY_VAR")
```

```rust
// Rust
use std::env;
let input_topic = env::var("REDPANDA_INPUT_TOPIC").unwrap_or_default();
```

```js
// JavaScript
const myVar = process.env.MY_VAR;
```

## Multi-Topic Routing (Go and Rust Only)

A single transform can route records to different output topics based on record content. This requires declaring all possible output topics in `transform.yaml` or `--output-topic`.

### Go — JSON content-based routing

```go
package main

import (
    "encoding/json"
    "github.com/redpanda-data/redpanda/src/transform-sdk/go/transform"
)

func main() {
    transform.OnRecordWritten(route)
}

func route(e transform.WriteEvent, w transform.RecordWriter) error {
    if json.Valid(e.Record().Value) {
        return w.Write(e.Record())                         // default output topic
    }
    return w.Write(e.Record(), transform.ToTopic("dead-letter"))
}
```

### Rust — route with WriteOptions (requires SDK >= 1.1.0)

```rust
use redpanda_transform_sdk::*;
use std::error::Error;

fn main() {
    on_record_written(route);
}

fn route(event: WriteEvent, writer: &mut RecordWriter) -> Result<(), Box<dyn Error>> {
    let value = event.record.value().unwrap_or_default();
    if serde_json::from_slice::<serde_json::Value>(value).is_ok() {
        writer.write(event.record)?;
    } else {
        writer.write_with_options(event.record, WriteOptions::to_topic("dead-letter"))?;
    }
    Ok(())
}
```

Note: the JavaScript SDK does **not** support writing to a specific output topic.

## Schema Registry Integration

The Go and Rust SDKs include a Schema Registry client for reading/writing schemas and encoding/decoding records with the 5-byte wire format (magic byte + 4-byte schema ID + data).

```go
// Go — import the SR sub-package
import "github.com/redpanda-data/redpanda/src/transform-sdk/go/transform/sr"

func main() {
    client := sr.NewClient()
    schema := sr.Schema{Schema: `{"type":"string"}`, Type: sr.TypeAvro}
    result, err := client.CreateSchema("my-topic-value", schema)
    // result.ID is the schema ID to prepend in the wire format
    transform.OnRecordWritten(doTransform)
}
```

```rust
// Rust — add redpanda-transform-sdk-sr to Cargo.toml
use redpanda_transform_sdk_sr::{SchemaRegistryClient, Schema, SchemaFormat};

fn main() {
    let mut client = SchemaRegistryClient::new();
    let schema = Schema::new(r#"{"type":"string"}"#.to_string(), SchemaFormat::Avro, vec![]);
    let result = client.create_schema("my-topic-value", schema).expect("schema registration");
    // result.id() is the schema ID
}
```

## Limitations

- No external network or disk access from within a transform.
- Only single-record transforms; no aggregations or joins.
- Maximum 8 output topics per transform.
- At-least-once delivery (duplicates possible on broker failure).
- Transactions API: only committed records are processed.
- JavaScript SDK: no native Node.js extensions, limited standard-library modules, no `writer.write` to specific topics.
- Maximum 128 custom environment variables, keys < 128 bytes, combined values < 2000 bytes. Keys must not start with `REDPANDA_`.
