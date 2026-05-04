#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createCheckpoint, listCheckpoints, rollbackCheckpoint } from './core/checkpoint.js';
import { detectProject } from './core/detect.js';
import { runDeployPlan, writeExampleDeployPlan } from './core/deploy.js';
import { readEvents } from './core/events.js';
import { findGitRoot } from './core/git.js';
import { validateHandoffFiles } from './core/handoff.js';
import { handleClaudeHook } from './core/hooks.js';
import { initProject } from './core/init.js';
import { listModelProviders } from './core/llm.js';
import { exportObservability, type ObservabilityProvider } from './core/observability.js';
import { writeGithubAnnotations, writeGithubStepSummary } from './core/github.js';
import { renderTextSummary } from './core/output.js';
import { readPackageVersion } from './core/package.js';
import { resolveInsideProject } from './core/paths.js';
import { commandExists } from './core/runner.js';
import { CONFIG_JSON_SCHEMA, configPath, loadConfig, validateConfigFile, validateProjectConfig } from './core/config.js';
import { generateTests, type TestGenerationProvider } from './core/testgen.js';
import { verify } from './core/verify.js';

interface ParsedArgs {
  command?: string;
  subcommand?: string;
  flags: Record<string, string | boolean>;
  rest: string[];
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === '--version' || args.command === '-v' || args.command === 'version') {
    console.log(readPackageVersion());
    return 0;
  }
  const root = await findGitRoot(process.cwd());

  try {
    if (args.flags.help || args.flags.h) {
      printHelp();
      return 0;
    }
    switch (args.command) {
      case 'init':
        return cmdInit(args, root);
      case 'wrap':
        return cmdWrap(args);
      case 'verify':
        return cmdVerify(args, root);
      case 'hook':
        return cmdHook(args);
      case 'checkpoint':
        return cmdCheckpoint(args, root);
      case 'handoff':
        return cmdHandoff(args);
      case 'config':
        return cmdConfig(args, root);
      case 'doctor':
        return cmdDoctor(root);
      case 'events':
        return cmdEvents(args, root);
      case 'mcp':
        return cmdMcp(root);
      case 'mcp-http':
        return cmdMcpHttp(args, root);
      case 'deploy':
        return cmdDeploy(args, root);
      case 'observability':
        return cmdObservability(args, root);
      case 'tests':
        return cmdTests(args, root);
      case 'models':
        return cmdModels(args);
      case 'demo':
        return cmdDemo(root);
      case 'help':
      case undefined:
      case '-h':
      case '--help':
        printHelp();
        return 0;
      default:
        console.error(`Unknown command: ${args.command}`);
        printHelp();
        return 2;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function cmdInit(args: ParsedArgs, root: string): Promise<number> {
  const agent = stringFlag(args, 'agent') ?? 'claude';
  const mode = stringFlag(args, 'mode');
  const changes = initProject({ root, agent, mode, executablePath: process.argv[1] });
  for (const change of changes) console.log(change);
  console.log('HoldTheGoblin is armed.');
  return 0;
}

async function cmdWrap(args: ParsedArgs): Promise<number> {
  const agent = stringFlag(args, 'agent') ?? 'claude-code';
  const mode = stringFlag(args, 'mode');
  const target = args.rest[0] ? path.resolve(args.rest[0]) : process.cwd();
  const root = await findGitRoot(target);
  const changes = initProject({ root, agent, mode, executablePath: process.argv[1] });
  for (const change of changes) console.log(change);
  console.log(`Wrapped ${root} with HoldTheGoblin for ${agent}.`);
  return 0;
}

async function cmdVerify(args: ParsedArgs, root: string): Promise<number> {
  const format = stringFlag(args, 'format') ?? 'text';
  if (!['text', 'json', 'markdown', 'html'].includes(format)) throw new Error('verify --format must be text, json, markdown, or html.');
  if (booleanFlag(args, 'github-annotations') && (format === 'json' || format === 'html')) {
    throw new Error('--github-annotations writes workflow commands to stdout and cannot be combined with json or html format.');
  }
  const result = await verify({ root });
  if (booleanFlag(args, 'github-step-summary')) writeGithubStepSummary(result);
  if (booleanFlag(args, 'github-annotations')) writeGithubAnnotations(result);
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else if (format === 'markdown') {
    const { renderMarkdownReport } = await import('./core/output.js');
    console.log(renderMarkdownReport(result));
  } else if (format === 'html') {
    const { renderHtmlReport } = await import('./core/output.js');
    console.log(renderHtmlReport(result));
  } else {
    console.log(renderTextSummary(result));
  }
  return result.ok ? 0 : 1;
}

async function cmdHook(args: ParsedArgs): Promise<number> {
  if (args.subcommand !== 'claude') throw new Error('Usage: holdthegoblin hook claude');
  const result = await handleClaudeHook();
  if (result.stdout) process.stdout.write(result.stdout);
  return result.exitCode;
}

async function cmdCheckpoint(args: ParsedArgs, root: string): Promise<number> {
  switch (args.subcommand) {
    case 'create': {
      const checkpoint = await createCheckpoint(root, stringFlag(args, 'note'));
      console.log(`Checkpoint created: ${checkpoint.id} (${checkpoint.files.length} files)`);
      return 0;
    }
    case 'list': {
      const checkpoints = listCheckpoints(root);
      if (checkpoints.length === 0) {
        console.log('No checkpoints found.');
        return 0;
      }
      for (const checkpoint of checkpoints) {
        console.log(`${checkpoint.id} ${checkpoint.createdAt} ${checkpoint.files.length} files${checkpoint.note ? ` - ${checkpoint.note}` : ''}`);
      }
      return 0;
    }
    case 'rollback': {
      const id = stringFlag(args, 'id') ?? args.rest[0] ?? 'latest';
      const checkpoint = rollbackCheckpoint(root, id, booleanFlag(args, 'delete-new'));
      console.log(`Rolled back tracked snapshot files to checkpoint ${checkpoint.id}.`);
      if (!args.flags['delete-new']) console.log('New files created after the checkpoint were not deleted. Pass --delete-new to remove them.');
      return 0;
    }
    default:
      throw new Error('Usage: holdthegoblin checkpoint create|list|rollback');
  }
}

async function cmdHandoff(args: ParsedArgs): Promise<number> {
  if (args.subcommand !== 'validate') throw new Error('Usage: holdthegoblin handoff validate --schema schema.json --input payload.json');
  const schema = stringFlag(args, 'schema');
  const input = stringFlag(args, 'input');
  if (!schema || !input) throw new Error('handoff validate requires --schema and --input');
  const root = await findGitRoot(process.cwd());
  const result = validateHandoffFiles(resolveInsideProject(root, schema), resolveInsideProject(root, input));
  if (result.ok) {
    console.log('Handoff payload is valid.');
    return 0;
  }
  console.log('Handoff payload is invalid:');
  for (const issue of result.issues) console.log(`- ${issue.path}: ${issue.message}`);
  return 1;
}

async function cmdConfig(args: ParsedArgs, root: string): Promise<number> {
  switch (args.subcommand) {
    case 'validate': {
      const file = stringFlag(args, 'path');
      const result = file ? validateConfigFile(resolveInsideProject(root, file)) : validateProjectConfig(root);
      if (stringFlag(args, 'format') === 'json') {
        console.log(JSON.stringify(result, null, 2));
        return result.ok ? 0 : 1;
      }
      if (result.ok) {
        console.log(`HoldTheGoblin config is valid: ${result.path ?? configPath(root)}`);
        return 0;
      }
      console.log(`HoldTheGoblin config is invalid: ${result.path ?? configPath(root)}`);
      for (const issue of result.issues) console.log(`- ${issue.path}: ${issue.message}`);
      return 1;
    }
    case 'schema': {
      console.log(JSON.stringify(CONFIG_JSON_SCHEMA, null, 2));
      return 0;
    }
    default:
      throw new Error('Usage: holdthegoblin config validate [--path .holdthegoblin/config.json] [--format json] OR holdthegoblin config schema');
  }
}

async function cmdDoctor(root: string): Promise<number> {
  const config = loadConfig(root);
  const detection = detectProject(root, config);
  const claudeInstalled = existsSync(path.join(root, '.claude', 'settings.json'));
  const cursorInstalled = existsSync(path.join(root, '.cursor', 'rules', 'holdthegoblin.mdc'));
  const agentsInstalled = fileContains(path.join(root, 'AGENTS.md'), 'holdthegoblin:start');
  const warpInstalled = agentsInstalled || fileContains(path.join(root, 'WARP.md'), 'holdthegoblin:start');
  const skillInstalled = existsSync(path.join(root, '.agents', 'skills', 'holdthegoblin', 'SKILL.md'));

  console.log(`Root: ${root}`);
  console.log(`Mode: ${config.mode}`);
  console.log(`Detected: ${detection.kinds.join(', ')}`);
  console.log('');
  console.log('Agent protection:');
  console.log(`- Claude Code hooks: ${claudeInstalled ? 'hard block enabled' : 'not installed'} (.claude/settings.json)`);
  console.log(`- Cursor rules: ${cursorInstalled ? 'soft guidance installed' : 'not installed'} (.cursor/rules/holdthegoblin.mdc)`);
  console.log(`- Codex project rules: ${agentsInstalled ? 'soft guidance installed' : 'not installed'} (AGENTS.md)`);
  console.log(`- Warp project rules: ${warpInstalled ? 'soft guidance installed' : 'not installed'} (AGENTS.md/WARP.md)`);
  console.log(`- Agent skill: ${skillInstalled ? 'installed' : 'not installed'} (.agents/skills/holdthegoblin/SKILL.md)`);
  console.log('');
  console.log('Verification plan:');
  console.log(`Planned test commands: ${detection.testCommands.length}`);
  for (const command of detection.testCommands) console.log(`- ${command.label}: ${command.command}`);

  console.log('');
  console.log('Tooling:');
  const tools = ['git', 'node', 'semgrep', 'trivy'];
  for (const tool of tools) {
    const found = await commandExists(tool, root);
    const note = tool === 'semgrep' || tool === 'trivy'
      ? found ? 'scanner active when verify runs' : 'scanner skipped until installed'
      : found ? 'required tool found' : 'required tool missing';
    console.log(`- ${tool}: ${found ? 'found' : 'missing'} (${note})`);
  }
  return 0;
}

async function cmdEvents(args: ParsedArgs, root: string): Promise<number> {
  const limit = Number(stringFlag(args, 'limit') ?? '20');
  const format = stringFlag(args, 'format') ?? 'text';
  if (!['text', 'json'].includes(format)) throw new Error('events --format must be text or json.');
  const events = readEvents(root, Number.isFinite(limit) ? limit : 20);
  if (format === 'json') {
    console.log(JSON.stringify(events, null, 2));
    return 0;
  }
  if (events.length === 0) {
    console.log('No HoldTheGoblin events found.');
    return 0;
  }
  for (const event of events) {
    const status = event.ok === undefined ? '' : event.ok ? ' PASS' : ' FAIL';
    console.log(`${event.timestamp} ${event.type}${status} ${event.summary}`);
  }
  return 0;
}

async function cmdMcp(root: string): Promise<number> {
  const { runMcpServer } = await import('./mcp.js');
  await runMcpServer({ root });
  return 0;
}

async function cmdMcpHttp(args: ParsedArgs, root: string): Promise<number> {
  const { runMcpHttpServer } = await import('./mcp.js');
  await runMcpHttpServer({
    host: stringFlag(args, 'host') ?? '127.0.0.1',
    port: Number(stringFlag(args, 'port') ?? '3333'),
    allowedHosts: collectFlags(args, 'allowed-host'),
    authToken: stringFlag(args, 'auth-token') ?? process.env.HOLDTHEGOBLIN_MCP_HTTP_TOKEN,
    root,
  });
  return 0;
}

async function cmdDeploy(args: ParsedArgs, root: string): Promise<number> {
  switch (args.subcommand) {
    case 'init': {
      const output = path.resolve(stringFlag(args, 'output') ?? 'holdthegoblin.deploy.json');
      writeExampleDeployPlan(output);
      console.log(`Deploy plan example written: ${output}`);
      return 0;
    }
    case 'run': {
      const plan = stringFlag(args, 'plan') ?? args.rest[0];
      if (!plan) throw new Error('Usage: holdthegoblin deploy run --plan holdthegoblin.deploy.json');
      const result = await runDeployPlan({ root, planPath: plan, dryRun: booleanFlag(args, 'dry-run'), allowDangerous: booleanFlag(args, 'allow-dangerous') });
      if (stringFlag(args, 'format') === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Deploy guard ${result.ok ? 'passed' : 'failed'}: ${result.plan.name}`);
        console.log(`Report: ${result.reportPath}`);
        for (const phase of result.phases) {
          console.log(`- ${phase.phase}: ${phase.ok ? 'pass' : 'fail'}${phase.skipped ? ' (dry-run)' : ''}`);
        }
        if (result.rolledBack) console.log('Rollback: checkpoint-tracked files restored.');
      }
      return result.ok ? 0 : 1;
    }
    default:
      throw new Error('Usage: holdthegoblin deploy init [--output file] OR holdthegoblin deploy run --plan file');
  }
}

async function cmdObservability(args: ParsedArgs, root: string): Promise<number> {
  if (args.subcommand !== 'export') throw new Error('Usage: holdthegoblin observability export --provider langfuse|agentops|all [--send]');
  const provider = (stringFlag(args, 'provider') ?? 'all') as ObservabilityProvider;
  if (!['langfuse', 'agentops', 'all'].includes(provider)) throw new Error('Provider must be langfuse, agentops, or all.');
  const results = await exportObservability({
    root,
    provider,
    run: stringFlag(args, 'run'),
    send: booleanFlag(args, 'send'),
    sendTimeoutMs: numberFlag(args, 'timeout-ms'),
  });
  if (stringFlag(args, 'format') === 'json') {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const result of results) {
      const sent = result.sent ? `sent HTTP ${result.status ?? 'error'}` : 'written locally';
      console.log(`${result.provider}: ${result.ok ? 'ok' : 'failed'} (${sent}) ${result.outputPath}`);
      if (result.error) console.log(`  ${result.error}`);
    }
  }
  return results.every((result) => result.ok) ? 0 : 1;
}

async function cmdTests(args: ParsedArgs, root: string): Promise<number> {
  if (args.subcommand !== 'generate') throw new Error(`Usage: holdthegoblin tests generate [--provider ${providerHelpList()}]`);
  const provider = (stringFlag(args, 'provider') ?? 'deterministic') as TestGenerationProvider;
  const providers = ['deterministic', ...listModelProviders().map((item) => item.id)];
  if (!providers.includes(provider)) throw new Error(`Provider must be one of: ${providers.join(', ')}.`);
  const result = await generateTests({
    root,
    provider,
    model: stringFlag(args, 'model'),
    baseUrl: stringFlag(args, 'base-url'),
    output: stringFlag(args, 'output'),
    timeoutMs: numberFlag(args, 'timeout-ms'),
  });
  if (stringFlag(args, 'format') === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Generated ${provider} test plan: ${result.outputPath}`);
    console.log(`Suggestions: ${result.suggestions.length}`);
    if (result.error) console.log(`Provider warning: ${result.error}`);
  }
  return result.ok ? 0 : provider !== 'deterministic' ? 1 : 0;
}

async function cmdModels(args: ParsedArgs): Promise<number> {
  if (args.subcommand !== 'providers') throw new Error('Usage: holdthegoblin models providers [--format json]');
  const providers = listModelProviders();
  if (stringFlag(args, 'format') === 'json') {
    console.log(JSON.stringify(providers, null, 2));
    return 0;
  }
  for (const provider of providers) {
    console.log(`${provider.id}: ${provider.label}`);
    if (provider.defaultBaseUrl) console.log(`  base: ${provider.defaultBaseUrl}`);
    if (provider.defaultModel) console.log(`  default model: ${provider.defaultModel}`);
    if (provider.modelExamples?.length) console.log(`  models: ${provider.modelExamples.join(', ')}`);
    console.log(`  env: ${provider.env.join(', ')}`);
    console.log(`  ${provider.notes}`);
  }
  return 0;
}

async function cmdDemo(root: string): Promise<number> {
  const dir = path.join(root, 'holdthegoblin-demo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    scripts: { test: 'node test.js' },
    type: 'module',
  }, null, 2) + '\n');
  const demoToken = 'sk-' + '1234567890abcdefghijklmnopqrstuvwxyzABCDE'; // holdthegoblin: allow-secret
  writeFileSync(path.join(dir, 'index.js'), `export const token = "${demoToken}";\n`);
  writeFileSync(path.join(dir, 'test.js'), 'import { token } from "./index.js";\nif (!token) process.exit(1);\n');
  console.log(`Demo project created: ${dir}`);
  console.log(`Run: cd ${dir} && holdthegoblin wrap --agent all . && holdthegoblin verify`);
  console.log('Expected: verification fails until the demo secret is removed.');
  return 0;
}

function fileContains(file: string, needle: string): boolean {
  try {
    return readFileSync(file, 'utf8').includes(needle);
  } catch {
    return false;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, maybeSubcommand, ...tail] = argv;
  const hasSubcommand = commandAcceptsSubcommand(command) && maybeSubcommand && !maybeSubcommand.startsWith('-');
  const rest = hasSubcommand ? tail : maybeSubcommand ? [maybeSubcommand, ...tail] : [];
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (!item.startsWith('--')) {
      positional.push(item);
      continue;
    }
    const keyValue = item.slice(2);
    const eq = keyValue.indexOf('=');
    if (eq >= 0) {
      const key = keyValue.slice(0, eq);
      const value = keyValue.slice(eq + 1);
      flags[key] = BOOLEAN_FLAGS.has(key) ? parseBooleanValue(value, key) : value;
      continue;
    }
    if (BOOLEAN_FLAGS.has(keyValue)) {
      const next = rest[i + 1];
      if (next === 'true' || next === 'false') {
        flags[keyValue] = next === 'true';
        i += 1;
      } else {
        flags[keyValue] = true;
      }
      continue;
    }
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      flags[keyValue] = next;
      i += 1;
    } else {
      flags[keyValue] = true;
    }
  }

  return { command, subcommand: hasSubcommand ? maybeSubcommand : undefined, flags, rest: positional };
}

function stringFlag(args: ParsedArgs, key: string): string | undefined {
  const value = args.flags[key];
  return typeof value === 'string' ? value : undefined;
}

function numberFlag(args: ParsedArgs, key: string): number | undefined {
  const value = stringFlag(args, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanFlag(args: ParsedArgs, key: string): boolean {
  return args.flags[key] === true;
}

function collectFlags(args: ParsedArgs, key: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === `--${key}` && process.argv[i + 1]) values.push(process.argv[i + 1]);
    if (process.argv[i].startsWith(`--${key}=`)) values.push(process.argv[i].slice(key.length + 3));
  }
  return values;
}

function commandAcceptsSubcommand(command: string | undefined): boolean {
  return new Set(['hook', 'checkpoint', 'handoff', 'config', 'deploy', 'observability', 'tests', 'models']).has(command ?? '');
}

const BOOLEAN_FLAGS = new Set(['delete-new', 'dry-run', 'send', 'help', 'h', 'allow-dangerous', 'github-step-summary', 'github-annotations']);

function parseBooleanValue(value: string, key: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`--${key} expects true or false.`);
}

function providerHelpList(): string {
  return ['deterministic', ...listModelProviders().map((item) => item.id)].join('|');
}

function printHelp(): void {
  console.log(`HoldTheGoblin - stops unsafe agents before they call it done.

Usage:
  holdthegoblin --version
  holdthegoblin init --agent claude-code|cursor|codex|warp|all [--mode relaxed|balanced|strict]
  holdthegoblin wrap --agent claude-code|cursor|codex|warp|all [path]
  holdthegoblin verify [--format text|json|markdown|html] [--github-step-summary] [--github-annotations]
  holdthegoblin hook claude
  holdthegoblin checkpoint create|list|rollback [--id latest] [--delete-new]
  holdthegoblin handoff validate --schema schema.json --input payload.json
  holdthegoblin config validate [--path .holdthegoblin/config.json] [--format json]
  holdthegoblin config schema
  holdthegoblin doctor
  holdthegoblin events [--limit 20] [--format text|json]
  holdthegoblin mcp
  holdthegoblin mcp-http [--host 127.0.0.1] [--port 3333] [--allowed-host localhost] [--auth-token token]
  holdthegoblin deploy init [--output holdthegoblin.deploy.json]
  holdthegoblin deploy run --plan holdthegoblin.deploy.json [--dry-run] [--allow-dangerous] [--format json]
  holdthegoblin observability export --provider langfuse|agentops|all [--send] [--timeout-ms 15000]
  holdthegoblin tests generate [--provider ${providerHelpList()}] [--model model] [--base-url url] [--timeout-ms 60000]
  holdthegoblin models providers [--format json]
  holdthegoblin demo

Notes:
  verify writes .holdthegoblin/latest.md, .holdthegoblin/latest.html, and immutable .holdthegoblin/runs/<run-id> reports.
  verify --format selects stdout format only.
  verify --github-step-summary appends a concise Markdown summary to GitHub Actions GITHUB_STEP_SUMMARY.
  verify --github-annotations emits redacted GitHub Actions workflow command annotations for failed checks, failed commands, warnings/skips, and findings.
`);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
