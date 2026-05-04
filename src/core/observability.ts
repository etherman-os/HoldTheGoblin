import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appPath, ensureAppDirs, loadConfig } from './config.js';
import { appendEvent } from './events.js';
import { isInsidePath, resolveExistingInsideProject } from './paths.js';
import { redactSensitiveData, redactSensitiveText } from './redact.js';
import type { CheckResult, CommandResult, Finding, VerifyResult } from './types.js';

export type ObservabilityProvider = 'langfuse' | 'agentops' | 'all';

export interface ObservabilityExportResult {
  ok: boolean;
  provider: Exclude<ObservabilityProvider, 'all'>;
  sent: boolean;
  outputPath: string;
  status?: number;
  error?: string;
}

interface SafeVerifySummary {
  runId: string;
  ok: boolean;
  mode: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  reportPath?: string;
  markdownReportPath?: string;
  jsonReportPath?: string;
  htmlReportPath?: string;
  changedFiles: string[];
  detections: unknown;
  checks: Array<Record<string, unknown>>;
  findings: unknown[];
  commands: unknown[];
  edgeCases: unknown[];
}

export async function exportObservability(options: {
  root: string;
  provider: ObservabilityProvider;
  run?: string;
  send?: boolean;
  sendTimeoutMs?: number;
}): Promise<ObservabilityExportResult[]> {
  const result = readVerifyRun(options.root, options.run);
  const providers = options.provider === 'all' ? ['langfuse', 'agentops'] as const : [options.provider];
  const exports: ObservabilityExportResult[] = [];
  for (const provider of providers) {
    exports.push(await exportProvider(options.root, provider, result, options.send === true, options.sendTimeoutMs ?? readTimeoutMs()));
  }
  appendEvent(options.root, {
    type: 'observability',
    ok: exports.every((item) => item.ok),
    summary: `Exported ${exports.length} observability payload(s).`,
    data: exports,
  });
  return exports;
}

export function readVerifyRun(root: string, run?: string): VerifyResult {
  const runsDir = appPath(root, 'runs');
  const file = resolveExistingInsideProject(root, run ?? latestRunJson(root));
  if (!isInsidePath(runsDir, file)) throw new Error('Observability run must be a HoldTheGoblin JSON report under .holdthegoblin/runs.');
  const result = JSON.parse(readFileSync(file, 'utf8')) as VerifyResult;
  if (result.root !== root) throw new Error('Observability run root does not match the current project root.');
  return result;
}

export function buildLangfusePayload(result: VerifyResult): unknown {
  const safe = summarizeResult(result);
  return {
    batch: [
      {
        id: `${result.runId}-trace`,
        timestamp: result.startedAt,
        type: 'trace-create',
        body: {
          id: result.runId,
          name: 'holdthegoblin.verify',
          timestamp: result.startedAt,
          release: process.env.npm_package_version,
          tags: ['holdthegoblin', result.ok ? 'pass' : 'fail', result.mode],
          metadata: safe,
        },
      },
      {
        id: `${result.runId}-score`,
        timestamp: result.finishedAt,
        type: 'score-create',
        body: {
          traceId: result.runId,
          name: 'holdthegoblin.ok',
          value: result.ok ? 1 : 0,
          comment: `Verification ${result.ok ? 'passed' : 'failed'} with ${result.checks.length} checks.`,
        },
      },
    ],
  };
}

export function buildAgentOpsPayload(result: VerifyResult): unknown {
  const safe = summarizeResult(result);
  return {
    schema: 'holdthegoblin.agentops.otlp-json.v1',
    name: 'holdthegoblin.verify',
    traceId: result.runId,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    status: result.ok ? 'OK' : 'ERROR',
    attributes: {
      'agentops.span.kind': 'WORKFLOW',
      'holdthegoblin.mode': result.mode,
      'holdthegoblin.root': result.root,
      'holdthegoblin.check.count': result.checks.length,
      'holdthegoblin.finding.count': result.findings.length,
    },
    events: safe.checks.map((check) => ({
      name: `check.${check.status}`,
      timestamp: result.finishedAt,
      attributes: check,
    })),
    summary: safe,
  };
}

async function exportProvider(
  root: string,
  provider: Exclude<ObservabilityProvider, 'all'>,
  result: VerifyResult,
  send: boolean,
  timeoutMs: number
): Promise<ObservabilityExportResult> {
  ensureAppDirs(root);
  const dir = appPath(root, 'exports');
  mkdirSync(dir, { recursive: true });
  const payload = redactSensitiveData(provider === 'langfuse' ? buildLangfusePayload(result) : buildAgentOpsPayload(result));
  const outputPath = path.join(dir, `${provider}-${result.runId}.json`);
  writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n');
  if (!send) return { ok: true, provider, sent: false, outputPath };

  try {
    const response = provider === 'langfuse'
      ? await sendLangfuse(payload, timeoutMs)
      : await sendAgentOps(payload, timeoutMs);
    return {
      ok: response.status >= 200 && response.status < 300,
      provider,
      sent: true,
      outputPath,
      status: response.status,
      error: response.status >= 200 && response.status < 300 ? undefined : redactSensitiveText(response.text),
    };
  } catch (error) {
    return {
      ok: false,
      provider,
      sent: true,
      outputPath,
      error: redactSensitiveText(error instanceof Error ? error.message : String(error)),
    };
  }
}

async function sendLangfuse(payload: unknown, timeoutMs: number): Promise<{ status: number; text: string }> {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) throw new Error('LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are required for --send.');
  const baseUrl = validateObservabilityEndpoint((process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com').replace(/\/$/, ''));
  const response = await fetchWithTimeout(new URL('/api/public/ingestion', `${baseUrl}/`).toString(), {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  }, timeoutMs);
  return { status: response.status, text: await response.text() };
}

async function sendAgentOps(payload: unknown, timeoutMs: number): Promise<{ status: number; text: string }> {
  const endpoint = process.env.AGENTOPS_INGEST_URL;
  const apiKey = process.env.AGENTOPS_API_KEY;
  if (!endpoint || !apiKey) throw new Error('AGENTOPS_INGEST_URL and AGENTOPS_API_KEY are required for --send.');
  const response = await fetchWithTimeout(validateObservabilityEndpoint(endpoint), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  }, timeoutMs);
  return { status: response.status, text: await response.text() };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function validateObservabilityEndpoint(value: string): string {
  const parsed = new URL(value);
  if (parsed.username || parsed.password) throw new Error('Observability endpoint must not include URL credentials.');
  const host = parsed.hostname;
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error('Observability endpoint must use HTTPS unless targeting localhost.');
  }
  const sensitivePart = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (containsEncodedCredentialMaterial(sensitivePart) || redactSensitiveText(sensitivePart) !== sensitivePart) {
    throw new Error('Observability endpoint must not include credential-like path, query, or fragment values.');
  }
  return parsed.toString();
}

function containsEncodedCredentialMaterial(value: string): boolean {
  let current = value;
  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return false;
      if (redactSensitiveText(decoded) !== decoded) return true;
      current = decoded;
    } catch {
      return false;
    }
  }
  return false;
}

function readTimeoutMs(): number {
  const value = Number(process.env.HOLDTHEGOBLIN_OBSERVABILITY_TIMEOUT_MS ?? '15000');
  return Number.isFinite(value) && value > 0 ? value : 15000;
}

function latestRunJson(root: string): string {
  const dir = appPath(root, 'runs');
  if (!existsSync(dir)) throw new Error('No HoldTheGoblin runs found. Run `holdthegoblin verify` first.');
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => path.join(dir, file))
    .sort();
  const latest = files.at(-1);
  if (!latest) throw new Error('No HoldTheGoblin JSON run reports found.');
  return latest;
}

function summarizeResult(result: VerifyResult): SafeVerifySummary {
  const config = loadConfig(result.root);
  return {
    runId: result.runId,
    ok: result.ok,
    mode: result.mode,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    reportPath: result.reportPath,
    markdownReportPath: result.markdownReportPath,
    jsonReportPath: result.jsonReportPath,
    htmlReportPath: result.htmlReportPath,
    changedFiles: result.changedFiles,
    detections: {
      kinds: result.detections.kinds,
      warnings: result.detections.warnings,
    },
    checks: summarizeChecks(result.checks),
    findings: config.observability.exportFindings ? summarizeFindings(result.findings) : [],
    commands: config.observability.exportCommands ? summarizeCommands(result.commandResults) : [],
    edgeCases: result.edgeCases,
  };
}

function summarizeChecks(checks: CheckResult[]): Array<Record<string, unknown>> {
  return checks.map((check) => ({
    id: check.id,
    label: check.label,
    status: check.status,
    severity: check.severity,
    message: redactSensitiveText(check.message),
  }));
}

function summarizeCommands(commands: CommandResult[]): unknown[] {
  return commands.map((command) => ({
    id: command.id,
    label: command.label,
    command: redactSensitiveText(command.command),
    skipped: command.skipped,
    skipReason: command.skipReason,
    exitCode: command.exitCode,
    durationMs: command.durationMs,
    timedOut: command.timedOut,
    attempts: command.attempts,
  }));
}

function summarizeFindings(findings: Finding[]): unknown[] {
  return findings.map((finding) => ({
    scanner: finding.scanner,
    severity: finding.severity,
    message: redactSensitiveText(finding.message),
    file: finding.file,
    line: finding.line,
    ruleId: finding.ruleId,
  }));
}
