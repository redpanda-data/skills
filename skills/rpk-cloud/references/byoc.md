# rpk cloud byoc: BYOC Agent Provisioning

## Overview

BYOC (Bring Your Own Cloud) is the Redpanda Cloud deployment model where the Redpanda data plane runs in **your** cloud account (AWS, GCP, or Azure) while Redpanda manages the control plane. The `rpk cloud byoc` command group drives this provisioning: it downloads a versioned plugin that wraps Terraform, then runs `apply`/`destroy` to create and remove the agent infrastructure in your account.

---

## How BYOC provisioning works

1. **Create the cluster in the Redpanda Cloud UI** — this registers the cluster in the control plane and gives you a cluster ID (the `--redpanda-id`).
2. **`rpk cloud byoc install --redpanda-id <id>`** — downloads the BYOC plugin binary whose version is pinned to your cluster's requirements.
3. **`rpk cloud byoc <provider> apply --redpanda-id <id>`** — runs Terraform in your cloud account to provision the agent VMs and networking. The agent then bootstraps the full Redpanda cluster.
4. Repeat with `destroy` to tear everything down.

The `validate` subcommand checks your credentials and prerequisites without needing the cluster's version-pinned plugin (it downloads the latest).

---

## rpk cloud byoc

### Synopsis

```
rpk cloud byoc [command|provider] [flags]
```

The `byoc` command itself accepts provider subcommands that the downloaded plugin exposes (`aws`, `gcp`, `azure`), and built-in subcommands `install` and `uninstall`.

### Flags available on all byoc commands

| Flag | Type | Description |
|---|---|---|
| `--redpanda-id` | string | The cluster ID (required for apply/destroy, not for validate) |
| `--client-id` | string | Cloud client ID (overrides env / rpk.yaml) |
| `--client-secret` | string | Cloud client secret |
| `--config` | string | Path to rpk.yaml or redpanda.yaml |
| `-X, --config-opt` | stringArray | Override rpk config settings inline |
| `--profile` | string | Profile to use |
| `-v, --verbose` | bool | Enable verbose logging |

---

## rpk cloud byoc install

Downloads the BYOC plugin binary whose SHA256 and version are pinned to the cluster specified by `--redpanda-id`. The plugin is installed to rpk's managed plugin directory.

```bash
rpk cloud byoc install --redpanda-id rp-abc1234567
```

If the currently installed plugin already matches the expected version (SHA256 check), it exits without re-downloading:

```
Your BYOC plugin is currently up to date, avoiding reinstalling!
```

On a successful (new) installation:

```
BYOC plugin installed successfully!

This plugin supports autocompletion through 'rpk cloud byoc'. If you enable rpk
autocompletion, start a new terminal and tab complete through it!
```

---

## rpk cloud byoc uninstall

Deletes the locally downloaded BYOC plugin binary to free disk space:

```bash
rpk cloud byoc uninstall
```

You can always re-install it when needed.

---

## rpk cloud byoc apply (provider-specific)

Runs Terraform to provision the BYOC agent infrastructure in your cloud account.

```bash
# AWS
rpk cloud byoc aws apply --redpanda-id rp-abc1234567

# GCP
rpk cloud byoc gcp apply --redpanda-id rp-abc1234567

# Azure
rpk cloud byoc azure apply --redpanda-id rp-abc1234567
```

The `apply` command:
- Logs in (or reuses a valid token) via the Cloud API.
- Ensures the plugin version matches the control plane's expected version.
- Passes your cloud API token to the plugin via the hidden `--cloud-api-token` flag (managed automatically — do not set this manually).
- Runs the Terraform apply for the selected cloud provider.

### Required cloud-provider credentials

The BYOC plugin needs credentials for your cloud provider (AWS IAM role, GCP service account, Azure service principal). These are supplied through the provider's standard credential mechanisms (environment variables, instance metadata, etc.) — not through rpk flags. See the Redpanda Cloud documentation for the required IAM permissions per provider.

---

## rpk cloud byoc destroy

Tears down the BYOC agent infrastructure (Terraform destroy):

```bash
rpk cloud byoc aws destroy --redpanda-id rp-abc1234567
rpk cloud byoc gcp destroy --redpanda-id rp-abc1234567
rpk cloud byoc azure destroy --redpanda-id rp-abc1234567
```

---

## rpk cloud byoc validate

Validates your cloud credentials and prerequisites without needing the cluster's exact plugin version. Uses the latest available plugin version.

```bash
rpk cloud byoc validate
rpk cloud byoc aws validate
rpk cloud byoc gcp validate
rpk cloud byoc azure validate
```

`--redpanda-id` is **not** required for `validate` (unlike `apply`/`destroy`).

---

## Plugin version pinning and RPK_CLOUD_SKIP_VERSION_CHECK

Each BYOC cluster is associated with a specific BYOC plugin version in the control plane. When you run `apply` or `destroy`, rpk:

1. Fetches the expected plugin artifact metadata from `https://api.redpanda.com` using `ListArtifactsByRedpandaID`.
2. Extracts the expected SHA256 from the artifact download URL filename.
3. Compares against the currently installed plugin's SHA256.
4. Downloads and replaces the plugin if they differ.

To skip this version check (for development or testing), set:

```bash
export RPK_CLOUD_SKIP_VERSION_CHECK=1
rpk cloud byoc aws apply --redpanda-id rp-abc1234567
```

> `RPK_CLOUD_SKIP_VERSION_CHECK` only skips the check; it does not prevent the plugin download if the plugin is not installed at all.

**Do not set `RPK_CLOUD_SKIP_VERSION_CHECK` in production** — it can cause version mismatches between the agent and the control plane.

---

## Plugin binary location

The plugin is installed into rpk's managed binary path (the same directory used for all managed rpk plugins). On Linux/macOS this is typically `~/.local/bin/` or the equivalent XDG data directory. Run `rpk plugin list` to see installed plugins and their paths.

---

## End-to-end BYOC provisioning example (AWS)

```bash
# 1. Log in to Redpanda Cloud
rpk cloud login --client-id "$CLIENT_ID" --client-secret "$CLIENT_SECRET" --save --no-profile

# 2. Install the version-pinned plugin for your cluster
rpk cloud byoc install --redpanda-id rp-abc1234567

# 3. Ensure AWS credentials are available (standard AWS SDK mechanisms)
export AWS_PROFILE=my-profile   # or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY

# 4. Apply (provisions the BYOC agent via Terraform)
rpk cloud byoc aws apply --redpanda-id rp-abc1234567

# 5. Select the cluster to talk to it
rpk cloud cluster select my-byoc-cluster

# 6. Verify
rpk cluster health

# --- Later: tear down ---
rpk cloud byoc aws destroy --redpanda-id rp-abc1234567
```

---

## Troubleshooting

**`unable to ensure byoc plugin version`**: Ensure you are authenticated (`rpk cloud login`) and that the `--redpanda-id` is correct (matches a cluster in your organization).

**`found external plugin at <path>`**: A non-managed BYOC plugin binary exists in your `PATH`. Remove it and re-run.

**`required --redpanda-id flag cannot be empty`**: The `--redpanda-id` flag is required for `apply` and `destroy`. It is the cluster ID from the Redpanda Cloud UI.

**Running with sudo**: rpk detects sudo and refuses to install the plugin as a root-owned binary. Run without `sudo`.
