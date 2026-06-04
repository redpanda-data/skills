# Skill Evaluation Framework

This directory contains evaluation tasks for testing skill efficacy. Each skill is tested under three conditions:

1. **Baseline**: No skill loaded, agent uses base knowledge only
2. **Skill-enhanced**: With skill loaded
3. **Negative transfer check**: Simple tasks where skill might over-complicate

## Directory Structure

```
evals/
├── README.md           # This file
├── streaming/          # Streaming product eval tasks
├── connect/            # Connect product eval tasks
├── sql/                # SQL product eval tasks
├── cloud/              # Cloud product eval tasks
└── rpk/                # rpk CLI eval tasks
```

## Eval Task Format

Each YAML file contains tasks for a specific skill or skill group:

```yaml
name: streaming-topic-creation
skill: streaming
version: "1.0"

tasks:
  - id: basic-topic
    prompt: "Create a Redpanda topic named 'orders' with 6 partitions and replication factor 3"
    expected_commands:
      - pattern: "rpk topic create orders -p 6 -r 3"
        required: true
    validation:
      type: command_execution
      success_criteria:
        - topic_exists: orders
        - partition_count: 6
        - replication_factor: 3

  - id: tiered-storage-topic
    prompt: "Create a topic with tiered storage enabled"
    expected_commands:
      - pattern: "rpk topic create .* -c redpanda.storage.mode=tiered"
        required: true

  - id: negative-transfer-check
    prompt: "What's the simplest way to produce a message to Redpanda?"
    type: negative_transfer_check
    acceptable_responses:
      - contains: "rpk topic produce"
      - contains: "echo.*| rpk topic produce"
    must_not:
      - require_enterprise_features: true
      - complexity_score: "> 3"
```

## Task Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Unique task identifier |
| `prompt` | string | The task prompt given to the agent |
| `expected_commands` | array | Commands expected in the response |
| `validation` | object | How to validate success |
| `type` | string | Task type (default: standard, or `negative_transfer_check`) |
| `acceptable_responses` | array | Valid response patterns for negative transfer checks |
| `must_not` | object | Constraints for negative transfer checks |

## Metrics

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Pass Rate Delta | >0 | <0 (block merge) |
| Negative Transfer Tasks | 0 | >2 per skill |
| Hallucination Rate | <5% | >10% |

## Running Evals

```bash
# Run evals for a specific skill
npm run eval -- --skill streaming

# Run all evals
npm run eval -- --all

# Run with baseline comparison
npm run eval -- --skill streaming --compare-baseline

# Generate report
npm run eval -- --skill streaming --report
```

## CI Integration

- **eval-ci.yaml**: Runs on every PR to skills/, blocks merge if negative transfer
- **eval-regression.yaml**: Weekly full suite run

## Adding New Evals

1. Create a new YAML file in the appropriate directory
2. Include at least 5 tasks per skill
3. Include at least 1 `negative_transfer_check` task
4. Run locally to verify: `npm run eval -- --skill <skill-name>`
5. Submit PR

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full contribution workflow.
