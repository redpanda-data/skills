# rpk Install Reference

`rpk` is a single static binary with no runtime dependencies. Install it on
macOS, Linux, or any platform via Docker. On self-managed Redpanda nodes rpk
is pre-installed alongside the broker; install it separately as a standalone
client when you need to talk to a remote cluster.

> **Version matching**: When using rpk as a standalone client against a
> self-managed Redpanda cluster, your rpk version should match the cluster
> version. For Redpanda Cloud always use the latest rpk.

> **Download host**: rpk archives are published at
> `https://rpk.redpanda.com/<release>/`, where `<release>` is either `latest`
> (the newest stable release) or a version tag (`v<version>`). GitHub
> release assets no longer carry new rpk versions, so a
> `github.com/redpanda-data/redpanda/releases/latest/download/...` URL now
> resolves to the last rpk published there rather than failing — it installs a
> stale binary. Use `rpk.redpanda.com` for every download.

---

## macOS

### Homebrew (recommended)

```bash
# Install or update
brew install redpanda-data/tap/redpanda

# Verify
rpk --version
```

### Manual — Apple Silicon (M1/M2/M3/M4)

```bash
# Latest stable release, verified against the published checksums
curl -fLO https://rpk.redpanda.com/latest/rpk-darwin-arm64.zip \
  && curl -fLO https://rpk.redpanda.com/latest/rpk_checksums.txt \
  && shasum -a 256 --ignore-missing -c rpk_checksums.txt \
  && mkdir -p ~/.local/bin \
  && export PATH="$HOME/.local/bin:$PATH" \
  && unzip rpk-darwin-arm64.zip -d ~/.local/bin/

# Specific version (replace <version> with the release number, without a
# leading `v` — the URL path adds the `v`, the checksums file name does not)
curl -fLO https://rpk.redpanda.com/v<version>/rpk-darwin-arm64.zip \
  && curl -fLO https://rpk.redpanda.com/v<version>/rpk_<version>_checksums.txt \
  && shasum -a 256 --ignore-missing -c rpk_<version>_checksums.txt \
  && mkdir -p ~/.local/bin \
  && export PATH="$HOME/.local/bin:$PATH" \
  && unzip rpk-darwin-arm64.zip -d ~/.local/bin/
```

### Manual — Intel macOS

```bash
# Latest stable release
curl -fLO https://rpk.redpanda.com/latest/rpk-darwin-amd64.zip \
  && curl -fLO https://rpk.redpanda.com/latest/rpk_checksums.txt \
  && shasum -a 256 --ignore-missing -c rpk_checksums.txt \
  && mkdir -p ~/.local/bin \
  && export PATH="$HOME/.local/bin:$PATH" \
  && unzip rpk-darwin-amd64.zip -d ~/.local/bin/

# Specific version
curl -fLO https://rpk.redpanda.com/v<version>/rpk-darwin-amd64.zip \
  && curl -fLO https://rpk.redpanda.com/v<version>/rpk_<version>_checksums.txt \
  && shasum -a 256 --ignore-missing -c rpk_<version>_checksums.txt \
  && mkdir -p ~/.local/bin \
  && export PATH="$HOME/.local/bin:$PATH" \
  && unzip rpk-darwin-amd64.zip -d ~/.local/bin/
```

---

## Linux

### amd64

```bash
# Latest stable release
curl -fLO https://rpk.redpanda.com/latest/rpk-linux-amd64.zip \
  && curl -fLO https://rpk.redpanda.com/latest/rpk_checksums.txt \
  && sha256sum --ignore-missing -c rpk_checksums.txt \
  && mkdir -p ~/.local/bin \
  && export PATH="$HOME/.local/bin:$PATH" \
  && unzip rpk-linux-amd64.zip -d ~/.local/bin/

# Specific version
curl -fLO https://rpk.redpanda.com/v<version>/rpk-linux-amd64.zip \
  && curl -fLO https://rpk.redpanda.com/v<version>/rpk_<version>_checksums.txt \
  && sha256sum --ignore-missing -c rpk_<version>_checksums.txt \
  && mkdir -p ~/.local/bin \
  && export PATH="$HOME/.local/bin:$PATH" \
  && unzip rpk-linux-amd64.zip -d ~/.local/bin/
```

### arm64

```bash
# Latest stable release
curl -fLO https://rpk.redpanda.com/latest/rpk-linux-arm64.zip \
  && curl -fLO https://rpk.redpanda.com/latest/rpk_checksums.txt \
  && sha256sum --ignore-missing -c rpk_checksums.txt \
  && mkdir -p ~/.local/bin \
  && export PATH="$HOME/.local/bin:$PATH" \
  && unzip rpk-linux-arm64.zip -d ~/.local/bin/

# Specific version
curl -fLO https://rpk.redpanda.com/v<version>/rpk-linux-arm64.zip \
  && curl -fLO https://rpk.redpanda.com/v<version>/rpk_<version>_checksums.txt \
  && sha256sum --ignore-missing -c rpk_<version>_checksums.txt \
  && mkdir -p ~/.local/bin \
  && export PATH="$HOME/.local/bin:$PATH" \
  && unzip rpk-linux-arm64.zip -d ~/.local/bin/
```

> **Checksum flags**: keep `--ignore-missing`. The published install commands
> pass it so the check still succeeds when the checksums file lists archives you
> did not download.

> **Windows**: rpk is supported on Windows only via WSL (Windows Subsystem for
> Linux). Commands that require a local Redpanda installation (such as
> `rpk container`, `rpk iotune`, and `rpk redpanda`) are not supported under WSL.

---

## Verify the installation

```bash
rpk --version
# Output format: (Redpanda CLI): v<version> (rev <sha>)
```

---

## Update

Update is the same command as install — downloading a newer zip and
unzipping it to the same location overwrites the old binary.

For Homebrew:
```bash
brew upgrade redpanda-data/tap/redpanda
```

---

## Make the PATH permanent

Add the following to your shell's rc file (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Then reload:
```bash
source ~/.zshrc   # or ~/.bashrc
```

---

## Release archives

Each version directory under `https://rpk.redpanda.com/` (`v<version>/`)
carries the archives below and `rpk_<version>_checksums.txt`. `latest/`
also carries the checksums as `rpk_checksums.txt`, a file name with no version:

| File | Contents |
|---|---|
| `rpk-linux-amd64.zip`, `rpk-linux-arm64.zip` | Linux builds |
| `rpk-darwin-amd64.zip`, `rpk-darwin-arm64.zip` | macOS builds (Intel, Apple Silicon) |
| `rpk_<version>_checksums.txt` | SHA-256 checksums (the file name carries no leading `v`) |
| `rpk_checksums.txt` | SHA-256 checksums, `latest/` only |

Each archive contains a single `rpk` binary (no external deps).

For the versions available, see the Redpanda release notes:
`https://docs.redpanda.com/streaming/current/reference/releases/redpanda/`

---

## Next steps

- [profiles.md](profiles.md): Create an rpk profile to avoid typing connection
  flags on every command.
- [x-flags-and-config.md](x-flags-and-config.md): Reference for all -X options
  and environment variables.
