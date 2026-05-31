# Oxla Cluster Topology and Deployment

## Cluster Model

An Oxla cluster consists of one **leader** node and zero or more **worker** nodes. The leader is designated by setting `leader_election.leader_name` to the `host_name` of the intended leader. Every node in the cluster must have:

- The same `network.cluster_name` value
- A unique `network.host_name` value
- `leader_election.leader_name` set to the hostname of the leader node

A node whose `host_name` matches `leader_name` boots as the leader. All other nodes boot as workers and discover the leader through the inter-node port (default 5771).

```
                    Client (psql/JDBC)
                          |
                       port 5432
                          |
             ┌────────────┴────────────┐
             │       Leader Node       │
             │   cluster_name=cluster  │
             │   host_name=oxla_node_1 │
             │   leader_name=oxla_node_1│
             └──────────5771───────────┘
                    /           \
              5771 /             \ 5771
                  /               \
     ┌────────────┴───┐    ┌───────┴────────────┐
     │  Worker Node 2  │    │   Worker Node 3     │
     │  host_name=     │    │   host_name=        │
     │  oxla_node_2    │    │   oxla_node_3       │
     │  leader_name=   │    │   leader_name=      │
     │  oxla_node_1    │    │   oxla_node_1       │
     └─────────────────┘    └────────────────────┘
```

**Port summary per node:**

| Port | Purpose | Required externally? |
|------|---------|---------------------|
| 5432 | PostgreSQL client connections | Yes (for SQL clients) |
| 5770 | Slot (pipeline data) between nodes | Nodes only |
| 5771 | Inter-node discovery + heartbeat | Nodes only |
| 8080 | Prometheus metrics | Optional (monitoring) |
| 9090 | Admin API (ConnectRPC) | Optional (ops) |

---

## Single-Node Deployment

For a single node, `leader_name` and `host_name` are the same value. There is no inter-node communication.

### Minimal Docker run

```bash
docker run --rm -it \
  -p 5432:5432 \
  -p 8080:8080 \
  -p 9090:9090 \
  -e OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1 \
  -e OXLA__STORAGE__OXLA_HOME=/oxla/data \
  -e OXLA__LOGGING__LEVEL=INFO \
  778696301129.dkr.ecr.eu-central-1.amazonaws.com/oxla-devel:latest
```

### Single-node with persistence (local volume)

```bash
docker run --rm -it \
  -p 5432:5432 \
  -p 8080:8080 \
  -p 9090:9090 \
  -v oxla_data:/oxla/data \
  -v /path/to/logs:/oxla/logs \
  -e OXLA_LOG_FILE=/oxla/logs/oxla_node_1.log \
  -e OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1 \
  -e OXLA__STORAGE__OXLA_HOME=/oxla/data \
  -e OXLA__LOGGING__LEVEL=INFO \
  778696301129.dkr.ecr.eu-central-1.amazonaws.com/oxla-devel:latest
```

### Single-node with S3 storage (MinIO example)

This matches the `one_node_minio_no_cas.yml` reference configuration:

```bash
# 1. Start MinIO
docker run -d --name minio \
  -e MINIO_ROOT_USER=oxla-user \
  -e MINIO_ROOT_PASSWORD=oxla-password \
  -e MINIO_REGION=oxla-region \
  minio/minio:RELEASE.2023-09-30T07-02-29Z server /data

# 2. Create bucket
docker exec minio mc alias set local http://localhost:9000 oxla-user oxla-password
docker exec minio mc mb local/oxla-data

# 3. Run Oxla with S3 home
docker run --rm -it \
  -p 5432:5432 \
  --link minio \
  -e OXLA__STORAGE__OXLA_HOME=s3://oxla-data/oxla_home \
  -e OXLA__STORAGE__S3__ENDPOINT=http://minio:9000 \
  -e AWS_DEFAULT_REGION=oxla-region \
  -e AWS_ACCESS_KEY_ID=oxla-user \
  -e AWS_SECRET_ACCESS_KEY=oxla-password \
  -e OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1 \
  -e OXLA__FEATURE_FLAGS__ALLOW_TABLE_OPERATIONS=true \
  -e OXLA__FEATURE_FLAGS__ALLOW_NONATOMIC_STORAGE=true \
  -e OXLA__DISTRIBUTED_CATALOG__CACHE_ENABLED=false \
  -e OXLA__DISTRIBUTED_CATALOG__CACHE_CONSISTENCY_ENABLED=false \
  778696301129.dkr.ecr.eu-central-1.amazonaws.com/oxla-devel:latest
```

Note: MinIO (pre-late-2024 versions) does not fully support If-Match/Compare-and-Swap. Disable the distributed catalog CAS features as shown above.

---

## Multi-Node Docker Compose

### Three-node cluster (local storage)

The simplified illustrative three-node compose below is based on the repo's `tests/blackbox/configurations/three_nodes.yml`. Key observations:
- All three nodes share the same `oxla_data_persistence` and `oxla_shmem` volumes
- `OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1` on all three nodes
- Each node has a unique `OXLA__NETWORK__HOST_NAME`
- `OXLA__SHARED_MEMORY__CLUSTER__PATH=/oxla/shmem` and a shared Docker volume

> **Note:** The actual repo file (`tests/blackbox/configurations/three_nodes.yml`) differs from this example: it hard-requires `AWS_DEFAULT_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` (using `?err` substitution, so compose errors out if they are unset); it uses `OXLA__LOGGING__LEVEL=verbose` (not INFO); it does not set `OXLA__NETWORK__CLUSTER_NAME` (relying on the default `cluster_1`); and it passes several additional vars (`OXLA__INSERTION__BUFFER_TIMEOUT`, `OXLA_PROCESS_UID/GID`, etc.). The example below is simplified for clarity — see the actual repo file for the authoritative form.

```yaml
# docker-compose.yml — three-node cluster
volumes:
  oxla_data_persistence:
  oxla_shmem:

services:
  oxla_node_1:
    image: 778696301129.dkr.ecr.eu-central-1.amazonaws.com/oxla-devel:latest
    stop_grace_period: 3m
    security_opt:
      - seccomp:unconfined
    volumes:
      - oxla_data_persistence:/oxla/data
      - oxla_shmem:/oxla/shmem
      - ./logs:/oxla/logs
    environment:
      - OXLA__NETWORK__HOST_NAME=oxla_node_1
      - OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1
      - OXLA__NETWORK__CLUSTER_NAME=cluster_1    # must match all nodes
      - OXLA__SHARED_MEMORY__CLUSTER__PATH=/oxla/shmem
      - OXLA__STORAGE__OXLA_HOME=/oxla/data
      - OXLA__LOGGING__LEVEL=INFO
      - OXLA__FEATURE_FLAGS__ALLOW_TABLE_OPERATIONS=true
      - OXLA__FEATURE_FLAGS__ALLOW_NONATOMIC_STORAGE=true
      - OXLA__FEATURE_FLAGS__ARRAY_SUPPORT=TRUE
      - OXLA_LOG_FILE=/oxla/logs/oxla_node_1.log
      - OXLA_ENCRYPTION_KEY=<hex-string-up-to-64-chars>
    ulimits:
      nofile:
        soft: 20000
        hard: 40000

  oxla_node_2:
    image: 778696301129.dkr.ecr.eu-central-1.amazonaws.com/oxla-devel:latest
    stop_grace_period: 3m
    security_opt:
      - seccomp:unconfined
    volumes:
      - oxla_data_persistence:/oxla/data
      - oxla_shmem:/oxla/shmem
      - ./logs:/oxla/logs
    environment:
      - OXLA__NETWORK__HOST_NAME=oxla_node_2            # unique per node
      - OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1  # same as node_1
      - OXLA__NETWORK__CLUSTER_NAME=cluster_1
      - OXLA__SHARED_MEMORY__CLUSTER__PATH=/oxla/shmem
      - OXLA__STORAGE__OXLA_HOME=/oxla/data
      - OXLA__LOGGING__LEVEL=INFO
      - OXLA__FEATURE_FLAGS__ALLOW_TABLE_OPERATIONS=true
      - OXLA__FEATURE_FLAGS__ALLOW_NONATOMIC_STORAGE=true
      - OXLA__FEATURE_FLAGS__ARRAY_SUPPORT=TRUE
      - OXLA_LOG_FILE=/oxla/logs/oxla_node_2.log
      - OXLA_ENCRYPTION_KEY=<hex-string-up-to-64-chars>
    ulimits:
      nofile:
        soft: 20000
        hard: 40000

  oxla_node_3:
    image: 778696301129.dkr.ecr.eu-central-1.amazonaws.com/oxla-devel:latest
    stop_grace_period: 3m
    security_opt:
      - seccomp:unconfined
    volumes:
      - oxla_data_persistence:/oxla/data
      - oxla_shmem:/oxla/shmem
      - ./logs:/oxla/logs
    environment:
      - OXLA__NETWORK__HOST_NAME=oxla_node_3            # unique per node
      - OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1  # same as node_1
      - OXLA__NETWORK__CLUSTER_NAME=cluster_1
      - OXLA__SHARED_MEMORY__CLUSTER__PATH=/oxla/shmem
      - OXLA__STORAGE__OXLA_HOME=/oxla/data
      - OXLA__LOGGING__LEVEL=INFO
      - OXLA__FEATURE_FLAGS__ALLOW_TABLE_OPERATIONS=true
      - OXLA__FEATURE_FLAGS__ALLOW_NONATOMIC_STORAGE=true
      - OXLA__FEATURE_FLAGS__ARRAY_SUPPORT=TRUE
      - OXLA_LOG_FILE=/oxla/logs/oxla_node_3.log
      - OXLA_ENCRYPTION_KEY=<hex-string-up-to-64-chars>
    ulimits:
      nofile:
        soft: 20000
        hard: 40000
```

### Use the reference configurations directly

The repo ships reference Compose files at `tests/blackbox/configurations/`:

```bash
# Three-node cluster (with port exposure overlay)
docker compose \
  -f tests/blackbox/configurations/three_nodes.yml \
  -f tests/blackbox/configurations/three_nodes_ports.yml \
  up

# Three-node cluster with explicit Docker bridge network
docker compose \
  -f tests/blackbox/configurations/three_nodes_with_network.yml \
  up

# Single node (used in CI/blackbox tests)
docker compose \
  -f tests/blackbox/configurations/one_node.yml \
  up
```

---

## TLS Configuration

For TLS client connections, see the SSL section in [configuration.md](configuration.md). The `one_node_ssl.yml` reference mounts certs from `configurations/certs/`:

```bash
docker run --rm -it \
  -p 5432:5432 \
  -v /path/to/certs:/ssl \
  -e OXLA__SSL__MODE=optional \
  -e OXLA__SSL__CERT_FILE=/ssl/tls.crt \
  -e OXLA__SSL__KEY_FILE=/ssl/tls.key \
  -e OXLA__SSL__MIN_PROTOCOL_VERSION=1.2 \
  -e OXLA__SSL__MAX_PROTOCOL_VERSION=1.3 \
  -e OXLA__ACCESS_CONTROL__MODE=on \
  -e OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1 \
  778696301129.dkr.ecr.eu-central-1.amazonaws.com/oxla-devel:latest
```

---

## Environment Variables Reference for Deployment

### Essential per-node variables

```bash
OXLA__NETWORK__CLUSTER_NAME=cluster_1        # same on all nodes
OXLA__NETWORK__HOST_NAME=oxla_node_1         # unique per node
OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1  # leader's host_name, same on all nodes
OXLA__STORAGE__OXLA_HOME=/oxla/data          # or s3://... gs://... az://...
OXLA_LOG_FILE=/oxla/logs/oxla_node_1.log     # log file path (not YAML; directly read)
OXLA_ENCRYPTION_KEY=<hex-string>            # encryption key: up to 64 hex chars; shorter values are accepted
                                             # and expanded internally to a 32-byte/256-bit key.
                                             # Recommended: use the full 64 hex chars for maximum entropy.
```

### Memory sizing (set when you know your RAM)

```bash
OXLA__MEMORY__MAX=32G            # 0 = auto-detect
OXLA__MEMORY__MAX_NON_QUERY=6442M
```

### Feature flags commonly set in production

```bash
OXLA__FEATURE_FLAGS__ALLOW_TABLE_OPERATIONS=true
OXLA__FEATURE_FLAGS__ALLOW_NONATOMIC_STORAGE=true
OXLA__FEATURE_FLAGS__ARRAY_SUPPORT=TRUE
OXLA__FEATURE_FLAGS__FORCE_LARGE_INSERTIONS=true
```

### Shared memory for multi-node

```bash
OXLA__SHARED_MEMORY__CLUSTER__PATH=/oxla/shmem
OXLA__SHARED_MEMORY__CLUSTER__MONITORING_PERIOD=5000
```

### Cloud storage auth

**AWS S3:**
```bash
AWS_DEFAULT_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI...
# Optional for custom endpoint:
OXLA__STORAGE__S3__ENDPOINT=https://s3.example.com
```

**GCS:**
```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

**Azure:**
```bash
AZURE_CLIENT_ID=<app-id>
AZURE_CLIENT_SECRET=<secret>
AZURE_TENANT_ID=<tenant-id>
OXLA__STORAGE__AZURE__ACCOUNT_NAME=<storage-account-name>
```

---

## Config File Mounting

Mount a directory containing `config.yml`:

```bash
docker run --rm -it \
  -p 5432:5432 \
  -v /path/to/my/config:/oxla/startup_config \
  778696301129.dkr.ecr.eu-central-1.amazonaws.com/oxla-devel:latest
```

The config file does not need to be complete. A minimal `config.yml` for a single node with S3 storage:

```yaml
network:
  cluster_name: "production"
  host_name: "node1"

leader_election:
  leader_name: "node1"

storage:
  oxla_home: "s3://my-bucket/oxla_home"

logging:
  level: "INFO"

access_control:
  mode: "on"
  initial_password: "change-me-in-production"
```

All other settings will use compiled defaults.

---

## Resource Limits and ulimits

In production and the reference Docker Compose files, set the file descriptor limit:

```yaml
ulimits:
  nofile:
    soft: 20000
    hard: 40000
```

Also set `security_opt: [seccomp:unconfined]` as shown in the reference configurations.

---

## Ansible Deployment

The repo ships two Ansible playbooks under `ansible/` for deploying Oxla to real (non-Docker-only) servers.

### Playbooks

| Playbook | Target | Notes |
|----------|--------|-------|
| `ansible/devcluster_deploy.yml` | Hetzner or any bare-metal/VM host (Docker-based) | Installs Docker, AWS CLI, Node Exporter, then templates `config.yml.j2` and runs `docker compose up` |
| `ansible/devcluster_deploy_aws.yml` | AWS EC2 instances provisioned by Terraform | Assumes Docker + AWS CLI already installed via EC2 userdata; templates `config_aws.yml.j2` and runs `docker compose up`. Also deploys optional Redpanda nodes and a client node. |

### Jinja2 compose templates

The playbooks generate a `~/oxla/config.yml` Docker Compose file from one of two Jinja2 templates:

- `ansible/templates/config.yml.j2` — for Hetzner/bare-metal deployments. Key variables:
  - `image` — Docker image to pull (default: `harbor.oxladb.dev/oxla-ci/oxla-daily:latest`)
  - `host_name` — set to `{{ inventory_hostname }}`
  - `leader_name` — first host in the play (`hostvars[ansible_play_hosts[0]].ansible_host`)
  - `oxla_home` — `{{ oxla_home_prefix }}/{{ oxla_home_name }}` (e.g., `s3://devcluster-aws-c5a-8xlarge/home:ro`)
  - `OXLA__MEMORY__MAX` — auto-sized to 80% of node RAM (`ansible_memtotal_mb * 0.8`)
  - `OXLA_ENCRYPTION_KEY` — fixed demo key in the template (`0123456789abcdef...`); override for production
  - Hetzner-specific S3 credentials read from `aws configure get … --profile minio`

- `ansible/templates/config_aws.yml.j2` — for AWS EC2 deployments. Same structure but:
  - Uses the node's `private_ip` as `OXLA__NETWORK__HOST_NAME` and `leader_name` (avoids AWS data-transfer charges for inter-node traffic)
  - `oxla_home_path` — `s3://{{ devcluster_bucket_name }}/{{ oxla_home_name }}`
  - `OXLA__ACCESS_CONTROL__INITIAL_PASSWORD` — rendered from the inventory var `oxla_password` (generated or SSM-provided)
  - AWS region hardcoded to `eu-central-1` in the template; override with the `aws_region` var

### Inventory files

Inventory files live under `ansible/inventory/`. Static inventories are provided for named devclusters:

```
ansible/inventory/
  devcluster-aws-c5a-8xlarge.yml      # 3-node c5a.8xlarge AWS cluster
  devcluster-aws-c5a-8xlarge-1node.yml
  devcluster-hetzner-ax102-3nodes.yml  # 3-node Hetzner AX102 cluster
  devcluster-hetzner-ax41-1node.yml
  ...
```

AWS inventories set `cluster_type` to drive per-cluster S3 bucket naming and MinIO/S3 credential selection inside the template. Example from `devcluster-aws-c5a-8xlarge.yml`:

```yaml
devcluster_aws_c5a_8xlarge:
  hosts:
    n1_devcluster_aws_c5a_8xlarge:
      ansible_host: n1.devcluster-aws-c5a-8xlarge.oxladb.dev
    n2_devcluster_aws_c5a_8xlarge:
      ansible_host: n2.devcluster-aws-c5a-8xlarge.oxladb.dev
    n3_devcluster_aws_c5a_8xlarge:
      ansible_host: n3.devcluster-aws-c5a-8xlarge.oxladb.dev
  vars:
    provider: aws
    machine_type: c5a-8xlarge
    ansible_user: ubuntu
    cluster_type: devcluster-aws-c5a-8xlarge
    oxla_home_prefix: s3://devcluster-aws-c5a-8xlarge
    oxla_home_name: home:ro
```

### Running a deployment

```bash
# Install Ansible collections
ansible-galaxy collection install -r ansible/requirements.yml

# Deploy to a Hetzner cluster (install Docker + deploy Oxla)
ansible-playbook ansible/devcluster_deploy.yml \
  -i ansible/inventory/devcluster-hetzner-ax102-3nodes.yml \
  -e image=778696301129.dkr.ecr.eu-central-1.amazonaws.com/oxla-devel:latest \
  -e oxla_home_prefix=s3://my-devcluster \
  -e oxla_home_name=home

# Deploy to AWS EC2 instances (Docker pre-installed via Terraform userdata)
ansible-playbook ansible/devcluster_deploy_aws.yml \
  -i /path/to/generated-ansible-inventory.yml \
  -e image=778696301129.dkr.ecr.eu-central-1.amazonaws.com/oxla-daily:latest

# Stop a deployment without destroying nodes
ansible-playbook ansible/devcluster_deploy.yml \
  -i ansible/inventory/devcluster-hetzner-ax102-3nodes.yml \
  --tags stop
```

---

## Terraform Deployment

The repo's `terraform/devcluster/` module provisions dynamic AWS EC2 instances for Oxla devclusters.

### What it provisions

- **EC2 instances** — `var.devcluster_node_count` nodes (default `c6i.xlarge`), Ubuntu 22.04, sized with `var.devcluster_root_volume_size` (default 256 GB gp3)
- **S3 bucket** — dedicated bucket for `OXLA__STORAGE__OXLA_HOME` (named `{environment}-{devcluster_type}[-{alias}]`)
- **IAM role + instance profile** — grants each EC2 node S3 full access to its home bucket, read-only access to a shared blueprint bucket, and ECR pull access
- **VPC/subnet** — reuses an existing `redpanda-gh-vpc` if found; otherwise creates a new VPC
- **EC2 userdata** — `terraform/devcluster/userdata.sh` bootstraps Docker, AWS CLI, the ECR credential helper, Node Exporter, and optionally copies an Oxla home blueprint from S3
- **Ansible inventory** — `terraform/devcluster/templates/ansible-inventory.yml.tpl` renders a ready-to-use inventory file (output via `terraform output`) with `oxla_nodes`, optional `redpanda`, and optional `client` groups

### Key variables

| Variable | Default | Description |
|----------|---------|-------------|
| `devcluster_node_count` | `1` | Number of Oxla nodes (1–10) |
| `devcluster_instance_type` | `c6i.xlarge` | EC2 instance type (auto-detects x86 vs arm) |
| `devcluster_alias` | `""` | Short alias appended to cluster/bucket name |
| `devcluster_bucket_name` | auto-generated | Override the S3 bucket name |
| `devcluster_home_name` | `home` | Name of the Oxla home path within the bucket |
| `oxla_password` | random 16-char | Oxla access_control password; injected via `OXLA__ACCESS_CONTROL__INITIAL_PASSWORD` |
| `enable_prometheus` | `false` | Deploy a dedicated Prometheus node |
| `enable_glue` | `false` | Provision AWS Glue Iceberg catalog + IAM policy |
| `devcluster_copy_blueprint_in_userdata` | `false` | Copy existing Oxla home from blueprint bucket at boot |

### Typical workflow

```bash
cd terraform/devcluster

# Provision infrastructure
terraform init
terraform apply \
  -var="devcluster_node_count=3" \
  -var="devcluster_instance_type=c5a.8xlarge" \
  -var="devcluster_alias=my-test"

# Retrieve the generated Ansible inventory
terraform output -raw ansible_inventory > /tmp/devcluster-inventory.yml

# Deploy Oxla onto the provisioned nodes
ansible-playbook ansible/devcluster_deploy_aws.yml \
  -i /tmp/devcluster-inventory.yml \
  -e image=778696301129.dkr.ecr.eu-central-1.amazonaws.com/oxla-daily:latest

# Tear down
terraform destroy
```

The Terraform module auto-detects CPU architecture from the instance type (ARM Graviton instances like `r6g` vs x86 instances like `r6a`/`c6i`) and selects the matching Ubuntu 22.04 AMI accordingly.
