# rpk Profiles Reference

An **rpk profile** is a named, reusable configuration for a single Redpanda
cluster. All profiles are stored in one `rpk.yaml` file. You can create
different profiles for local dev, staging, and production, then swap between
them with `rpk profile use`.

Profiles are the **recommended** way to configure rpk — they persist across
sessions and are easier to manage than environment variables or per-command
flags.

---

## rpk.yaml location

| Platform | Default path |
|---|---|
| Linux | `~/.config/rpk/rpk.yaml` |
| macOS | `~/Library/Application Support/rpk/rpk.yaml` |

The path can be overridden with `--config <path>` on any rpk command.

---

## Profile structure (rpk.yaml excerpt)

```yaml
version: 7
current_profile: prod

globals:
  prompt: 'bg-red "%n"'
  command_timeout: 30s
  dial_timeout: 3s
  request_timeout_overhead: 10s
  retry_timeout: 30s
  fetch_max_wait: 5s
  kafka_protocol_request_client_id: rpk

profiles:
  - name: local
    description: Local dev cluster
    kafka_api:
      brokers:
        - localhost:9092
    admin_api:
      addresses:
        - localhost:9644
    schema_registry:
      addresses:
        - localhost:8081

  - name: prod
    description: Production cluster with SASL+TLS
    kafka_api:
      brokers:
        - broker1.example.com:9092
        - broker2.example.com:9092
      tls:
        enabled: true
        ca: /etc/ssl/certs/ca-bundle.pem
      sasl:
        mechanism: SCRAM-SHA-256
        user: alice
        password: s3cr3t
    admin_api:
      addresses:
        - broker1.example.com:9644
      tls:
        enabled: true
    schema_registry:
      addresses:
        - broker1.example.com:8081
      tls:
        enabled: true
```

---

## Profile subcommands

### Create a profile

```bash
# Basic: create with --set flags
rpk profile create local \
  --set brokers=localhost:9092 \
  --set admin.hosts=localhost:9644 \
  --description "Local dev cluster"

# With SASL + TLS
rpk profile create prod \
  --set brokers=broker1.example.com:9092,broker2.example.com:9092 \
  --set admin.hosts=broker1.example.com:9644 \
  --set tls.enabled=true \
  --set sasl.mechanism=SCRAM-SHA-256 \
  --set user=alice \
  --set pass=s3cr3t \
  --description "Production cluster"

# From a Cloud cluster (must be logged in with rpk cloud login first)
# Interactive picker:
rpk profile create --from-cloud

# Specific cluster ID or name:
rpk profile create --from-cloud <cluster-id>
rpk profile create --from-cloud <cluster-name>

# From an existing redpanda.yaml file:
rpk profile create mycluster --from-redpanda /etc/redpanda/redpanda.yaml

# From another existing profile:
rpk profile create prod-copy --from-profile prod

# From a running local container cluster (started with rpk container start):
rpk profile create --from-rpk-container
```

rpk always switches to the newly created profile after `rpk profile create`.

### Switch the active profile

```bash
rpk profile use prod
rpk profile use local
```

### Show the current (active) profile

```bash
rpk profile current
```

### List all profiles

```bash
rpk profile list
# Output includes Name, Description, and whether it's the current profile
```

### Set a value in the current profile

```bash
# Key uses -X flag format
rpk profile set brokers=broker1.example.com:9092
rpk profile set tls.enabled=true
rpk profile set sasl.mechanism=SCRAM-SHA-256
rpk profile set user=bob
rpk profile set pass=newpassword
```

### Edit the current profile in your $EDITOR

```bash
rpk profile edit
# Opens the YAML for the current profile in $EDITOR

# Edit a named profile
rpk profile edit prod
```

### Set globals (apply to all profiles)

```bash
rpk profile set-globals globals.command_timeout=60s
rpk profile set-globals globals.no_default_cluster=true
```

### Edit globals in $EDITOR

```bash
rpk profile edit-globals
```

### Delete a profile

```bash
rpk profile delete staging
```

### Rename the current profile

```bash
rpk profile rename-to new-name
```

### Print the current profile (with YAML)

```bash
rpk profile print
rpk profile print -v   # verbose: shows effective config including env overrides
```

### Print globals

```bash
rpk profile print-globals
```

### Validate the current profile

```bash
rpk profile validate
```

### Deselect the active profile

```bash
rpk profile clear
```

`rpk profile clear` unsets which profile is currently active by setting
`current_profile` to empty in `rpk.yaml`. It does **not** delete the profile
or remove credentials stored within it. It is useful when you want no profile
active (for example, to prevent accidentally targeting a production cluster).
Use `rpk profile delete` to actually remove a profile.

---

## Using a profile for a single command

The `--profile` flag overrides the active profile for one command:

```bash
rpk topic list --profile prod
rpk cluster health --profile staging
```

---

## Environment variable override

`RPK_PROFILE=<name>` temporarily overrides the current profile for the duration
of the shell session:

```bash
export RPK_PROFILE=prod
rpk topic list     # uses "prod" profile
```

The `--profile` flag takes precedence over `RPK_PROFILE` if both are set.

---

## Creating a profile from Redpanda Cloud

After logging in with `rpk cloud login`, create a profile from a Cloud cluster:

```bash
# Interactive — prompts you to pick a cluster
rpk profile create --from-cloud

# Directly by cluster ID
rpk profile create --from-cloud cpk1234567890

# Directly by cluster name (format: resource-group/cluster-name or just cluster-name)
rpk profile create --from-cloud "my-namespace/my-cluster"
rpk profile create --from-cloud my-cluster

# Serverless clusters that support both public and private networking:
rpk profile create --from-cloud my-cluster --serverless-network public
rpk profile create --from-cloud my-cluster --serverless-network private
```

The resulting profile pre-fills brokers, admin URL, and Schema Registry URL
from the Cloud control plane. For serverless clusters it also configures
SASL/OIDC automatically.

---

## Cloud profile structure

When created via `--from-cloud`, the profile includes a `cloud_cluster` block:

```yaml
name: rpk-cloud
from_cloud: true
cloud_cluster:
  resource_group: default
  cluster_id: cpk1234567890
  cluster_name: my-cluster
  auth_org_id: org-abc123
  auth_kind: sso
  cluster_type: TYPE_SERVERLESS
  cluster_url: https://my-cluster.abc.redpanda.cloud
kafka_api:
  brokers:
    - seed-abc123.abc.redpanda.cloud:9092
  tls: {}
  sasl:
    mechanism: CLOUD-OIDC
admin_api:
  addresses:
    - https://my-cluster.abc.redpanda.cloud
  tls: {}
schema_registry:
  addresses:
    - https://my-cluster.abc.redpanda.cloud:443
  tls: {}
```

---

## Profile prompt customization

Each profile can customize the shell `PS1` prompt to show which cluster you're
targeting. Set the `prompt` field in the profile YAML:

```yaml
name: prod
prompt: 'hi-red, "[%n]"'
```

Then in `~/.zshrc` or `~/.bashrc` (use single quotes to prevent early
evaluation):

```bash
export PS1='\u@\h $(rpk profile prompt)% '
```

`%n` expands to the profile name. Colors like `hi-red`, `bg-red`, `blue`, etc.
are supported (see `rpk profile prompt --help`).

---

## Tips

- The `--set` flag accepts both `-X` key format (`tls.enabled`) and the YAML
  path format (`kafka_api.tls.enabled`) — they are equivalent.
- `--set` has tab-completion for key names.
- `globals.no_default_cluster=true` prevents rpk from silently falling back to
  `localhost:9092` when no profile or broker is specified.
- `globals.command_timeout` sets a deadline for all commands (default `30s`).
