# rpk ai: Managed Plugin Reference

`rpk ai` is a **managed plugin** that wraps the Redpanda AI CLI (internal slug `rpai`, display name "Redpanda AI CLI"). The plugin binary is installed to `~/.local/bin/.rpk.managed-rpai`. On the first invocation of any real subcommand, `rpk` auto-downloads the latest version if the plugin is not yet installed.

Source: `redpanda/src/go/rpk/pkg/cli/ai/`

---

## Plugin Lifecycle Commands

### Install

```bash
# Install the latest version
rpk ai install

# Install a specific version (semver, e.g. 0.1.2 or v0.1.2)
rpk ai install --ai-version 0.1.2

# Force reinstall (even if already installed)
rpk ai install --force
```

**Flags for `rpk ai install`:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--ai-version` | string | `latest` | Version to install. Must be `latest` or match `MAJOR.MINOR.PATCH` (prefix `v` optional). Pre-releases like `0.1.2-rc1` are forwarded to the manifest. |
| `--force` | bool | false | Force install even if already installed. Without `--force`, if a non-`latest` version is specified and the plugin exists, the command exits telling you to uninstall first. |

The installer downloads from the rpk plugin repository (overridable via `RPK_PLUGIN_REPOSITORY` env var in tests), verifies the SHA-256 checksum, and writes the binary as executable to the managed bin path.

**FIPS note:** The Redpanda AI CLI does not ship a FIPS build. Running `rpk ai install` (or any `rpk ai` subcommand that triggers download) on a FIPS-enabled build exits with an error.

### Upgrade

```bash
rpk ai upgrade

# Skip the major-version confirmation prompt
rpk ai upgrade --no-confirm
```

`rpk ai upgrade` only works on `rpk`-managed installs (under `~/.local/bin`). If you installed the plugin yourself via a package manager, it will tell you to run `rpk ai uninstall && rpk ai install` to transfer control.

**Flags for `rpk ai upgrade`:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--no-confirm` | bool | false | Skip the interactive confirmation prompt for major-version upgrades. |

The upgrade command:
1. Fetches the latest manifest entry for the `rpai` plugin.
2. Computes the SHA-256 of the currently installed binary and compares to the manifest.
3. If already up-to-date, exits cleanly.
4. For a major-version bump, prompts for confirmation (unless `--no-confirm`).
5. Downloads and overwrites the installed binary.

### Uninstall

```bash
rpk ai uninstall
```

Removes the managed plugin binary. Prints a table of paths and success/failure messages. Exits with code 1 if any removal fails.

---

## Auto-install on First Subcommand Use

If the plugin is not installed and you run `rpk ai some-subcommand`, rpk prints "Downloading latest Redpanda AI CLI" to stderr and installs it automatically before exec-ing the subcommand. This matches the `rpk connect` pattern.

`rpk ai --help` and `rpk ai --version` work without triggering auto-install (the help is rendered by rpk, and `--version` gives a clear message if the plugin is missing).

---

## Auth Injection: RPAI_TOKEN and RPAI_ENDPOINT

Before exec-ing the plugin binary, rpk injects two environment variables:

| Env Var | Description |
|---------|-------------|
| `RPAI_TOKEN` | Bearer token forwarded as `Authorization` to the AI Gateway. Sourced from the active cloud profile's cached `auth_token` in `rpk.yaml`. A missing or expired token results in a 401 from the gateway; run `rpk cloud login` to refresh. |
| `RPAI_ENDPOINT` | AI Gateway v2 base URL for the active cluster. First tries the `AIGatewayURL` cached on the profile (populated at `rpk cloud cluster use` time); if missing, calls the public API `GetCluster` to look it up. |

**Resolution rules:**
- If `RPAI_TOKEN` is already set in the environment, rpk does not overwrite it.
- If `RPAI_ENDPOINT` is already set, or if `--rpai-endpoint=...` flag is present in the plugin args, rpk skips the cluster lookup entirely.
- If no cluster is selected in the active profile, rpk exits with: `no cluster selected for this rpk profile; run 'rpk cloud cluster use <id>' or pass --rpai-endpoint`.

```bash
# Explicit overrides (take priority over profile lookup)
export RPAI_TOKEN=eyJhbGciOi...
export RPAI_ENDPOINT=https://my-aigw.redpanda.cloud
rpk ai <subcommand>

# Per-invocation flag override (skips cluster lookup)
rpk ai <subcommand> --rpai-endpoint https://my-aigw.redpanda.cloud
```

---

## Global rpk Flags and the Plugin

`rpk ai` uses `DisableFlagParsing: true` so cobra doesn't pre-parse flags before dispatch. rpk intercepts the raw args, strips rpk-global flags (`--config`, `--profile`, `-X`, `-v`), parses them itself (so the config loader and logger work), and forwards the remaining args to the plugin. `--help` / `-h` are re-injected into the plugin args so the plugin can render its own help.

Standard rpk global flags still work:

```bash
# Use a specific rpk config file
rpk ai <subcommand> --config /path/to/rpk.yaml

# Use a named profile
rpk ai <subcommand> --profile prod

# Override a config key
rpk ai <subcommand> -X cloud_environment=uat
```

---

## Plugin Binary Details

| Property | Value |
|----------|-------|
| Slug | `rpai` |
| Display name | `Redpanda AI CLI` |
| Install path | `~/.local/bin/.rpk.managed-rpai` |
| Version source | Plugin's `--version` output; accepted formats: `rpai version X.Y.Z ...` or `Version: X.Y.Z` |
| Manifest path | `<plugin-repo>/rpai/manifest.json` |

---

## Common Error Messages

| Message | Cause | Fix |
|---------|-------|-----|
| `the Redpanda AI CLI is not yet available in FIPS mode` | FIPS build detected | Use a non-FIPS rpk build |
| `The Redpanda AI CLI is already installed` | Install without `--force` | Use `rpk ai upgrade` or `--force` |
| `found a self-managed Redpanda AI CLI` | Binary outside `~/.local/bin` | Run `rpk ai uninstall && rpk ai install` |
| `no cluster selected for this rpk profile` | No active cloud profile, or the active profile is not cloud-backed (`FromCloud=false`), or it has no `cloud_cluster.cluster_id` | Run `rpk cloud cluster use <id>` |
| `does not have an AI Gateway v2 endpoint` | Cluster exists but has no AI Gateway | Select a cluster that has an AI Gateway attached |
| `unable to install the rpk ai plugin ... air-gapped` | Download failed | Install manually with your package manager |
