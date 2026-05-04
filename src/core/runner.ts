import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { redactSensitiveText } from './redact.js';
import type { CommandEnvSummary, CommandResult, PlannedCommand } from './types.js';

export interface RunOptions {
  cwd: string;
  timeoutMs: number;
  retries: number;
  env?: string[];
}

export interface CommandEnvironment {
  env: NodeJS.ProcessEnv;
  summary: CommandEnvSummary;
}

const DEFAULT_ENV_KEYS = new Set([
  'CI',
  'COLORTERM',
  'COMSPEC',
  'FORCE_COLOR',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'NO_COLOR',
  'PATH',
  'PATHEXT',
  'SHELL',
  'SYSTEMROOT',
  'SystemRoot',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USER',
  'USERPROFILE',
  'WINDIR',
]);

const DEFAULT_ENV_PREFIXES = [/^LC_[A-Z0-9_]*$/];
const SENSITIVE_ENV_KEY = /(?:TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|AUTH|COOKIE|SESSION|API[_-]?KEY|ACCESS[_-]?KEY|CLIENT[_-]?SECRET|BEARER|AWS_|AZURE_|GCP_|GOOGLE_|OPENAI_|ANTHROPIC_|GITHUB_|GITLAB_|NPM_.*TOKEN)/i;
const MAX_ENV_SUMMARY_KEYS = 50;

export async function commandExists(command: string, cwd: string): Promise<boolean> {
  const probe = process.platform === 'win32' ? `where ${command}` : `command -v ${command}`;
  const result = await runShell(
    { id: `doctor:${command}`, label: `Find ${command}`, command: probe, kind: 'doctor', required: false, reason: 'doctor' },
    { cwd, timeoutMs: 5000, retries: 0 }
  );
  return result.exitCode === 0;
}

export async function runPlannedCommands(commands: PlannedCommand[], options: RunOptions): Promise<CommandResult[]> {
  const results: CommandResult[] = [];
  for (const command of commands) {
    results.push(await runShell(command, options));
  }
  return results;
}

export async function runShell(command: PlannedCommand, options: RunOptions): Promise<CommandResult> {
  let attempts = 0;
  let last: CommandResult | undefined;
  const maxAttempts = Math.max(1, options.retries + 1);

  while (attempts < maxAttempts) {
    attempts += 1;
    last = await runOnce(command, options, attempts);
    if (last.exitCode === 0 && !last.timedOut) break;
    if (!isRetryable(last)) break;
  }

  return last!;
}

function runOnce(command: PlannedCommand, options: RunOptions, attempts: number): Promise<CommandResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;

    const childEnv = buildCommandEnvironment(process.env, [...(options.env ?? []), ...(command.env ?? [])]);
    const child = spawnPlannedCommand(command, options.cwd, childEnv.env);

    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child.pid, 'SIGTERM');
      setTimeout(() => {
        if (!settled) terminateProcessTree(child.pid, 'SIGKILL');
      }, 2500).unref();
    }, options.timeoutMs);
    timer.unref();

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 120_000) {
        stdout = stdout.slice(-120_000);
        stdoutTruncated = true;
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 120_000) {
        stderr = stderr.slice(-120_000);
        stderrTruncated = true;
      }
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        id: command.id,
        label: command.label,
        command: redactSensitiveText(command.command),
        skipped: false,
        exitCode: null,
        stdout: redactSensitiveText(stdout),
        stderr: redactSensitiveText(`${stderr}\n${error.message}`.trim()),
        durationMs: Date.now() - started,
        timedOut,
        attempts,
        stdoutTruncated,
        stderrTruncated,
        env: childEnv.summary,
      });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        id: command.id,
        label: command.label,
        command: redactSensitiveText(command.command),
        skipped: false,
        exitCode: code,
        stdout: redactSensitiveText(stdout),
        stderr: redactSensitiveText(stderr),
        durationMs: Date.now() - started,
        timedOut,
        attempts,
        stdoutTruncated,
        stderrTruncated,
        env: childEnv.summary,
      });
    });
  });
}

export function buildCommandEnvironment(source: NodeJS.ProcessEnv = process.env, explicitAllow: string[] = []): CommandEnvironment {
  const env: NodeJS.ProcessEnv = {};
  const explicitKeys = uniqueEnvKeys(explicitAllow);
  const explicit = new Set(explicitKeys);
  const blockedSensitiveKeys: string[] = [];
  let omittedAmbientCount = 0;

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (explicit.has(key) || isDefaultAllowedEnvKey(key)) {
      env[key] = value;
      continue;
    }
    if (isSensitiveEnvKey(key)) blockedSensitiveKeys.push(key);
    else omittedAmbientCount += 1;
  }

  env.CI = env.CI ?? '1';

  const allowedKeys = Object.keys(env).sort();
  return {
    env,
    summary: {
      allowedKeys: allowedKeys.slice(0, MAX_ENV_SUMMARY_KEYS),
      explicitKeys: explicitKeys.filter((key) => env[key] !== undefined).slice(0, MAX_ENV_SUMMARY_KEYS),
      blockedSensitiveKeys: blockedSensitiveKeys.sort().slice(0, MAX_ENV_SUMMARY_KEYS),
      blockedSensitiveCount: blockedSensitiveKeys.length,
      omittedAmbientCount,
    },
  };
}

function spawnPlannedCommand(command: PlannedCommand, cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const options: SpawnOptions = {
    cwd,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    detached: process.platform !== 'win32',
  };
  if (command.argv && command.argv.length > 0) {
    return spawn(command.argv[0], command.argv.slice(1), options);
  }
  if (command.shell === false) {
    return spawn(command.command, [], options);
  }
  const shell = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : '/bin/sh';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', command.command] : ['-c', command.command];
  return spawn(shell, args, options);
}

function uniqueEnvKeys(keys: string[]): string[] {
  return [...new Set(keys.filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)))].sort();
}

function isDefaultAllowedEnvKey(key: string): boolean {
  return DEFAULT_ENV_KEYS.has(key) || DEFAULT_ENV_PREFIXES.some((pattern) => pattern.test(key));
}

function isSensitiveEnvKey(key: string): boolean {
  return SENSITIVE_ENV_KEY.test(key);
}

function isRetryable(result: CommandResult): boolean {
  if (result.timedOut) return true;
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return (
    combined.includes('econnreset') ||
    combined.includes('etimedout') ||
    combined.includes('timeout') ||
    combined.includes('temporarily unavailable') ||
    combined.includes('rate limit') ||
    combined.includes('network')
  );
}

function terminateProcessTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    const args = ['/pid', String(pid), '/T', signal === 'SIGKILL' ? '/F' : undefined].filter(Boolean) as string[];
    const killer = spawn('taskkill', args, { stdio: 'ignore', windowsHide: true });
    killer.on('error', () => undefined);
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Process already exited.
    }
  }
}
