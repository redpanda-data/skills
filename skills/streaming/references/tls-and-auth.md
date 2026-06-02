# TLS and Authentication

Redpanda's Kafka listener supports three authentication modes: unauthenticated plaintext, SASL (SCRAM-SHA-256 or SCRAM-SHA-512), and mutual TLS (mTLS). TLS can be layered with or without SASL; mTLS is an alternative to SASL that uses the client certificate itself as the identity credential. Multiple listeners on different ports can use different authentication methods simultaneously.

For SASL/SCRAM connection snippets see [Clients and Compatibility](clients-and-compatibility.md). This reference covers TLS certificate loading, mTLS, broker listener configuration, and principal extraction from client certificates.

## TLS Concepts

**One-way TLS (server certificate only)**: The client verifies the broker's identity by checking its certificate against a trusted CA. The broker does not require a certificate from the client. This prevents eavesdropping and man-in-the-middle attacks, but identity is still established by credentials (SASL username/password or none at all).

**Mutual TLS (mTLS)**: Both parties present certificates. The broker verifies the client's certificate against a trusted CA, and the client verifies the broker's certificate. When `authentication_method: mtls_identity` is set on a Redpanda listener, the verified client certificate becomes the identity credential — no SASL credentials are needed. The "principal" is extracted from the certificate's Subject Distinguished Name (DN).

**Principal**: In Kafka's security model, a principal is the user identity against which ACLs are evaluated. For SASL, the principal is the username. For mTLS, the principal is derived from the client certificate's Subject DN by `kafka_mtls_principal_mapping_rules`. ACL entries use the form `User:<principal>` regardless of the authentication method.

## Client TLS Configuration

### Java (Apache Kafka Client)

Java clients use JKS or PKCS12 keystores/truststores. Use `security.protocol=SSL` for TLS without SASL, `SASL_SSL` for TLS with SASL.

| Property | Purpose |
|---|---|
| `ssl.truststore.location` | Path to JKS or PKCS12 truststore containing the CA certificate |
| `ssl.truststore.password` | Password for the truststore |
| `ssl.truststore.type` | `JKS` (default) or `PKCS12` |
| `ssl.keystore.location` | Path to keystore containing the client certificate + key (mTLS only) |
| `ssl.keystore.password` | Password for the keystore (mTLS only) |
| `ssl.key.password` | Password for the private key inside the keystore, if different from keystore password (mTLS only) |
| `security.protocol` | `SSL` for TLS-only, `SASL_SSL` for TLS+SASL |

**One-way TLS (server cert verification only):**

```java
Properties props = new Properties();
props.put("bootstrap.servers", "broker:9093");
props.put("security.protocol", "SSL");
props.put("ssl.truststore.location", "/path/to/truststore.jks");
props.put("ssl.truststore.password", "changeit");
// Optional: disable hostname verification (not recommended for production)
// props.put("ssl.endpoint.identification.algorithm", "");
```

**mTLS (client certificate authentication):**

```java
Properties props = new Properties();
props.put("bootstrap.servers", "broker:9093");
props.put("security.protocol", "SSL");
props.put("ssl.truststore.location", "/path/to/truststore.jks");
props.put("ssl.truststore.password", "changeit");
props.put("ssl.keystore.location", "/path/to/client-keystore.p12");
props.put("ssl.keystore.password", "keystore-pass");
props.put("ssl.keystore.type", "PKCS12");
props.put("ssl.key.password", "key-pass");
```

To create a PKCS12 keystore from PEM files:

```bash
openssl pkcs12 -export \
  -in client.crt -inkey client.key \
  -CAfile ca.crt -caname root \
  -out client-keystore.p12 \
  -passout pass:keystore-pass
```

To create a JKS truststore from a CA cert:

```bash
keytool -importcert -alias ca \
  -file ca.crt \
  -keystore truststore.jks \
  -storepass changeit -noprompt
```

---

### librdkafka (confluent-kafka-python, confluent-kafka-dotnet, etc.)

librdkafka uses PEM files directly — no keystore format needed.

| Property | Purpose |
|---|---|
| `ssl.ca.location` | Path to CA certificate PEM file for broker verification |
| `ssl.certificate.location` | Path to client certificate PEM file (mTLS only) |
| `ssl.key.location` | Path to client private key PEM file (mTLS only) |
| `ssl.key.password` | Password for the client private key, if encrypted (mTLS only) |
| `security.protocol` | `SSL` for TLS-only, `SASL_SSL` for TLS+SASL |

**One-way TLS in C:**

```c
rd_kafka_conf_t *conf = rd_kafka_conf_new();
rd_kafka_conf_set(conf, "bootstrap.servers", "broker:9093", NULL, 0);
rd_kafka_conf_set(conf, "security.protocol", "SSL", NULL, 0);
rd_kafka_conf_set(conf, "ssl.ca.location", "/path/to/ca.crt", NULL, 0);
```

**mTLS in Python (confluent-kafka-python):**

```python
from confluent_kafka import Producer

conf = {
    'bootstrap.servers': 'broker:9093',
    'security.protocol': 'SSL',
    'ssl.ca.location': '/path/to/ca.crt',
    'ssl.certificate.location': '/path/to/client.crt',
    'ssl.key.location': '/path/to/client.key',
    'ssl.key.password': 'key-pass',  # omit if key is unencrypted
}
producer = Producer(conf)
```

---

### franz-go (Go)

franz-go takes a standard `*tls.Config` passed to `kgo.DialTLSConfig`. Build the `tls.Config` using the Go standard library.

**One-way TLS:**

```go
package main

import (
    "crypto/tls"
    "crypto/x509"
    "fmt"
    "os"

    "github.com/twmb/franz-go/pkg/kgo"
)

func newTLSClient() (*kgo.Client, error) {
    caCert, err := os.ReadFile("/path/to/ca.crt")
    if err != nil {
        return nil, err
    }

    certPool := x509.NewCertPool()
    if !certPool.AppendCertsFromPEM(caCert) {
        return nil, fmt.Errorf("failed to parse CA certificate")
    }

    tlsCfg := &tls.Config{
        RootCAs: certPool,
    }

    return kgo.NewClient(
        kgo.SeedBrokers("broker:9093"),
        kgo.DialTLSConfig(tlsCfg),
    )
}
```

**mTLS (client certificate):**

```go
package main

import (
    "crypto/tls"
    "crypto/x509"
    "fmt"
    "os"

    "github.com/twmb/franz-go/pkg/kgo"
)

func newMTLSClient() (*kgo.Client, error) {
    caCert, err := os.ReadFile("/path/to/ca.crt")
    if err != nil {
        return nil, err
    }

    certPool := x509.NewCertPool()
    if !certPool.AppendCertsFromPEM(caCert) {
        return nil, fmt.Errorf("failed to parse CA certificate")
    }

    clientCert, err := tls.LoadX509KeyPair("/path/to/client.crt", "/path/to/client.key")
    if err != nil {
        return nil, err
    }

    tlsCfg := &tls.Config{
        RootCAs:      certPool,
        Certificates: []tls.Certificate{clientCert},
    }

    return kgo.NewClient(
        kgo.SeedBrokers("broker:9093"),
        kgo.DialTLSConfig(tlsCfg),
    )
}
```

---

### KafkaJS (Node.js)

KafkaJS accepts TLS options in the top-level `ssl` field. For one-way TLS, `ssl: true` is sufficient when the broker's certificate is signed by a well-known CA (or when using Node's default trust store). For custom CAs and mTLS, pass a configuration object.

**One-way TLS with custom CA:**

```javascript
const { Kafka } = require('kafkajs')
const fs = require('fs')

const kafka = new Kafka({
  clientId: 'my-app',
  brokers: ['broker:9093'],
  ssl: {
    ca: [fs.readFileSync('/path/to/ca.pem')],
    rejectUnauthorized: true,
  },
})
```

**mTLS (client certificate authentication):**

```javascript
const { Kafka } = require('kafkajs')
const fs = require('fs')

const kafka = new Kafka({
  clientId: 'my-app',
  brokers: ['broker:9093'],
  ssl: {
    ca: [fs.readFileSync('/path/to/ca.pem')],
    cert: fs.readFileSync('/path/to/client.crt'),
    key: fs.readFileSync('/path/to/client.key'),
    rejectUnauthorized: true,
  },
})
```

If the client key is passphrase-protected, add `passphrase: 'key-pass'` to the ssl object.

---

## Redpanda Broker TLS Configuration

Redpanda's broker TLS is configured in `redpanda.yaml` (self-managed) or via `rpk cluster config set` (cluster-scoped properties). The two relevant fields are `kafka_api` (listener addresses and authentication methods) and `kafka_api_tls` (TLS material per listener). Listeners are linked by their `name` field.

### Listener Addresses (`kafka_api`)

Each entry in `kafka_api` defines one listener. The `name` field links the listener to its TLS config in `kafka_api_tls`.

```yaml
redpanda:
  kafka_api:
    - name: plaintext
      address: 0.0.0.0
      port: 9092
      authentication_method: none

    - name: tls
      address: 0.0.0.0
      port: 9093
      authentication_method: none       # TLS transport, no client cert auth

    - name: mtls
      address: 0.0.0.0
      port: 9094
      authentication_method: mtls_identity   # client cert is the identity
```

Valid `authentication_method` values:

| Value | Meaning |
|---|---|
| `none` | No authentication. Combined with TLS in `kafka_api_tls` = one-way TLS. Without TLS = plaintext. |
| `sasl` | SASL (SCRAM-SHA-256 or SCRAM-SHA-512). Usually combined with TLS. |
| `mtls_identity` | Client certificate is required and used as the Kafka principal. Requires TLS with `require_client_auth: true`. |
| `http_basic` | HTTP Basic auth (used with Redpanda's HTTP proxy, not the Kafka API). |

### TLS Settings (`kafka_api_tls`)

Each entry in `kafka_api_tls` provides the TLS material for one listener. The `name` must match the corresponding `kafka_api` listener name.

```yaml
redpanda:
  kafka_api_tls:
    - name: tls
      enabled: true
      cert_file: /etc/redpanda/certs/broker.crt
      key_file: /etc/redpanda/certs/broker.key
      truststore_file: /etc/redpanda/certs/ca.crt  # not needed for one-way TLS
      require_client_auth: false

    - name: mtls
      enabled: true
      cert_file: /etc/redpanda/certs/broker.crt
      key_file: /etc/redpanda/certs/broker.key
      truststore_file: /etc/redpanda/certs/ca.crt  # CA used to verify client certs
      require_client_auth: true
```

| Field | Purpose |
|---|---|
| `name` | Must match the `name` in the corresponding `kafka_api` listener entry |
| `enabled` | `true` to enable TLS on this listener |
| `cert_file` | Path to the broker's TLS certificate (PEM) |
| `key_file` | Path to the broker's TLS private key (PEM) |
| `truststore_file` | CA certificate (PEM) used to verify client certificates. Required for mTLS. |
| `require_client_auth` | `true` to enforce mTLS — clients that do not present a valid certificate are rejected |

### Complete mTLS-Only Broker Configuration

This example offers one-way TLS on 9093 and mTLS on 9094, with advertised addresses for client discovery:

```yaml
redpanda:
  kafka_api:
    - name: tls
      address: 0.0.0.0
      port: 9093
      authentication_method: none

    - name: mtls
      address: 0.0.0.0
      port: 9094
      authentication_method: mtls_identity

  kafka_api_tls:
    - name: tls
      enabled: true
      cert_file: /etc/redpanda/certs/broker.crt
      key_file: /etc/redpanda/certs/broker.key
      require_client_auth: false

    - name: mtls
      enabled: true
      cert_file: /etc/redpanda/certs/broker.crt
      key_file: /etc/redpanda/certs/broker.key
      truststore_file: /etc/redpanda/certs/ca.crt
      require_client_auth: true

  advertised_kafka_api:
    - name: tls
      address: broker.example.com
      port: 9093
    - name: mtls
      address: broker.example.com
      port: 9094
```

The matching client config (confluent-kafka-python connecting to the mTLS port):

```python
conf = {
    'bootstrap.servers': 'broker.example.com:9094',
    'security.protocol': 'SSL',
    'ssl.ca.location': '/path/to/ca.crt',
    'ssl.certificate.location': '/path/to/client.crt',
    'ssl.key.location': '/path/to/client.key',
}
```

---

## Principal Mapping from Client Certificates (`kafka_mtls_principal_mapping_rules`)

When `authentication_method: mtls_identity` is set, Redpanda extracts the Kafka principal from the Subject DN of the client's TLS certificate. The `kafka_mtls_principal_mapping_rules` cluster config controls how that extraction happens.

### Rule Format

Rules follow the same syntax as Kafka's `ssl.principal.mapping.rules`:

```
RULE:<regex>/<replacement>/[L|U]
```

- `<regex>`: A regular expression matched against the full Subject DN string (e.g., `CN=alice,OU=eng,O=example,C=US`).
- `<replacement>`: The output string, with `$1`, `$2`, etc. for capture groups.
- `L` (optional): lowercase the result.
- `U` (optional): uppercase the result.
- `DEFAULT`: A special token (no `RULE:` prefix) meaning "use the full DN as the principal."

Rules are evaluated in order; the **first matching rule wins**. If no rule matches, the full DN is used.

### Example Rules

Extract the CN (`alice` from `CN=alice,OU=eng,O=example,C=US`):

```
RULE:^CN=(.*?),.*$/$1/
```

Extract the CN and lowercase it:

```
RULE:^CN=(.*?),.*$/$1/L
```

Handle a DN with no OU (CN only, e.g., `CN=alice`):

```
RULE:^CN=([^,]+)$/$1/
```

Use full DN as fallback when no other rule matches:

```
DEFAULT
```

### Setting the Rules

```bash
rpk cluster config set kafka_mtls_principal_mapping_rules \
  '["RULE:^CN=(.*?),.*$/$1/","RULE:^CN=([^,]+)$/$1/","DEFAULT"]'
```

Verify the current value:

```bash
rpk cluster config get kafka_mtls_principal_mapping_rules
```

### Verifying the Effective Principal

After connecting with a client certificate, check the audit log (`_redpanda.audit_log`) for the authentication event, or use `openssl x509` to inspect the DN of the certificate being presented:

```bash
openssl x509 -in client.crt -noout -subject
# subject=CN=alice, OU=eng, O=example, C=US
```

Given the rule `RULE:^CN=(.*?),.*$/$1/`, the principal will be `User:alice`.

---

## Using mTLS with ACLs

Once `kafka_mtls_principal_mapping_rules` extracts a principal from the client certificate, ACLs work the same way as with SASL. The principal name is the extracted value (e.g., `alice` from the CN).

```bash
# Allow principal 'alice' (CN from client cert) to produce to topic 'orders'
rpk security acl create \
  --allow-principal User:alice \
  --operation write \
  --topic orders

# Allow 'alice' to consume (read from topic + access group)
rpk security acl create \
  --allow-principal User:alice \
  --operation read \
  --topic orders \
  --group my-consumer-group

# List ACLs for alice
rpk security acl list --allow-principal User:alice
```

ACL management is identical whether the principal comes from SASL or mTLS — the authentication method is transparent to the ACL system.

---

## Enterprise Interactions

### RBAC (Enterprise)

When Redpanda's Role-Based Access Control is enabled, mTLS principals can be bound to roles just like SASL principals. Use `rpk security role bind` to assign a role to the mTLS-extracted principal:

```bash
rpk security role bind data-producer --principal User:alice
```

### Audit Logging (Enterprise)

Authentication events are logged to the `_redpanda.audit_log` internal topic. Each successful or failed mTLS authentication appears as an event with the extracted principal name (after `kafka_mtls_principal_mapping_rules` is applied) and the listener address. This allows correlation between certificate DNs and access patterns without inspecting raw TLS handshake logs.

```bash
# Consume recent audit events
rpk topic consume _redpanda.audit_log --brokers localhost:9092 --offset end
```

Audit log events include the `user.name` field (the extracted principal) and `connection.security_protocol` set to `SSL`.
