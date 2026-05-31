# Kafka Client Compatibility

## Protocol Compatibility

Redpanda is compatible with Apache Kafka clients version **0.11 or later**. The Kafka wire protocol is implemented natively in C++. Clients auto-negotiate protocol versions; Redpanda supports the range it implements for each API (see core-concepts.md for the API version table).

## Validated Clients

The following clients are validated by Redpanda Data (sourced from the Kafka Compatibility docs):

| Language | Client | Notes |
|---|---|---|
| Java | [Apache Kafka Java Client](https://github.com/apache/kafka) | Kafka 4.x validated with ducktape + chaos test suites |
| C/C++ | [librdkafka](https://github.com/confluentinc/librdkafka) | Foundation for confluent-kafka-python, confluent-kafka-dotnet, etc. |
| Go | [franz-go](https://github.com/twmb/franz-go) | Used by rpk internally; first-class Redpanda client |
| Python | [kafka-python-ng](https://pypi.org/project/kafka-python-ng) | Fork of kafka-python with ongoing maintenance |
| Rust | [kafka-rust](https://github.com/kafka-rust/kafka-rust) | |
| Node.js | [KafkaJS](https://kafka.js.org) | |
| Node.js | [confluent-kafka-javascript](https://github.com/confluentinc/confluent-kafka-javascript) | Based on librdkafka |

Clients based on librdkafka (e.g., `confluent-kafka-python`, `confluent-kafka-dotnet`, Sarama in Go for some configurations) are compatible subject to the limitations below.

Always use the **latest supported version** of any client.

## Connection Basics

### Bootstrap Brokers

All clients require at least one bootstrap broker address. The broker returns full cluster metadata including all brokers and partition leaders. You do not need to list every broker — two or three provides adequate redundancy.

Default Kafka port: **9092**

```
# rpk
--brokers broker1:9092,broker2:9092

# Java / Python / Node
bootstrap.servers = "broker1:9092,broker2:9092"

# franz-go (Go)
kgo.SeedBrokers("broker1:9092", "broker2:9092")
```

### Plaintext (No Auth)

```bash
# rpk
rpk topic list --brokers localhost:9092

# Java
props.put("bootstrap.servers", "localhost:9092");
props.put("security.protocol", "PLAINTEXT");
```

### SASL/SCRAM (Common for Redpanda Cloud and Secured Self-Managed)

Redpanda supports `SCRAM-SHA-256` and `SCRAM-SHA-512`. One mechanism per user — a user cannot have both simultaneously.

```bash
# rpk
rpk topic list \
  --brokers seed.cloud.redpanda.com:9092 \
  -X tls.enabled=true \
  -X sasl.mechanism=SCRAM-SHA-256 \
  -X user=myuser \
  -X pass=mypassword
```

```java
// Java
props.put("security.protocol", "SASL_SSL");
props.put("sasl.mechanism", "SCRAM-SHA-256");
props.put("sasl.jaas.config",
    "org.apache.kafka.common.security.scram.ScramLoginModule required " +
    "username=\"myuser\" password=\"mypassword\";");
```

```python
# kafka-python-ng
from kafka import KafkaProducer
producer = KafkaProducer(
    bootstrap_servers=['seed.cloud.redpanda.com:9092'],
    security_protocol='SASL_SSL',
    sasl_mechanism='SCRAM-SHA-256',
    sasl_plain_username='myuser',
    sasl_plain_password='mypassword',
)
```

```go
// franz-go
import (
    "github.com/twmb/franz-go/pkg/kgo"
    "github.com/twmb/franz-go/pkg/sasl/scram"
)

cl, _ := kgo.NewClient(
    kgo.SeedBrokers("seed.cloud.redpanda.com:9092"),
    kgo.SASL(scram.Auth{
        User: "myuser",
        Pass: "mypassword",
    }.AsMechanism()),
)
```

```javascript
// KafkaJS
const { Kafka } = require('kafkajs')
const kafka = new Kafka({
  clientId: 'my-app',
  brokers: ['seed.cloud.redpanda.com:9092'],
  ssl: true,
  sasl: {
    mechanism: 'scram-sha-256',
    username: 'myuser',
    password: 'mypassword',
  },
})
```

### TLS Without SASL (mTLS or one-way TLS)

```bash
# rpk with TLS only (no SASL)
rpk topic list \
  --brokers broker:9092 \
  -X tls.enabled=true \
  -X tls.ca=/path/to/ca.crt
```

```java
// Java one-way TLS
props.put("security.protocol", "SSL");
props.put("ssl.truststore.location", "/path/to/truststore.jks");
props.put("ssl.truststore.password", "changeit");
```

## Per-Language Connection Snippets

### Java (Apache Kafka Client)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
// SASL/SCRAM
props.put("security.protocol", "SASL_SSL");
props.put("sasl.mechanism", "SCRAM-SHA-256");
props.put("sasl.jaas.config",
    "org.apache.kafka.common.security.scram.ScramLoginModule required " +
    "username=\"user\" password=\"pass\";");
// Producer-specific
props.put("acks", "all");
props.put("enable.idempotence", "true");
props.put("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
props.put("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");
KafkaProducer<String, String> producer = new KafkaProducer<>(props);
```

### Go (franz-go)

```go
import (
    "github.com/twmb/franz-go/pkg/kgo"
    "github.com/twmb/franz-go/pkg/sasl/scram"
)

cl, err := kgo.NewClient(
    kgo.SeedBrokers("localhost:9092"),
    // SASL/SCRAM — omit for plaintext
    kgo.SASL(scram.Auth{User: "user", Pass: "pass"}.AsMechanism()),
    // Producer settings
    kgo.ProducerBatchCompression(kgo.Lz4Codec()),
)
```

### Python (kafka-python-ng)

> Note: kafka-python-ng does **not** implement idempotent producers. The `enable_idempotence` kwarg does not exist in kafka-python-ng and will raise a `TypeError`. If idempotent producers are required, use `confluent-kafka-python` (librdkafka-based) instead.

```python
from kafka import KafkaProducer, KafkaConsumer

# Producer (kafka-python-ng does not support idempotence; omit enable_idempotence)
producer = KafkaProducer(
    bootstrap_servers=['localhost:9092'],
    security_protocol='SASL_SSL',
    sasl_mechanism='SCRAM-SHA-256',
    sasl_plain_username='user',
    sasl_plain_password='pass',
    acks='all',
)

# Consumer
consumer = KafkaConsumer(
    'my-topic',
    bootstrap_servers=['localhost:9092'],
    security_protocol='SASL_SSL',
    sasl_mechanism='SCRAM-SHA-256',
    sasl_plain_username='user',
    sasl_plain_password='pass',
    group_id='my-group',
    auto_offset_reset='earliest',
)
```

### Rust (kafka-rust)

```rust
// Cargo.toml: kafka = "0.10"
use kafka::client::{KafkaClient, SecurityConfig};
use kafka::producer::{Producer, Record};

let mut client = KafkaClient::new(vec!["localhost:9092".to_owned()]);
client.load_metadata_all().unwrap();

let mut producer = Producer::from_client(client)
    .create()
    .unwrap();

producer.send(&Record::from_value("my-topic", b"hello")).unwrap();
```

### Node.js (KafkaJS)

```javascript
const { Kafka, Partitioners } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'my-app',
  brokers: ['localhost:9092'],
  // ssl: true,  // add for TLS
  // sasl: { ... },  // add for SASL
});

// Producer
const producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,
});
await producer.connect();
await producer.send({
  topic: 'my-topic',
  messages: [{ key: 'k1', value: 'hello' }],
});
await producer.disconnect();

// Consumer
const consumer = kafka.consumer({ groupId: 'my-group' });
await consumer.connect();
await consumer.subscribe({ topic: 'my-topic', fromBeginning: true });
await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    console.log(`offset=${message.offset} value=${message.value}`);
  },
});
```

### C/C++ (librdkafka)

```c
#include <librdkafka/rdkafka.h>

rd_kafka_conf_t *conf = rd_kafka_conf_new();
rd_kafka_conf_set(conf, "bootstrap.servers", "localhost:9092", NULL, 0);
rd_kafka_conf_set(conf, "security.protocol", "SASL_SSL", NULL, 0);
rd_kafka_conf_set(conf, "sasl.mechanism", "SCRAM-SHA-256", NULL, 0);
rd_kafka_conf_set(conf, "sasl.username", "user", NULL, 0);
rd_kafka_conf_set(conf, "sasl.password", "pass", NULL, 0);
rd_kafka_conf_set(conf, "acks", "all", NULL, 0);

char errstr[512];
rd_kafka_t *rk = rd_kafka_new(RD_KAFKA_PRODUCER, conf, errstr, sizeof(errstr));
```

## Known Compatibility Notes and Limitations

### Multiple SCRAM Mechanisms

Redpanda supports only **one SASL/SCRAM mechanism per user**: either `SCRAM-SHA-256` or `SCRAM-SHA-512`. A user cannot have both simultaneously. This differs from Kafka's behavior of supporting multiple SCRAM credentials per user.

### KIP-890 (Transactions V2)

Redpanda does not implement the server-side portion of KIP-890. Kafka 4.x clients automatically detect that Transactions V2 is unsupported and fall back to the original transaction protocol. This is transparent — no client-side configuration is needed. Per-transaction epoch bumping (part of V2) does not apply.

### Quotas

Redpanda supports quotas **per client and per client group** using `AlterClientQuotas` and `DescribeClientQuotas` APIs. It does not support per-user bandwidth and API request rate quotas in the same way Kafka does.

### HTTP Proxy (pandaproxy)

Redpanda's HTTP Proxy (pandaproxy) is designed for producing and consuming data only. It does **not** support topic creation, ACL management, or other administrative functions through the HTTP REST interface.

### `delete.retention.ms` in Tiered Storage (Cloud)

For Redpanda Cloud with Tiered Storage topics, `delete.retention.ms` is not supported in the same way as Kafka. Tombstone markers in Tiered Storage topics are removed in accordance with normal topic retention, and only if the cleanup policy is `delete` or `compact,delete`.

## Choosing a Client

| Use case | Recommended client |
|---|---|
| Go applications | **franz-go** (used by rpk; first-class Redpanda support) |
| Java / JVM | **Apache Kafka Java Client** (latest 4.x) |
| Python | **kafka-python-ng** or **confluent-kafka-python** (librdkafka-based) |
| C/C++ | **librdkafka** |
| Node.js | **KafkaJS** or **confluent-kafka-javascript** |
| Rust | **kafka-rust** |
| CLI / scripting | **rpk** |
