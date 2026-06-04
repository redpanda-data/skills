#!/usr/bin/env node
/**
 * Skill Evaluation Runner
 *
 * Runs skill evaluations to measure efficacy across three conditions:
 * - Baseline: No skill, no docs (pure base model)
 * - Docs MCP: Agent can search Redpanda docs via tool use
 * - Skill-enhanced: With skill loaded in context
 *
 * Usage:
 *   node scripts/eval-runner.js --skill streaming
 *   node scripts/eval-runner.js --skill streaming --compare-baseline
 *   node scripts/eval-runner.js --skill streaming --compare-docs
 *   node scripts/eval-runner.js --skill streaming --compare-all
 *   node scripts/eval-runner.js --all --report
 *
 * Environment:
 *   ANTHROPIC_API_KEY - Required for actual LLM evaluation
 *   REDPANDA_DOCS_API - Optional: Custom docs search endpoint
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  skill: null,
  all: false,
  compareBaseline: false,
  compareDocs: false,
  compareAll: false,
  report: false,
  dryRun: false,
  model: 'claude-sonnet-4-6',
  docsEndpoint: process.env.REDPANDA_DOCS_API || 'https://docs.redpanda.com',
  delayMs: 5000, // Delay between API calls to avoid rate limits
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--skill':
      options.skill = args[++i];
      break;
    case '--all':
      options.all = true;
      break;
    case '--compare-baseline':
      options.compareBaseline = true;
      break;
    case '--compare-docs':
      options.compareDocs = true;
      break;
    case '--compare-all':
      options.compareAll = true;
      options.compareBaseline = true;
      options.compareDocs = true;
      break;
    case '--report':
      options.report = true;
      break;
    case '--dry-run':
      options.dryRun = true;
      break;
    case '--model':
      options.model = args[++i];
      break;
    case '--docs-endpoint':
      options.docsEndpoint = args[++i];
      break;
    case '--delay':
      options.delayMs = parseInt(args[++i]);
      break;
    case '--help':
      console.log(`
Skill Evaluation Runner

Usage:
  node scripts/eval-runner.js --skill <skill-name>  Run evals for a specific skill
  node scripts/eval-runner.js --all                 Run all evals
  node scripts/eval-runner.js --compare-baseline    Compare with baseline (no skill, no docs)
  node scripts/eval-runner.js --compare-docs        Compare with docs MCP (tool use)
  node scripts/eval-runner.js --compare-all         Run all three conditions
  node scripts/eval-runner.js --report              Generate detailed report
  node scripts/eval-runner.js --dry-run             Parse evals without running

Options:
  --skill <name>       Skill to evaluate (e.g., streaming, connect)
  --all                Run evaluations for all skills
  --compare-baseline   Run baseline comparison (no skill, no docs)
  --compare-docs       Run docs MCP comparison (agent has docs search tool)
  --compare-all        Run all three conditions (baseline, docs, skill)
  --report             Generate detailed JSON report
  --dry-run            Parse and validate eval files without running
  --model <name>       Model to use (default: claude-sonnet-4-6)
  --docs-endpoint      Custom docs search endpoint
  --delay <ms>         Delay between API calls in ms (default: 5000)
  --help               Show this help message

Environment:
  ANTHROPIC_API_KEY    Required for actual LLM evaluation
  REDPANDA_DOCS_API    Optional: Custom docs search endpoint

Eval Conditions:
  1. Baseline:      No skill, no tools - pure base model knowledge
  2. Docs MCP:      No skill, but agent can search docs via tool_use
  3. Skill-enhanced: Skill loaded in system prompt, no tools
      `);
      process.exit(0);
  }
}

const EVALS_DIR = path.join(__dirname, '..', 'evals');
const SKILLS_DIR = path.join(__dirname, '..', 'skills');
const RESULTS_DIR = path.join(__dirname, '..', 'results');

// Lazy-load Anthropic SDK
let Anthropic = null;
let anthropicClient = null;

function getAnthropicClient() {
  if (!anthropicClient) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    if (!Anthropic) {
      Anthropic = require('@anthropic-ai/sdk').default;
    }
    anthropicClient = new Anthropic();
  }
  return anthropicClient;
}

/**
 * Tool definition for docs search
 */
const DOCS_SEARCH_TOOL = {
  name: 'search_redpanda_docs',
  description: 'Search the official Redpanda documentation for information about Redpanda, rpk CLI, configuration, and streaming concepts. Returns relevant documentation sections.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query to find relevant documentation'
      }
    },
    required: ['query']
  }
};

/**
 * Fetch docs content using the real Redpanda docs MCP at https://docs.redpanda.com/mcp
 */
async function searchDocs(query) {
  try {
    const mcpEndpoint = 'https://docs.redpanda.com/mcp';

    const response = await fetch(mcpEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'ask_redpanda_question',
          arguments: { question: query }
        }
      })
    });

    if (!response.ok) {
      return `Could not fetch documentation for query: ${query}. Status: ${response.status}`;
    }

    const text = await response.text();

    // Parse SSE response - format is "event: message\ndata: {...}"
    const dataMatch = text.match(/data:\s*(\{[\s\S]*\})/);
    if (!dataMatch) {
      return `No data in MCP response for query: ${query}`;
    }

    const data = JSON.parse(dataMatch[1]);

    // Extract text content from result
    if (data.result && data.result.content) {
      const textContent = data.result.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n\n');

      // Truncate to reasonable size for context
      if (textContent.length > 12000) {
        return textContent.substring(0, 12000) + '...';
      }
      return textContent;
    }

    return `No content found for query: ${query}`;
  } catch (err) {
    return `Error searching docs MCP: ${err.message}`;
  }
}

/**
 * Load all eval files for a skill
 */
function loadEvals(skillName) {
  const evalDir = path.join(EVALS_DIR, skillName);

  if (!fs.existsSync(evalDir)) {
    console.error(`No evals found for skill: ${skillName}`);
    return [];
  }

  const files = fs.readdirSync(evalDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  const evals = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(evalDir, file), 'utf8');
      const evalData = yaml.load(content);
      evals.push({ file, ...evalData });
    } catch (err) {
      console.error(`Error loading ${file}: ${err.message}`);
    }
  }

  return evals;
}

/**
 * Load a skill's content including references
 */
function loadSkill(skillName) {
  const skillDir = path.join(SKILLS_DIR, skillName);
  const skillPath = path.join(skillDir, 'SKILL.md');

  if (!fs.existsSync(skillPath)) {
    console.error(`Skill not found: ${skillName}`);
    return null;
  }

  const content = fs.readFileSync(skillPath, 'utf8');

  // Parse frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  let metadata = {};
  if (frontmatterMatch) {
    metadata = yaml.load(frontmatterMatch[1]);
  }

  // Load reference files
  const references = [];
  const refsDir = path.join(skillDir, 'references');
  if (fs.existsSync(refsDir)) {
    const refFiles = fs.readdirSync(refsDir).filter(f => f.endsWith('.md'));
    for (const refFile of refFiles) {
      const refContent = fs.readFileSync(path.join(refsDir, refFile), 'utf8');
      references.push({ file: refFile, content: refContent });
    }
  }

  return {
    name: skillName,
    metadata,
    content,
    references,
  };
}

/**
 * Build system prompt with optional skill content
 */
function buildSystemPrompt(skill = null, condition = 'baseline') {
  let systemPrompt = `You are a helpful assistant that specializes in Redpanda, a Kafka-compatible streaming platform.
Provide accurate, concise answers. When asked to perform tasks, provide the exact commands or code needed.`;

  if (condition === 'docs') {
    systemPrompt += `\n\nYou have access to a tool to search Redpanda documentation. Use it to find accurate, up-to-date information before answering.`;
  }

  if (skill && condition === 'skill') {
    systemPrompt += `\n\n## Skill: ${skill.name}\n\n${skill.content}`;

    // Add references
    for (const ref of skill.references || []) {
      systemPrompt += `\n\n## Reference: ${ref.file}\n\n${ref.content}`;
    }
  }

  return systemPrompt;
}

/**
 * Call the Anthropic API - baseline (no skill, no tools)
 */
async function callLLMBaseline(prompt) {
  const client = getAnthropicClient();
  const systemPrompt = buildSystemPrompt(null, 'baseline');

  const response = await client.messages.create({
    model: options.model,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      { role: 'user', content: prompt }
    ],
  });

  return response.content[0].text;
}

/**
 * Call the Anthropic API - with skill loaded
 */
async function callLLMWithSkill(prompt, skill) {
  const client = getAnthropicClient();
  const systemPrompt = buildSystemPrompt(skill, 'skill');

  const response = await client.messages.create({
    model: options.model,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      { role: 'user', content: prompt }
    ],
  });

  return response.content[0].text;
}

/**
 * Call the Anthropic API - with docs search tool (docs MCP simulation)
 */
async function callLLMWithDocs(prompt) {
  const client = getAnthropicClient();
  const systemPrompt = buildSystemPrompt(null, 'docs');

  let messages = [
    { role: 'user', content: prompt }
  ];

  // First call - let model decide to use tool
  let response = await client.messages.create({
    model: options.model,
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages,
    tools: [DOCS_SEARCH_TOOL],
  });

  // Handle tool use loop (max 3 iterations)
  let iterations = 0;
  while (response.stop_reason === 'tool_use' && iterations < 3) {
    iterations++;

    // Find tool use blocks
    const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');

    // Process each tool call
    const toolResults = [];
    for (const toolUse of toolUseBlocks) {
      if (toolUse.name === 'search_redpanda_docs') {
        const docsContent = await searchDocs(toolUse.input.query);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: docsContent
        });
      }
    }

    // Continue conversation with tool results
    messages = [
      ...messages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults }
    ];

    response = await client.messages.create({
      model: options.model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: messages,
      tools: [DOCS_SEARCH_TOOL],
    });
  }

  // Extract text response
  const textBlock = response.content.find(block => block.type === 'text');
  return textBlock ? textBlock.text : '';
}

/**
 * Check if response matches expected patterns
 */
function checkPatterns(response, patterns) {
  if (!patterns) return { passed: true, details: {} };

  const results = [];
  let allRequired = true;

  for (const pattern of patterns) {
    const regex = new RegExp(pattern.pattern, 'i');
    const matched = regex.test(response);

    if (pattern.required && !matched) {
      allRequired = false;
    }

    results.push({
      pattern: pattern.pattern,
      required: pattern.required || false,
      matched,
    });
  }

  return {
    passed: allRequired,
    details: { patterns: results },
  };
}

/**
 * Check negative transfer constraints
 */
function checkNegativeTransfer(response, task) {
  if (task.type !== 'negative_transfer_check') {
    return { isNegativeTransfer: false, details: {} };
  }

  const issues = [];

  // Check must_not constraints
  if (task.must_not) {
    if (task.must_not.require_enterprise_features) {
      const enterprisePatterns = [
        /enterprise/i,
        /license required/i,
        /redpanda\.iceberg/i,
        /cloud_topics_enabled/i,
        /shadow.*link/i,
      ];
      for (const pattern of enterprisePatterns) {
        if (pattern.test(response)) {
          issues.push(`Response mentions enterprise features: ${pattern}`);
        }
      }
    }

    if (task.must_not.require_tiered_storage) {
      if (/tiered.*storage|redpanda\.storage\.mode.*tiered/i.test(response)) {
        issues.push('Response mentions tiered storage');
      }
    }

    if (task.must_not.require_transactions) {
      if (/transactional\.id|beginTransaction|commitTransaction/i.test(response)) {
        issues.push('Response mentions transactions');
      }
    }

    // Check step count (rough heuristic)
    if (task.must_not.step_count) {
      const stepPatterns = response.match(/\d+\.\s|step\s+\d+/gi) || [];
      const threshold = parseInt(task.must_not.step_count.replace('> ', ''));
      if (stepPatterns.length > threshold) {
        issues.push(`Response has ${stepPatterns.length} steps, exceeds threshold of ${threshold}`);
      }
    }
  }

  // Check acceptable responses
  let hasAcceptable = !task.acceptable_responses;
  if (task.acceptable_responses) {
    for (const acceptable of task.acceptable_responses) {
      if (acceptable.contains && response.toLowerCase().includes(acceptable.contains.toLowerCase())) {
        hasAcceptable = true;
        break;
      }
    }
    if (!hasAcceptable) {
      issues.push('Response does not contain any acceptable patterns');
    }
  }

  return {
    isNegativeTransfer: issues.length > 0,
    details: { issues },
  };
}

/**
 * Evaluate a single task under a specific condition
 */
async function evaluateTask(task, condition, skill = null) {
  const result = {
    id: task.id,
    prompt: task.prompt,
    condition: condition,
    status: 'not_run',
    passed: null,
    response: null,
    details: {},
  };

  if (options.dryRun) {
    result.status = 'dry_run';
    result.details.message = 'Dry run - eval structure valid';
    return result;
  }

  try {
    // Call LLM based on condition
    let response;
    switch (condition) {
      case 'baseline':
        response = await callLLMBaseline(task.prompt);
        break;
      case 'docs':
        response = await callLLMWithDocs(task.prompt);
        break;
      case 'skill':
        response = await callLLMWithSkill(task.prompt, skill);
        break;
      default:
        throw new Error(`Unknown condition: ${condition}`);
    }

    result.response = response;
    result.status = 'completed';

    // Check expected patterns
    const patternCheck = checkPatterns(
      response,
      task.expected_commands || task.expected_content
    );

    // Check negative transfer
    const negativeCheck = checkNegativeTransfer(response, task);

    // Determine pass/fail
    if (task.type === 'negative_transfer_check') {
      result.passed = !negativeCheck.isNegativeTransfer;
      result.details.negativeTransfer = negativeCheck.details;
    } else {
      result.passed = patternCheck.passed;
      result.details.patterns = patternCheck.details;
    }

  } catch (err) {
    result.status = 'error';
    result.details.error = err.message;
    result.passed = false;
  }

  return result;
}

/**
 * Calculate pass rate from results
 */
function calculatePassRate(results) {
  if (results.length === 0) return 0;
  const passed = results.filter(r => r.passed).length;
  return (passed / results.length) * 100;
}

/**
 * Run evaluations for a skill
 */
async function runSkillEvals(skillName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Evaluating skill: ${skillName}`);
  console.log('='.repeat(60));

  const evals = loadEvals(skillName);
  if (evals.length === 0) {
    return { skillName, error: 'No evals found', results: [] };
  }

  const skill = loadSkill(skillName);
  if (!skill) {
    return { skillName, error: 'Skill not found', results: [] };
  }

  console.log(`\nLoaded ${evals.length} eval file(s)`);
  console.log(`Skill version: ${skill.metadata.version || 'unknown'}`);
  console.log(`Last verified: ${skill.metadata.last_verified || 'unknown'}`);
  console.log(`Model: ${options.model}`);
  console.log(`Conditions: skill${options.compareBaseline ? ', baseline' : ''}${options.compareDocs ? ', docs' : ''}`);

  const results = {
    skillName,
    skillVersion: skill.metadata.version,
    lastVerified: skill.metadata.last_verified,
    model: options.model,
    timestamp: new Date().toISOString(),
    conditions: {
      baseline: [],
      docs: [],
      skill: [],
    },
    negativeTransfer: [],
    metrics: {},
  };

  let totalTasks = 0;
  let negativeTransferTasks = 0;

  for (const evalFile of evals) {
    console.log(`\n  Processing: ${evalFile.file}`);

    for (const task of evalFile.tasks || []) {
      totalTasks++;

      const taskResults = {};

      // Always run skill condition
      console.log(`    [skill] ${task.id}...`);
      const skillResult = await evaluateTask(task, 'skill', skill);
      results.conditions.skill.push(skillResult);
      taskResults.skill = skillResult.passed;
      if (!options.dryRun && options.delayMs > 0) await sleep(options.delayMs);

      // Run baseline if requested
      if (options.compareBaseline) {
        console.log(`    [baseline] ${task.id}...`);
        const baselineResult = await evaluateTask(task, 'baseline', null);
        results.conditions.baseline.push(baselineResult);
        taskResults.baseline = baselineResult.passed;
        if (!options.dryRun && options.delayMs > 0) await sleep(options.delayMs);
      }

      // Run docs if requested
      if (options.compareDocs) {
        console.log(`    [docs] ${task.id}...`);
        const docsResult = await evaluateTask(task, 'docs', null);
        results.conditions.docs.push(docsResult);
        taskResults.docs = docsResult.passed;
        if (!options.dryRun && options.delayMs > 0) await sleep(options.delayMs);
      }

      // Track negative transfer checks
      if (task.type === 'negative_transfer_check') {
        negativeTransferTasks++;
        results.negativeTransfer.push({
          id: task.id,
          prompt: task.prompt,
          passed: skillResult.passed,
          details: skillResult.details,
        });
      }

      // Print result summary for this task
      const icons = [];
      if (options.compareBaseline) icons.push(`B:${taskResults.baseline ? '✓' : '✗'}`);
      if (options.compareDocs) icons.push(`D:${taskResults.docs ? '✓' : '✗'}`);
      icons.push(`S:${taskResults.skill ? '✓' : '✗'}`);
      console.log(`      └─ ${icons.join(' | ')}`);
    }
  }

  // Calculate metrics
  const skillPassRate = calculatePassRate(results.conditions.skill);
  const baselinePassRate = options.compareBaseline ? calculatePassRate(results.conditions.baseline) : null;
  const docsPassRate = options.compareDocs ? calculatePassRate(results.conditions.docs) : null;
  const negativeTransferCount = results.negativeTransfer.filter(t => !t.passed).length;

  results.metrics = {
    totalTasks,
    negativeTransferTasks,
    skillPassRate: skillPassRate.toFixed(1),
    baselinePassRate: baselinePassRate !== null ? baselinePassRate.toFixed(1) : null,
    docsPassRate: docsPassRate !== null ? docsPassRate.toFixed(1) : null,
    skillVsBaseline: baselinePassRate !== null ? (skillPassRate - baselinePassRate).toFixed(1) : null,
    skillVsDocs: docsPassRate !== null ? (skillPassRate - docsPassRate).toFixed(1) : null,
    docsVsBaseline: (baselinePassRate !== null && docsPassRate !== null)
      ? (docsPassRate - baselinePassRate).toFixed(1) : null,
    negativeTransferCount,
  };

  // Print summary
  console.log(`\n  Summary:`);
  console.log(`    Total tasks: ${totalTasks}`);
  console.log(`    Skill pass rate: ${results.metrics.skillPassRate}%`);
  if (baselinePassRate !== null) {
    console.log(`    Baseline pass rate: ${results.metrics.baselinePassRate}%`);
    console.log(`    Skill vs Baseline delta: ${results.metrics.skillVsBaseline}%`);
  }
  if (docsPassRate !== null) {
    console.log(`    Docs MCP pass rate: ${results.metrics.docsPassRate}%`);
    console.log(`    Skill vs Docs delta: ${results.metrics.skillVsDocs}%`);
  }
  if (baselinePassRate !== null && docsPassRate !== null) {
    console.log(`    Docs vs Baseline delta: ${results.metrics.docsVsBaseline}%`);
  }
  console.log(`    Negative transfer count: ${negativeTransferCount}`);

  return results;
}

/**
 * Get all skill names that have evals
 */
function getAllSkillsWithEvals() {
  if (!fs.existsSync(EVALS_DIR)) {
    return [];
  }

  return fs.readdirSync(EVALS_DIR)
    .filter(f => {
      const stat = fs.statSync(path.join(EVALS_DIR, f));
      return stat.isDirectory();
    })
    .filter(f => f !== 'README.md');
}

/**
 * Main entry point
 */
async function main() {
  console.log('Redpanda Skill Evaluation Runner');
  console.log('================================\n');

  if (!options.skill && !options.all) {
    console.error('Error: Specify --skill <name> or --all');
    process.exit(1);
  }

  // Ensure results directory exists
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const skills = options.all ? getAllSkillsWithEvals() : [options.skill];
  const allResults = [];

  for (const skillName of skills) {
    const results = await runSkillEvals(skillName);
    allResults.push(results);
  }

  // Generate report if requested
  if (options.report) {
    const reportPath = path.join(RESULTS_DIR, `eval-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(allResults, null, 2));
    console.log(`\nReport saved to: ${reportPath}`);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('EVALUATION COMPLETE');
  console.log('='.repeat(60));
  console.log(`Skills evaluated: ${skills.length}`);

  // Print comparison table if all conditions were run
  if (options.compareAll) {
    console.log('\n  Comparison Summary:');
    console.log('  ' + '-'.repeat(56));
    console.log('  | Skill            | Baseline | Docs MCP | Skill   |');
    console.log('  ' + '-'.repeat(56));
    for (const result of allResults) {
      if (result.metrics) {
        const name = result.skillName.padEnd(16).substring(0, 16);
        const baseline = (result.metrics.baselinePassRate + '%').padStart(7);
        const docs = (result.metrics.docsPassRate + '%').padStart(7);
        const skill = (result.metrics.skillPassRate + '%').padStart(7);
        console.log(`  | ${name} | ${baseline}  | ${docs}  | ${skill} |`);
      }
    }
    console.log('  ' + '-'.repeat(56));
  }

  // Check for failures
  let hasFailures = false;
  for (const result of allResults) {
    if (result.metrics?.negativeTransferCount > 0) {
      console.log(`\nWARNING: ${result.skillName} has ${result.metrics.negativeTransferCount} negative transfer task(s)`);
      hasFailures = true;
    }
    if (result.metrics?.skillVsBaseline && parseFloat(result.metrics.skillVsBaseline) < 0) {
      console.log(`\nWARNING: ${result.skillName} skill performs WORSE than baseline (${result.metrics.skillVsBaseline}%)`);
      hasFailures = true;
    }
    if (result.metrics?.skillVsDocs && parseFloat(result.metrics.skillVsDocs) < 0) {
      console.log(`\nNOTE: ${result.skillName} skill performs worse than docs MCP (${result.metrics.skillVsDocs}%) - consider if skill is needed`);
    }
  }

  if (options.dryRun) {
    console.log('\nDry run complete - all eval files parsed successfully');
  }

  // Exit with error code if failures
  if (hasFailures && !options.dryRun) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
