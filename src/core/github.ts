import { appendFileSync, existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { formatDuration, summarizeFinding, statusIcon } from './output.js';
import { isInsidePath, relativePosix } from './paths.js';
import { redactSensitiveData } from './redact.js';
import type { CheckResult, CommandResult, VerifyResult } from './types.js';

export interface GithubStepSummaryOptions {
  env?: NodeJS.ProcessEnv;
}

export function writeGithubStepSummary(result: VerifyResult, options: GithubStepSummaryOptions = {}): string {
  const summaryPath = resolveGithubStepSummaryPath(options.env ?? process.env);
  appendFileSync(summaryPath, renderGithubStepSummary(result));
  return summaryPath;
}

export function renderGithubStepSummary(input: VerifyResult): string {
  const result = redactSensitiveData(input);
  const failedChecks = result.checks.filter((check) => check.status === 'fail');
  const warningChecks = result.checks.filter((check) => check.status === 'warn');
  const skippedChecks = result.checks.filter((check) => check.status === 'skip');
  const failedCommands = result.commandResults.filter((command) => !command.skipped && (command.exitCode !== 0 || command.timedOut));
  const skippedCommands = result.commandResults.filter((command) => command.skipped);
  const lines: string[] = [];

  lines.push(`## HoldTheGoblin Verification ${result.ok ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push('| Item | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Run | ${cell(result.runId)} |`);
  lines.push(`| Mode | ${cell(result.mode)} |`);
  lines.push(`| Duration | ${cell(formatDuration(result.durationMs))} |`);
  lines.push(`| Checks | ${cell(`${countStatus(result.checks, 'pass')} pass, ${failedChecks.length} fail, ${warningChecks.length} warn, ${skippedChecks.length} skip`)} |`);
  lines.push(`| Commands | ${cell(`${countPassedCommands(result.commandResults)} pass, ${failedCommands.length} fail, ${skippedCommands.length} skip`)} |`);
  lines.push(`| Findings | ${cell(String(result.findings.length))} |`);
  lines.push(`| Edge-case suggestions | ${cell(String(result.edgeCases.length))} |`);
  lines.push('');

  const evidence = evidencePaths(result);
  lines.push('### Evidence');
  for (const evidencePath of evidence) {
    lines.push(`- ${inlineCode(evidencePath)}`);
  }
  if (evidence.length === 0) lines.push('- Evidence report was not written.');
  lines.push('');

  if (failedChecks.length > 0) {
    lines.push('### Failed Checks');
    lines.push('| Check | Severity | Message |');
    lines.push('| --- | --- | --- |');
    for (const check of limitRows(failedChecks)) {
      lines.push(`| ${cell(check.label)} | ${cell(check.severity)} | ${cell(check.message)} |`);
    }
    if (failedChecks.length > 10) lines.push(`| ${cell('More')} | ${cell('info')} | ${cell(`${failedChecks.length - 10} additional failed checks in the evidence report.`)} |`);
    lines.push('');
  }

  if (warningChecks.length > 0 || skippedChecks.length > 0) {
    lines.push('### Warnings And Skips');
    lines.push('| Status | Check | Message |');
    lines.push('| --- | --- | --- |');
    for (const check of limitRows([...warningChecks, ...skippedChecks])) {
      lines.push(`| ${cell(statusIcon(check.status))} | ${cell(check.label)} | ${cell(check.message)} |`);
    }
    if (warningChecks.length + skippedChecks.length > 10) lines.push(`| ${cell('More')} | ${cell('info')} | ${cell(`${warningChecks.length + skippedChecks.length - 10} additional warnings/skips in the evidence report.`)} |`);
    lines.push('');
  }

  if (failedCommands.length > 0) {
    lines.push('### Failed Commands');
    lines.push('| Command | Exit | Duration |');
    lines.push('| --- | --- | --- |');
    for (const command of limitRows(failedCommands)) {
      const exit = command.timedOut ? 'timed out' : String(command.exitCode ?? 'unknown');
      lines.push(`| ${cell(command.label)} | ${cell(exit)} | ${cell(formatDuration(command.durationMs))} |`);
    }
    if (failedCommands.length > 10) lines.push(`| ${cell('More')} | ${cell('info')} | ${cell(`${failedCommands.length - 10} additional failed commands in the evidence report.`)} |`);
    lines.push('');
  }

  lines.push('### Findings');
  if (result.findings.length === 0) {
    lines.push('No findings reported by enabled scans. Review checks for skipped scanners.');
  } else {
    lines.push('| Finding |');
    lines.push('| --- |');
    for (const finding of limitRows(result.findings)) lines.push(`| ${cell(summarizeFinding(finding))} |`);
    if (result.findings.length > 10) lines.push(`| ${cell(`${result.findings.length - 10} additional findings in the evidence report.`)} |`);
  }
  lines.push('');

  if (!result.ok) {
    lines.push('HoldTheGoblin blocked completion because one or more required checks failed. Fix the failing checks and rerun `holdthegoblin verify`.');
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function resolveGithubStepSummaryPath(env: NodeJS.ProcessEnv): string {
  if (env.GITHUB_ACTIONS !== 'true') throw new Error('--github-step-summary can only write inside GitHub Actions.');
  const summaryPath = env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) throw new Error('GITHUB_STEP_SUMMARY is not set.');
  if (!path.isAbsolute(summaryPath)) throw new Error('GITHUB_STEP_SUMMARY must be an absolute path.');
  if (existsSync(summaryPath)) {
    const stat = lstatSync(summaryPath);
    if (stat.isSymbolicLink()) throw new Error('GITHUB_STEP_SUMMARY must not be a symlink.');
    if (stat.isDirectory()) throw new Error('GITHUB_STEP_SUMMARY must be a file path.');
  }
  return summaryPath;
}

function evidencePaths(result: VerifyResult): string[] {
  const paths = [
    result.reportPath,
    result.htmlReportPath,
    result.jsonReportPath,
    result.markdownReportPath,
  ].filter((item): item is string => Boolean(item));
  return [...new Set(paths)].map((file) => {
    if (!isInsidePath(result.root, file)) return 'outside project root (not shown)';
    return relativePosix(result.root, file);
  });
}

function countStatus(checks: CheckResult[], status: CheckResult['status']): number {
  return checks.filter((check) => check.status === status).length;
}

function countPassedCommands(commands: CommandResult[]): number {
  return commands.filter((command) => !command.skipped && command.exitCode === 0 && !command.timedOut).length;
}

function limitRows<T>(rows: T[]): T[] {
  return rows.slice(0, 10);
}

function inlineCode(value: string): string {
  return `\`${escapeMarkdown(value).replace(/`/g, '\\`')}\``;
}

function cell(value: unknown): string {
  return escapeMarkdown(String(value)).replace(/\|/g, '\\|');
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
