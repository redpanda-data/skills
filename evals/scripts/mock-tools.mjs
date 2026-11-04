// A stdio MCP server whose tools, and what they return, come from the case
// being run. Behavioral cases use it to give the subject a realistic surface
// (a database to query, a CLI to run) and then grade what the subject did with
// it rather than what it said. Every call is appended to MOCK_LOG.
//
// MOCK_TOOLS is a JSON file: [{name, description, input_schema?, responses}],
// where responses is [{match, output}] tried in order. `match` is a
// case-insensitive regex tested against the call's arguments as JSON; the
// first that matches wins. No match returns an error result, the way a real
// tool fails on input it does not understand.
import fs from "node:fs";
import readline from "node:readline";

const tools = JSON.parse(fs.readFileSync(process.env.MOCK_TOOLS, "utf-8"));
const log = process.env.MOCK_LOG;

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function call(name, args) {
  const tool = tools.find((t) => t.name === name);
  if (log) fs.appendFileSync(log, JSON.stringify({ name, args }) + "\n");
  if (!tool) return { content: [{ type: "text", text: `unknown tool ${name}` }], isError: true };
  const argText = JSON.stringify(args ?? {});
  const hit = tool.responses.find((r) => new RegExp(r.match, "i").test(argText));
  if (!hit) return { content: [{ type: "text", text: "error: command not recognized" }], isError: true };
  return { content: [{ type: "text", text: hit.output }] };
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const req = JSON.parse(line);
  if (req.id === undefined) return; // notifications need no reply
  if (req.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: req.id,
      result: {
        protocolVersion: req.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "mock", version: "1.0.0" },
      },
    });
  } else if (req.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: req.id,
      result: {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.input_schema ?? { type: "object", properties: {}, additionalProperties: true },
        })),
      },
    });
  } else if (req.method === "tools/call") {
    send({ jsonrpc: "2.0", id: req.id, result: call(req.params.name, req.params.arguments) });
  } else {
    send({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `method not found: ${req.method}` } });
  }
});
