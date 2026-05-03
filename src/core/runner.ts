import { spawn } from 'node:child_process';
import { redactSensitiveText } from './redact.js';
import type { CommandResult, PlannedCommand } from './types.js';

export interface RunOptions {
  cwd: string;
  timeoutMs: number;
  retries: number;
}

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

    const child = spawn(command.command, {
      cwd: options.cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: process.env.CI ?? '1' },
      detached: process.platform !== 'win32',
    });

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
      });
    });
  });
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
