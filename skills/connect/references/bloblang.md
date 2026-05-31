# Redpanda Connect: Bloblang

Bloblang is the mapping and transformation language built into Redpanda Connect. It is used in the `mapping`, `mutation`, and `bloblang` processors, and as interpolation expressions in component config fields (e.g. topic names, keys).

Interactive playground: https://play.benthos.dev

## Processor Names

All three processor names run Bloblang. Choose based on semantics:

| Processor | Behavior | Best for |
|---|---|---|
| `mapping` | Creates a fresh output document; input is immutable | Major shape changes |
| `mutation` | Transforms input document in place | Minor additions/deletions |
| `bloblang` | Alias for `mapping`; will eventually be deprecated | Legacy configs |

```yaml
pipeline:
  processors:
    # mapping: builds a new document
    - mapping: |
        root.id = this.user_id
        root.name = this.display_name

    # mutation: modifies the document in place
    - mutation: |
        root.ts = now()
        root.secret = deleted()
```

## Core Concepts

### `root` and `this`

- `root` refers to the output document being built (mutable during the mapping)
- `this` refers to the input (source) document (always the original, unchanged)

```coffeescript
root.foo = this.bar        # copy bar from input to foo in output
root.bar = this.foo        # swap values (both refer to original input)
```

### Non-structured data

If the message is raw bytes or a scalar, reference it with `root` on the right-hand side:

```coffeescript
root = root.uppercase()    # uppercases a plain-text message
root = content().string()  # same using the content() function
```

### Whole document assignment

```coffeescript
root = this                   # copy entire input to output (identity)
root = this.merge({"ts": now()})  # merge a new field in
```

## Assignment and Paths

Paths use dot notation. Numeric segments access array elements. Quote identifiers containing special characters.

```coffeescript
root.foo = "hello"
root.nested.value = this.data.0.score
root."field.with.dots" = this.other
```

## Deletion

```coffeescript
root = this
root.internal_id = deleted()
root.sensitive = deleted()
```

## Variables

Variables begin with `$` and are not included in output:

```coffeescript
let user = this.profile.user
root.display = $user.name
root.email = $user.contact.email
```

## Metadata

Access and set Kafka/Connect metadata (headers, topic, partition, etc.):

```coffeescript
# Read
root.topic = meta("kafka_topic")
root.partition = meta("kafka_partition")
root.offset = meta("kafka_offset")

# Set metadata that downstream components can read;
# whether it is emitted as a Kafka record header depends on the output's
# `metadata` include_patterns config.
meta("output_key") = this.id
```

## Conditionals

```coffeescript
root.tier = if this.score >= 100 {
  "premium"
} else if this.score >= 50 {
  "standard"
} else {
  "basic"
}

# Ternary-style (same operator)
root.active = this.status == "enabled"
```

## Coalescing / Fallback

The pipe `|` operator returns the first non-null, non-error value:

```coffeescript
root.name = this.display_name | this.username | "unknown"
root.url = this.canonical_url | this.href | this.link
```

## Literals

```coffeescript
root.str = "hello world"
root.num = 42
root.float = 3.14
root.flag = true
root.nothing = null
root.arr = [1, 2, 3]
root.obj = {"key": "value"}
```

## String Operations

```coffeescript
root.upper = this.name.uppercase()
root.lower = this.name.lowercase()
root.trimmed = this.text.trim()
root.slug = this.title.replace_all(" ", "-").lowercase()
root.prefix = "prefix_" + this.name
root.len = this.text.length()
root.contains = this.text.contains("keyword")   # returns bool
root.split = this.csv.split(",")
```

## Numeric Operations

```coffeescript
root.rounded = this.amount.round()
root.floored = this.amount.floor()
root.ceiled = this.amount.ceil()
root.abs = this.delta.abs()
root.cents = (this.dollars * 100).int()
```

## Array Operations

```coffeescript
# Filter (returns a new array)
root.active = this.users.filter(u -> u.active == true)

# Map each element
root.ids = this.orders.map_each(o -> o.id)

# Count
root.n = this.items.length()

# Index access
root.first = this.items.0
root.last = this.items.-1

# Fold (reduce)
root.total = this.prices.fold(0, item -> item.tally + item.value)

# Contains
root.has_admin = this.roles.contains("admin")

# Flatten
root.flat = this.nested.flatten()

# Unique
root.unique_ids = this.ids.unique()

# Sort
root.sorted = this.scores.sort()

# Slice
root.top3 = this.scores.slice(0, 3)
```

## Object / Map Operations

```coffeescript
root.keys = this.config.keys()
root.values = this.config.values()
root.exists = this.config.exists("timeout")

# Merge two objects
root = this.base.merge(this.overrides)

# Delete a key
root = this.data
root.temp = deleted()
```

## JSON and Content

```coffeescript
# Parse JSON string field into structured data
root = this.body.parse_json()

# Encode as JSON string
root.payload = this.data.format_json()

# Raw bytes content of the message
root.raw = content().string()
root.size = content().length()
```

## Dates and Times

```coffeescript
root.ts = now()                           # current timestamp (RFC3339)
root.epoch = timestamp_unix()             # current Unix epoch (seconds)
root.epoch_ms = timestamp_unix_milli()    # current Unix epoch (ms)
root.formatted = now().format_timestamp("2006-01-02T15:04:05Z07:00")
root.day = this.event_time.parse_timestamp("2006-01-02T15:04:05Z07:00").format_timestamp("2006-01-02")
```

## UUIDs and Random

```coffeescript
root.id = uuid_v4()
root.rand = random_int()
root.coin = random_int() % 2 == 0
```

## Encoding

```coffeescript
root.b64 = this.data.encode("base64")
root.decoded = this.encoded.decode("base64")
root.hashed = this.password.hash("sha256")
root.hex = this.bytes.encode("hex")
```

## Error Handling in Bloblang

```coffeescript
# Provide a fallback value if an expression errors
root.value = this.maybe_json.parse_json().catch({})

# Capture the error message
root.err = error()   # (only meaningful inside catch processor)

# Throw an explicit error
root = if this.type == null { throw("type field is required") } else { this }
```

## Interpolation in Config Fields

Use `${! bloblang_expr }` anywhere a string field supports interpolation:

```yaml
output:
  redpanda:
    topic: events-${! meta("kafka_partition") }
    key: ${! json("user_id") }
    timestamp_ms: ${! timestamp_unix_milli() }
```

## Practical Examples

### Add computed fields and delete sensitive data

```coffeescript
root = this
root.processed_at = now()
root.request_id = uuid_v4()
root.amount_cents = (this.amount_usd * 100).round().int()
root.password = deleted()
root.internal_token = deleted()
```

### Route based on content (used with `switch` output)

The check field in a switch output uses Bloblang boolean expressions:

```yaml
output:
  switch:
    cases:
      - check: this.event_type == "purchase"
        output:
          redpanda:
            seed_brokers: ["localhost:9092"]
            topic: purchases
      - check: this.event_type.has_prefix("error_")
        output:
          redpanda:
            seed_brokers: ["localhost:9092"]
            topic: errors
```

### Flatten nested events into top-level records

```coffeescript
root = this.header
root.events = this.body.events
root.source = meta("kafka_topic")
root.partition = meta("kafka_partition").int()
```

### Parse an embedded JSON string

```coffeescript
root = this
root.payload = this.raw_payload.parse_json().catch({})
root.event_count = root.payload.events.length()
```

### Filter and transform an array

```coffeescript
root.premium_orders = this.orders
  .filter(o -> o.total > 1000)
  .map_each(o -> {
    "order_id": o.id,
    "customer": o.customer_name,
    "total_usd": o.total
  })
```

### Conditional field inclusion

```coffeescript
root = this
root.discount = if this.loyalty_tier == "gold" {
  this.total * 0.1
} else {
  deleted()
}
```
