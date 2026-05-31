# rpk topic produce — Reference

`rpk topic produce` reads records from stdin, parses them according to
`--format`, and writes them to a Redpanda topic over the Kafka protocol.
Every flag documented here is verified against
`src/go/rpk/pkg/cli/topic/produce.go`.

## Synopsis

```bash
rpk topic produce [TOPIC] [flags]
```

The topic can be given as a positional argument or encoded in the input stream
via `%t`. A parsed topic takes precedence over the argument.

## Flags

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--format` | `-f` | string | `%v\n` | Input record format (percent-escape syntax) |
| `--key` | `-k` | string | | Fixed key for every record (parsed `%k` takes precedence) |
| `--header` | `-H` | stringArray | | Repeatable `key:value` headers added to every record |
| `--partition` | `-p` | int32 | `-1` | Direct-produce to this partition; also enables `%p` in format |
| `--compression` | `-z` | string | `snappy` | `none`, `gzip`, `snappy`, `lz4`, `zstd` |
| `--acks` | | int | `-1` | `-1`=all ISR, `0`=none, `1`=leader |
| `--tombstone` | `-Z` | bool | false | Treat empty-string value as null (tombstone) |
| `--schema-id` | | string | | Schema ID (or `topic`) to encode the record **value** |
| `--schema-key-id` | | string | | Schema ID (or `topic`) to encode the record **key** |
| `--schema-type` | | string | | Fully-qualified Protobuf message type name for value |
| `--schema-key-type` | | string | | Fully-qualified Protobuf message type name for key |
| `--allow-auto-topic-creation` | | bool | false | Auto-create the topic if it does not exist |
| `--delivery-timeout` | | duration | `0` | Per-record delivery timeout; if non-zero, minimum 1s |
| `--max-message-bytes` | | int32 | `-1` | Max record-batch bytes before compression |
| `--output-format` | `-o` | string | `Produced to partition %p at offset %o with timestamp %d.\n` | Success line printed to stdout after each record |

## Format Language (`--format`)

The format string is parsed left-to-right. Each time the full pattern is
matched, one record is produced and parsing restarts. The default `%v\n`
reads everything up to a newline as the record value.

### Percent escapes (input)

| Token | Reads into |
|---|---|
| `%t` | topic |
| `%T` | topic length |
| `%k` | key |
| `%K` | key length |
| `%v` | value |
| `%V` | value length |
| `%h` | header key/value spec |
| `%H` | number of headers |
| `%p` | partition (requires non-negative `--partition`) |
| `%%` | literal `%` |
| `%{` | literal `{` |
| `%}` | literal `}` |

### Modifiers

Modifiers appear inside braces after a percent-escape, e.g. `%v{hex}`.

**Number modifiers** (for `%T`, `%K`, `%V`, `%H`, `%p`):

| Modifier | Meaning |
|---|---|
| `ascii` | Parse decimal digits (default) |
| `hex64`, `hex32`, `hex16`, `hex8`, `hex4` | Hex-encoded integer of N characters |
| `big64`, `big32`, `big16`, `big8` | Big-endian N-byte integer (`big8` is an alias for `byte`) |
| `little64`, `little32`, `little16`, `little8` | Little-endian N-byte integer (`little8` is an alias for `byte`) |
| `byte` | One-byte integer |
| `<digits>` | Exact byte count, e.g. `%K{4}` reads exactly 4 bytes |
| `bool` | `"true"` → 1, `"false"` → 0 |

**Text modifiers** (for `%t`, `%k`, `%v`):

| Modifier | Meaning |
|---|---|
| `hex` | Read text then hex-decode it |
| `base64` | Read text then base64-decode it (standard encoding) |
| `re` | Read text matching a regular expression, e.g. `%v{re#...?#}` |
| `json` | Read text as JSON then compact it |

### Headers

Headers use an internal key/value spec inside `%h{...}`:

```
%H{3}%h{ %k=%v }
```

Reads exactly 3 headers, each surrounded by a space and separated by `=`.

### Common format examples

```bash
# Key and value separated by a space, terminated by newline
-f '%k %v\n'

# 4-byte length-prefixed topic, key, and value
-f '%T{4}%K{4}%V{4}%t%k%v'

# Key and JSON-compacted value
-f '%k %v{json}'

# Value matching a 2- or 3-character regex
-f '%v{re#...?#}\n'

# Big-endian uint16 key length, literal " foo ", then key bytes
-f '%K{big16} foo %k'
```

## Examples

### Simple value from stdin

```bash
# Type or pipe lines; each newline produces a record
echo "hello world" | rpk topic produce my-topic
```

### Fixed key

```bash
echo '{"event":"login"}' | rpk topic produce events -k user-123
```

### Key and value from the same line

```bash
printf 'user-1 {"action":"buy"}\nuser-2 {"action":"sell"}\n' \
  | rpk topic produce orders -f '%k %v\n'
```

### Multiple headers

```bash
echo "payload" | rpk topic produce audit \
  -k request-id \
  -H source:api-gateway \
  -H env:production
```

### Specific partition and compression

```bash
echo "data" | rpk topic produce logs -p 2 -z zstd
```

### All ISR acks vs. leader ack

```bash
# Default: all ISR acks
echo "important" | rpk topic produce orders

# Leader ack only (lower latency, higher risk)
echo "metric" | rpk topic produce metrics --acks 1
```

### Tombstone record

```bash
# Produces a null-value record for key "user-42" (for compacted topics)
rpk topic produce users -k user-42 -Z
```

An empty-string value without `-Z` is NOT a tombstone; `-Z` is required.

### Produce to multiple topics (via %t in format)

```bash
printf 'orders {"id":1}\nevents {"type":"login"}\n' \
  | rpk topic produce -f '%t %v\n'
```

### Schema Registry encoding (value)

Encode the value using the latest schema registered under subject `orders-value`
(TopicName strategy):

```bash
echo '{"id":1,"amount":99.99}' \
  | rpk topic produce orders --schema-id=topic
```

Encode using a specific schema ID:

```bash
echo '{"id":1,"amount":99.99}' \
  | rpk topic produce orders --schema-id=42
```

Encode both key and value using TopicName strategy:

```bash
echo '{"orderId":1} {"id":1,"amount":99.99}' \
  | rpk topic produce orders -f '%k{json} %v{json}' \
      --schema-key-id=topic --schema-id=topic
```

Protobuf with a specific message type:

```bash
echo '{"name":"Alice"}' \
  | rpk topic produce users --schema-id=7 --schema-type=com.example.User
```

### Reading from a file

```bash
cat records.txt | rpk topic produce orders -f '%k %v\n'
```

## Output on success

By default, for each produced record, rpk writes:

```
Produced to partition 2 at offset 154 with timestamp 1717000000000.
```

You can customise this with `--output-format`, which uses the same
percent-escape tokens as `rpk topic consume --format` (e.g. `%p` partition,
`%o` offset, `%d` timestamp, `%k` key).

## Compression codecs

| Value | Notes |
|---|---|
| `none` | No compression |
| `gzip` | Good compression, higher CPU |
| `snappy` | Default; fast + reasonable ratio |
| `lz4` | Very fast |
| `zstd` | Best ratio; higher CPU |

## Acks

| Value | Behaviour |
|---|---|
| `-1` | Default; wait for all ISR to acknowledge (idempotent) |
| `0` | Fire-and-forget; no acknowledgement |
| `1` | Leader ack only; disables idempotent write |

## Deprecated flags

The following flags exist on `rpk topic produce` for backwards compatibility but are deprecated and have no effect:

| Flag | Short | Note |
|---|---|---|
| `--num` | `-n` | Deprecated; invoke rpk multiple times to repeat records |
| `--jvm-partitioner` | `-j` | Deprecated; jvm-partitioner is now the default |
| `--timestamp` | `-t` | Deprecated; timestamps are set automatically when producing |
