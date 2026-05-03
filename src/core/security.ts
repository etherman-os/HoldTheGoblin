import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { commandExists, runShell } from './runner.js';
import type { CommandResult, Finding, HoldTheGoblinConfig, PlannedCommand } from './types.js';

const EXCLUDED_DIRS = new Set([
  '.git',
  '.holdthegoblin',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__',
  'target',
]);

const MAX_FILE_BYTES = 512 * 1024;

const SECRET_PATTERNS: Array<{ id: string; pattern: RegExp; message: string }> = [
  { id: 'private-key', pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, message: 'Private key material detected' },
  { id: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/, message: 'AWS access key detected' },
  { id: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/, message: 'GitHub token detected' },
  { id: 'openai-key', pattern: /\bsk-[A-Za-z0-9_-]{32,}\b/, message: 'OpenAI-style API key detected' },
  { id: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/, message: 'Slack token detected' },
  { id: 'generic-secret-assignment', pattern: /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*['"][^'"\n]{20,}['"]/i, message: 'High-risk secret assignment detected' },
];

export interface SecurityScanResult {
  commandResults: CommandResult[];
  findings: Finding[];
  skipped: string[];
}

export async function runSecurityScans(root: string, config: HoldTheGoblinConfig, commands: PlannedCommand[]): Promise<SecurityScanResult> {
  const commandResults: CommandResult[] = [];
  const findings: Finding[] = [];
  const skipped: string[] = [];

  if (config.security.secretScan) {
    findings.push(...scanSecrets(root));
  }

  for (const command of commands) {
    const binary = command.command.split(/\s+/)[0];
    if (!(await commandExists(binary, root))) {
      skipped.push(`${binary} not installed`);
      commandResults.push({
        id: command.id,
        label: command.label,
        command: command.command,
        skipped: true,
        skipReason: `${binary} is not installed`,
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        timedOut: false,
        attempts: 0,
      });
      continue;
    }

    const result = await runShell(command, { cwd: root, timeoutMs: config.execution.timeoutMs, retries: 0 });
    commandResults.push(result);
    if (command.id === 'semgrep') findings.push(...parseSemgrep(result.stdout));
    if (command.id === 'trivy') findings.push(...parseTrivy(result.stdout));
  }

  return { commandResults, findings, skipped };
}

export function scanSecrets(root: string): Finding[] {
  const findings: Finding[] = [];
  for (const file of walkFiles(root)) {
    let content = '';
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(root, file);
    const entropyEnabled = !isLockfile(rel);
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (line.includes('holdthegoblin: allow-secret')) return;
      for (const rule of SECRET_PATTERNS) {
        if (rule.pattern.test(line)) {
          findings.push({
            scanner: 'secret',
            severity: 'CRITICAL',
            message: rule.message,
            file: rel,
            line: index + 1,
            ruleId: rule.id,
          });
        }
      }
      if (entropyEnabled) {
        for (const candidate of extractQuotedCandidates(line)) {
          if (candidate.length >= 32 && shannonEntropy(candidate) >= 4.2 && /[A-Za-z]/.test(candidate) && /\d/.test(candidate)) {
            findings.push({
              scanner: 'secret',
              severity: 'HIGH',
              message: 'High-entropy credential-like value detected',
              file: rel,
              line: index + 1,
              ruleId: 'high-entropy',
            });
          }
        }
      }
    });
  }
  return dedupeFindings(findings);
}

export function parseSemgrep(stdout: string): Finding[] {
  if (!stdout.trim()) return [];
  try {
    const parsed = JSON.parse(stdout) as {
      results?: Array<{
        check_id?: string;
        path?: string;
        start?: { line?: number };
        extra?: { message?: string; severity?: string };
      }>;
    };
    return (parsed.results ?? []).map((item) => ({
      scanner: 'semgrep',
      severity: item.extra?.severity ?? 'INFO',
      message: item.extra?.message ?? 'Semgrep finding',
      file: item.path,
      line: item.start?.line,
      ruleId: item.check_id,
    }));
  } catch {
    return [];
  }
}

export function parseTrivy(stdout: string): Finding[] {
  if (!stdout.trim()) return [];
  try {
    const parsed = JSON.parse(stdout) as {
      Results?: Array<{
        Target?: string;
        Vulnerabilities?: Array<{ VulnerabilityID?: string; Severity?: string; Title?: string; PkgName?: string }>;
        Misconfigurations?: Array<{ ID?: string; Severity?: string; Title?: string; Message?: string }>;
        Secrets?: Array<{ RuleID?: string; Severity?: string; Title?: string; StartLine?: number }>;
      }>;
    };
    const findings: Finding[] = [];
    for (const result of parsed.Results ?? []) {
      for (const vuln of result.Vulnerabilities ?? []) {
        findings.push({
          scanner: 'trivy',
          severity: vuln.Severity ?? 'UNKNOWN',
          message: vuln.Title ?? `Vulnerability in ${vuln.PkgName ?? 'package'}`,
          file: result.Target,
          ruleId: vuln.VulnerabilityID,
        });
      }
      for (const misconfig of result.Misconfigurations ?? []) {
        findings.push({
          scanner: 'trivy',
          severity: misconfig.Severity ?? 'UNKNOWN',
          message: misconfig.Message ?? misconfig.Title ?? 'Misconfiguration detected',
          file: result.Target,
          ruleId: misconfig.ID,
        });
      }
      for (const secret of result.Secrets ?? []) {
        findings.push({
          scanner: 'trivy',
          severity: secret.Severity ?? 'UNKNOWN',
          message: secret.Title ?? 'Secret detected',
          file: result.Target,
          line: secret.StartLine,
          ruleId: secret.RuleID,
        });
      }
    }
    return findings;
  } catch {
    return [];
  }
}

function* walkFiles(root: string): Generator<string> {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = statSync(full);
    if (stat.size > MAX_FILE_BYTES) continue;
    yield full;
  }
}

function extractQuotedCandidates(line: string): string[] {
  const values: string[] = [];
  const regex = /['"]([A-Za-z0-9_./+=:-]{24,})['"]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) values.push(match[1]);
  return values;
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.scanner}:${finding.ruleId}:${finding.file}:${finding.line}:${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isLockfile(file: string): boolean {
  return /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|Cargo\.lock|poetry\.lock)$/.test(file);
}
