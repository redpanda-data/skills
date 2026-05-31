# rpk Install Reference

`rpk` is a single static binary with no runtime dependencies. Install it on
macOS, Linux, or any platform via Docker. On self-managed Redpanda nodes rpk
is pre-installed alongside the broker; install it separately as a standalone
client when you need to talk to a remote cluster.

> **Version matching**: When using rpk as a standalone client against a
> self-managed Redpanda cluster, your rpk version should match the cluster
> version. For Redpanda Cloud always use the latest rpk.

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
# Latest version
curl -LO https://github.com/redpanda-data/redpanda/releases/latest/download/rpk-darwin-arm64.zip \
  && mkdir -p ~/.local/bin \
  && export PATH="$HOME/.local/bin:$PATH" \
  && unzip rpk-darwin-arm64.zip -d ~/.local/bin/

# Specific version (replace <version> with e.g. 24.3.1)
curl -LO https://github.com/redpanda-data/redpanda/releases/download/v<version>/rpk-darwin-arm64.zip \
  && mkdir -p ~/.local/bin \
  && export PATH="$HOME/.local/bin:$PATH" \
  && unzip rpk-darwin-arm64.zip -d ~/.local/bin/
```

### Manual — Intel macOS

```bash
# Latest version
curl -LO https://github.com/redpanda-data/redpanda/releases/latest/download/rpk-darwin-amd64.zip \
  && mkdir -p ~/.local/bin \
  && export PATH="$HOME/.local/bin:$PATH" \
  && unzip rpk-darwin-amd64.zip -d ~/.local/bin/

# Specific version
curl -LO https://github.com/redpanda-data/redpanda/releases/download/v<version>/rpk-darwin-amd64.zip \
  && mkdir -p ~/.local/bin \
  && export PATH="$HOME/.local/bin:$PATH" \
  && unzip rpk-darwin-amd64.zip -d ~/.local/bin/
```

---

## Linux

### amd64

```bash
# Latest version
curl -LO https://github.com/redpanda-data/redpanda/releases/latest/download/rpk-linux-amd64.zip \
  && mkdir -p ~/.local/bin \
  && export PATH="$HOME/.local/bin:$PATH" \
  && unzip rpk-linux-amd64.zip -d ~/.local/bin/

# Specific version
curl -LO https://github.com/redpanda-data/redpanda/releases/download/v<version>/rpk-linux-amd64.zip \
  && mkdir -p ~/.local/bin \
  && export PATH="$HOME/.local/bin:$PATH" \
  && unzip rpk-linux-amd64.zip -d ~/.local/bin/
```

### arm64

```bash
# Latest version
curl -LO https://github.com/redpanda-data/redpanda/releases/latest/download/rpk-linux-arm64.zip \
  && mkdir -p ~/.local/bin \
  && export PATH="$HOME/.local/bin:$PATH" \
  && unzip rpk-linux-arm64.zip -d ~/.local/bin/

# Specific version
curl -LO https://github.com/redpanda-data/redpanda/releases/download/v<version>/rpk-linux-arm64.zip \
  && mkdir -p ~/.local/bin \
  && export PATH="$HOME/.local/bin:$PATH" \
  && unzip rpk-linux-arm64.zip -d ~/.local/bin/
```

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

## Release archive

All releases and their checksums are at:
`https://github.com/redpanda-data/redpanda/releases/`

Each release archive contains a single `rpk` binary (no external deps).

---

## Next steps

- [profiles.md](profiles.md): Create an rpk profile to avoid typing connection
  flags on every command.
- [x-flags-and-config.md](x-flags-and-config.md): Reference for all -X options
  and environment variables.
