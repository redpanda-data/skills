# rpk topic consume — Reference

`rpk topic consume` reads records from one or more Redpanda topics and
prints them to stdout, formatted according to `--format`. Every flag documented
here is verified against `src/go/rpk/pkg/cli/topic/consume.go`.

## Synopsis

```bash
rpk topic consume <TOPICS...> [flags]
```

Multiple topics can be listed. With `-r`, topic names are treated as regular
expressions. The command runs continuously until Ctrl-C, `--num` is reached,
or a stop-offset is consumed.

## Flags

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--format` | `-f` | string | `json` | Output format; `json` for structured JSON, or a percent-escape string |
| `--offset` | `-o` | string | `start` | Where to start (and optionally stop) consuming — see Offsets section |
| `--partitions` | `-p` | int32Slice | | Comma-separated partition list to consume from |
| `--group` | `-g` | string | | Consumer group ID; incompatible with `--partitions` |
| `--balancer` | `-b` | string | `cooperative-sticky` | Group balancer: `range`, `roundrobin`, `sticky`, `cooperative-sticky` |
| `--num` | `-n` | int | `0` | Stop after N records (0 = unbounded) |
| `--regex` | `-r` | bool | false | Parse topic names as regular expressions |
| `--read-committed` | | bool | false | Only read committed offsets (for transactional workloads) |
| `--print-control-records` | | bool | false | Print Kafka control records (e.g. transaction markers) |
| `--pretty-print` | | bool | true | Pretty-print JSON output over multiple lines |
| `--meta-only` | | bool | false | Print metadata (`value_size`) instead of record value (only affects `-f json` output) |
| `--use-schema-registry` | | string | | Decode with schema registry: `key`, `value`, or both (default when flag given without value) |
| `--rack` | | string | | Rack for follower-fetching (consumer rack awareness) |
| `--fetch-max-bytes` | | int32 | `1048576` | Max bytes per fetch request per broker |
| `--fetch-max-wait` | | duration | `5s` | Max time to wait for broker reply on fetch |
| `--fetch-max-partition-bytes` | | int32 | `1048576` | Max bytes per partition per fetch |

## Output Format

### Default JSON format (`-f json`)

Each record is printed as a JSON object:

```json
{
  "topic": "orders",
  "key": "order-42",
  "value": "{\"id\":42,\"status\":\"shipped\"}",
  "headers": [{"key": "source", "value": "api"}],
  "timestamp": 1717000000000,
  "partition": 2,
  "offset": 154
}
```

Fields:
- `topic` — topic name
- `key` — record key; field is **omitted** (not present in JSON) when the key is empty (`omitempty`)
- `value` — record value as string; field is **omitted entirely** (not present in JSON) for tombstone (null-value) records (`omitempty`)
- `value_size` — byte count of value; only present when `--meta-only` is set (`omitempty`)
- `headers` — array of `{key, value}` objects; field is **omitted** when there are no headers (`omitempty`)
- `timestamp` — Unix milliseconds
- `partition` — partition number
- `offset` — record offset

Control flags that affect JSON output:
- `--pretty-print` (default true): multiline indented output
- `--meta-only`: omits `value`, adds `value_size` (only affects `-f json` output)

### Percent-escape format

Any string other than `json` is treated as a percent-escape format template.

**Record field tokens:**

| Token | Prints |
|---|---|
| `%t` | topic |
| `%T` | topic length |
| `%k` | key |
| `%K` | key length |
| `%v` | value |
| `%V` | value length |
| `%h` | header spec |
| `%H` | number of headers |
| `%p` | partition |
| `%o` | offset |
| `%e` | leader epoch |
| `%d` | timestamp (see below) |
| `%a` | record attributes (see below) |
| `%x` | producer ID |
| `%y` | producer epoch |
| `%[` | partition log start offset |
| `%\|` | partition last stable offset |
| `%]` | partition high watermark |
| `%i` | number of records formatted so far |
| `%{` | literal `{` |
| `%}` | literal `}` |
| `%%` | literal `%` |

**Number modifiers** (inside braces after numeric tokens):

`ascii` (default), `hex64/32/16/8/4`, `big64/32/16/8`, `little64/32/16/8`,
`byte`, `bool`

**Text modifiers** (inside braces after text tokens):

| Modifier | Effect |
|---|---|
| `hex` | Hex-encode the bytes |
| `base64` | Base64-encode (standard encoding) |
| `base64raw` | Base64-encode (raw standard encoding) |
| `unpack[<bBhH>iIqQc.$]` | Unpack binary data as typed values |

**Timestamp (`%d`) modifiers:**

```
%d                       # milliseconds (default)
%d{go[2006-01-02T15:04:05Z07:00]}    # Go time format
%d{strftime[%F]}         # strftime format
```

**Attribute (`%a`) modifiers:**

```
%a{compression}          # text: "none", "gzip", etc.
%a{compression;number}   # integer codec number
%a{timestamp-type}       # -1/0/1
%a{transactional-bit}    # 0 or 1
%a{control-bit}          # 0 or 1
```

**Headers:**

```
%h{ %k=%v{hex} }         # each header: space-key=hex-value-space
```

### Format examples

```bash
# Key and value on one line
rpk topic consume orders -f '%k %v\n'

# Key length as 4 big-endian bytes then key as hex
rpk topic consume orders -f '%K{big32}%k{hex}'

# Unpack binary value (little-endian uint32 then string)
rpk topic consume orders -f '%v{unpack[is$]}'

# Human-readable timestamp
rpk topic consume orders -f '%t\t%o\t%d{go[2006-01-02T15:04:05Z]}\t%v\n'
```

## Offsets (`--offset`)

The `--offset` flag (short `-o`) controls both where to start consuming and,
optionally, where to stop.

### Symbolic and absolute forms

| Value | Behaviour |
|---|---|
| `start` or `oldest` | Consume from the earliest available offset |
| `end` or `newest` | Consume from the current end (new records only) |
| `:end` | Start from beginning; stop at the current end offset |
| `+N` | Start `N` after the current log start offset |
| `-N` | Start `N` before the current end offset |
| `N` | Start at absolute offset N |
| `N:` | Same as `N` |
| `:N` | Start from beginning; stop at offset N |
| `N1:N2` | Start at N1; stop at N2 |

### Timestamp-based offsets (prefix with `@`)

Start from the first offset at or after a timestamp:

| Value | Parsed as |
|---|---|
| `@1717000000000` | 13-digit Unix millisecond |
| `@1717000000` | 10-digit Unix second |
| `@2024-06-01` | `YYYY-MM-DD` (UTC) |
| `@2024-06-01T12:00:00Z` | RFC3339 (UTC) |
| `@-1h` | 1 hour before now |
| `@-30m:end` | From 30 minutes ago until current end |
| `@2024-06-01:1h` | 1 hour window starting at 2024-06-01 |
| `@-48h:-24h` | From 2 days ago until 1 day ago |

```bash
# Consume from 1 hour ago until now
rpk topic consume orders -o @-1h:end

# Consume from a specific date
rpk topic consume orders -o @2024-01-01

# Consume a 1-hour window on a specific day
rpk topic consume orders -o @2024-02-14:1h
```

## Consumer Groups

```bash
rpk topic consume orders -g my-service
```

- `--group`/`-g`: join a named consumer group; offsets are committed automatically
- `--balancer`/`-b`: partition assignment strategy (default `cooperative-sticky`)
- Incompatible with `--partitions`
- Incompatible with stop-offset forms like `:end` or `N:N`

```bash
# Cooperative-sticky (default)
rpk topic consume orders events -g analytics-svc

# Round-robin balancer
rpk topic consume orders -g analytics-svc -b roundrobin
```

## Schema Registry decoding

```bash
# Decode both key and value
rpk topic consume orders --use-schema-registry

# Decode value only
rpk topic consume orders --use-schema-registry=value

# Decode key only
rpk topic consume orders --use-schema-registry=key
```

rpk reads the Confluent wire-format schema ID prefix from each message,
fetches the schema from the Schema Registry, and decodes the bytes.
Schema Registry URL is taken from the active profile or `-X registry.hosts=...`.

## Worked Examples

```bash
# 1. Consume all records from the beginning and exit at current end
rpk topic consume orders -o :end

# 2. Tail (new records only)
rpk topic consume orders -o end

# 3. Consume exactly 10 records from the beginning
rpk topic consume orders -o start -n 10

# 4. Specific partitions
rpk topic consume orders -p 0,1 -o start

# 5. Time-based range
rpk topic consume orders -o @-24h:end

# 6. Consumer group, only committed offsets (for transactions)
rpk topic consume orders -g billing --read-committed

# 7. Print only key=value pairs
rpk topic consume orders -f '%k=%v\n'

# 8. Count records in a topic
rpk topic consume orders -o :end -f '' | wc -l

# 9. Multiple topics with regex
rpk topic consume -r '^orders.*' -o start

# 10. Include transaction control records
rpk topic consume orders --print-control-records

# 11. Schema Registry decode + pretty JSON
rpk topic consume orders --use-schema-registry=value

# 12. Meta-only (print size without fetching full value)
rpk topic consume large-topic --meta-only
```

## Consumer Group Balancers

| Balancer | Description |
|---|---|
| `range` | Assigns consecutive partition ranges to members |
| `roundrobin` | Distributes partitions evenly in round-robin order |
| `sticky` | Minimizes partition movement on rebalance |
| `cooperative-sticky` | Default; incremental cooperative rebalance, minimizes stop-the-world |

## Notes

- The command runs continuously until Ctrl-C unless `--num` or a stop-offset is set.
- Tombstone records (null value) print with `value` field omitted entirely from the JSON object (the field is not present, not set to `null`).
- `--print-control-records` is required to see Kafka transaction markers.
- When using `--group`, the `--partitions` flag is disallowed.
- `--read-committed` fetches only up to the last stable offset (LSO); unaborted transactional records appear only after commit.
