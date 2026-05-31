# rpk cloud cluster and resource-group

## rpk cloud cluster select

### Synopsis

```
rpk cloud cluster select [NAME] [flags]
```

Command: `select`; alias: `use`

### What it does

`rpk cloud cluster select` is an alias for:

```bash
rpk profile create --from-cloud=<NAME>
```

It calls the Redpanda Cloud control-plane API to look up the cluster named `NAME`, retrieves its data-plane API URL and broker/admin/Schema Registry endpoints, then writes them into an rpk profile (default profile name: `rpk-cloud`). After running this command, subsequent `rpk topic`, `rpk cluster`, `rpk group`, and `rpk registry` commands use that cluster automatically without any extra flags.

If called without a `NAME` argument, it presents an interactive prompt listing all clusters in your organization so you can choose one.

### Serverless network selection

Serverless clusters may expose both public and private network endpoints. When both are available and you have not specified `--serverless-network`, the command prompts you to choose. In automation (CI/CD), pass the flag explicitly to avoid the prompt:

```bash
rpk cloud cluster select my-serverless-cluster --serverless-network public
rpk cloud cluster select my-serverless-cluster --serverless-network private
```

Valid values: `public`, `private`.

### Profile naming

By default, the profile is created or updated with the name `rpk-cloud`. If you have an existing self-hosted profile by that name (a conflict), rpk shows an error with three resolution options:

```
Unable to automatically create profile "rpk-cloud" due to a name conflict...

Either:
    rpk profile select "rpk-cloud"
    rpk profile rename-to $something_else
    rpk cloud cluster select [NAME]
Or:
    rpk cloud cluster select [NAME] --profile $another_something
```

Use `--profile` to give the new cloud profile a custom name instead of `rpk-cloud`:

```bash
rpk cloud cluster select my-cluster --profile prod-cloud
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--profile` | string | — | Name for the profile to create or update (avoids overwriting `rpk-cloud`) |
| `--serverless-network` | string | — | Networking type for Serverless clusters: `public` or `private` |
| `--config` | string | (search paths) | Path to rpk.yaml or redpanda.yaml |
| `-X, --config-opt` | stringArray | — | Override rpk config settings inline |
| `-v, --verbose` | bool | false | Enable verbose logging |

### Complete quickstart flow

```bash
# 1. Authenticate
rpk cloud login

# 2. Select a cluster (interactive if no NAME given)
rpk cloud cluster select

# 3. Confirm the profile is active
rpk profile current

# 4. Talk to the cluster
rpk topic list
rpk cluster health
```

### Inspecting the resulting profile

After `cluster select`, you can view what was written:

```bash
rpk profile print          # show all profile fields
rpk profile edit           # open in $EDITOR
```

The profile will contain the Kafka bootstrap address, Admin API address, Schema Registry address, and the cloud cluster metadata needed for the MCP server.

---

## rpk cloud resource-group

Resource groups are the organizational containers in Redpanda Cloud — every cluster belongs to exactly one resource group (sometimes called a namespace). They define the billing boundary and scoping for clusters.

### Synopsis

```
rpk cloud resource-group [command] [flags]
```

Aliases for the parent command: `resource-group`, `namespace`, `ns`

### Subcommands

#### create

```bash
rpk cloud resource-group create <NAME> [<NAME>...]
```

Creates one or more resource groups. Multiple names can be supplied in a single call. Output is a table with columns `NAME`, `ID`, and `ERROR` (ERROR is blank unless a creation failed).

```bash
# Create a single resource group
rpk cloud resource-group create production

# Create multiple at once
rpk cloud resource-group create staging canary dev
```

Example output:
```
NAME       ID
production xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

#### list

```bash
rpk cloud resource-group list
rpk cloud resource-group list --format json
```

Lists all resource groups in your organization. Output is sorted alphabetically by name.

```
NAME        ID
dev         aaaaaaaa-...
production  bbbbbbbb-...
staging     cccccccc-...
```

#### delete

```bash
rpk cloud resource-group delete <NAME>
```

Deletes the named resource group. By default, rpk prints an interactive confirmation prompt (`Confirm deletion of resource group "<NAME>" with ID "<ID>"?`) before proceeding. Pass `--no-confirm` to skip this prompt in non-interactive or CI environments. The control-plane API may reject deletion of a resource group that still contains clusters.

```bash
# Interactive (prompts for confirmation)
rpk cloud resource-group delete old-rg

# Non-interactive / CI (no prompt)
rpk cloud resource-group delete old-rg --no-confirm
```

### Flags (available on all resource-group subcommands)

| Flag | Type | Description |
|---|---|---|
| `--format` | string | Output format: `text` (default), `json`, `yaml`, `wide`, `help` |
| `--no-confirm` | bool | Disable confirmation prompt (delete subcommand only; default: false) |
| `--client-id` | string | Cloud client ID (overrides rpk.yaml / env) |
| `--client-secret` | string | Cloud client secret |
| `--config` | string | Path to rpk.yaml or redpanda.yaml |
| `-X, --config-opt` | stringArray | Override rpk config settings inline |
| `--profile` | string | Profile to use |
| `-v, --verbose` | bool | Enable verbose logging |

### Relationship to clusters

When you create a cluster in the Redpanda Cloud UI or via the API, you assign it to a resource group at creation time. The resource group ID appears in the control-plane API responses. `rpk cloud cluster select` works across all resource groups in your organization — you identify clusters by name, not by resource group.

### Common patterns

```bash
# Create per-environment resource groups
rpk cloud resource-group create prod staging dev

# Audit: list all resource groups as JSON
rpk cloud resource-group list --format json | jq '.[] | .name'

# Clean up an empty resource group
rpk cloud resource-group delete old-project
```
