#!/usr/bin/env bash
# Ask one question in one arm and print the answer. For screening candidate
# cases while writing a suite; the graded runs go through run-evals.ts.
#
#   evals/scripts/probe.sh baseline|skill|docs|both <skill> "<query>"
set -euo pipefail
arm=$1 skill=$2 query=$3
root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

args=(-p "$query" --output-format json --strict-mcp-config --setting-sources ""
  --disable-slash-commands --no-session-persistence)

if [[ $arm == skill || $arm == both ]]; then
  ctx=$work/context.md
  node "$root/evals/scripts/skill-context.mjs" "$root" "$skill" > "$ctx"
  args+=(--append-system-prompt-file "$ctx")
fi
if [[ $arm == docs || $arm == both ]]; then
  printf '{"mcpServers":{"redpanda-docs":{"type":"http","url":"https://docs.redpanda.com/mcp"}}}' > "$work/mcp.json"
  args+=(--mcp-config "$work/mcp.json" --tools CronList
    --allowed-tools "mcp__redpanda-docs__ask_redpanda_question,mcp__redpanda-docs__search_api_reference,mcp__redpanda-docs__get_api_reference_content,mcp__redpanda-docs__list_api_reference_pages,mcp__redpanda-docs__get_config_property,mcp__redpanda-docs__list_config_properties,mcp__redpanda-docs__get_connect_component,mcp__redpanda-docs__list_connect_components"
    --disallowed-tools "mcp__redpanda-docs__give_feedback")
else
  args+=(--tools CronList)
fi
cd "$work"
claude "${args[@]}" < /dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(r.result);console.error(`[cost $${(r.total_cost_usd??0).toFixed(3)}]`)})'
