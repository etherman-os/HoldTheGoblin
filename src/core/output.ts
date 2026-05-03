import type { CheckResult, CommandResult, Finding, VerifyResult } from './types.js';

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function statusIcon(status: CheckResult['status']): string {
  switch (status) {
    case 'pass':
      return 'PASS';
    case 'fail':
      return 'FAIL';
    case 'warn':
      return 'WARN';
    case 'skip':
      return 'SKIP';
  }
}

export function summarizeCommand(result: CommandResult): string {
  if (result.skipped) return `SKIP ${result.label}: ${result.skipReason ?? 'skipped'}`;
  const status = result.exitCode === 0 && !result.timedOut ? 'PASS' : 'FAIL';
  return `${status} ${result.label}: \`${result.command}\` (${formatDuration(result.durationMs)}, attempts ${result.attempts})`;
}

export function summarizeFinding(finding: Finding): string {
  const loc = finding.file ? ` ${finding.file}${finding.line ? `:${finding.line}` : ''}` : '';
  const rule = finding.ruleId ? ` [${finding.ruleId}]` : '';
  return `${finding.scanner.toUpperCase()} ${finding.severity}${loc}${rule}: ${finding.message}`;
}

export function renderMarkdownReport(result: VerifyResult): string {
  const lines: string[] = [];
  lines.push(`# HoldTheGoblin Verification ${result.ok ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push(`- Run: \`${result.runId}\``);
  lines.push(`- Root: \`${result.root}\``);
  lines.push(`- Mode: \`${result.mode}\``);
  lines.push(`- Duration: ${formatDuration(result.durationMs)}`);
  lines.push(`- Changed files: ${result.changedFiles.length}`);
  lines.push('');

  lines.push('## Checks');
  for (const check of result.checks) {
    lines.push(`- ${statusIcon(check.status)} **${check.label}** (${check.severity}): ${check.message}`);
  }
  if (result.checks.length === 0) lines.push('- No checks ran.');
  lines.push('');

  lines.push('## Commands');
  for (const command of result.commandResults) {
    lines.push(`- ${summarizeCommand(command)}`);
  }
  if (result.commandResults.length === 0) lines.push('- No commands ran.');
  lines.push('');

  lines.push('## Findings');
  for (const finding of result.findings) {
    lines.push(`- ${summarizeFinding(finding)}`);
  }
  if (result.findings.length === 0) lines.push('- No security findings.');
  lines.push('');

  lines.push('## Edge-Case Suggestions');
  for (const edgeCase of result.edgeCases) {
    lines.push(`- ${edgeCase.file}:${edgeCase.line} [${edgeCase.category}] ${edgeCase.suggestedTest}`);
  }
  if (result.edgeCases.length === 0) lines.push('- No edge-case suggestions.');
  lines.push('');

  if (!result.ok) {
    lines.push('## Agent Context');
    lines.push('HoldTheGoblin blocked completion because one or more required checks failed. Fix the failing checks above, rerun the listed commands, then run `holdthegoblin verify` again.');
    lines.push('');
  }

  return lines.join('\n');
}

export function renderTextSummary(result: VerifyResult): string {
  const header = `HoldTheGoblin ${result.ok ? 'PASS' : 'FAIL'} (${formatDuration(result.durationMs)})`;
  const failed = result.checks.filter((check) => check.status === 'fail');
  const warnings = result.checks.filter((check) => check.status === 'warn');
  const lines = [header, `Run: ${result.runId}`, `Report: ${result.reportPath ?? 'not written'}`];

  if (failed.length > 0) {
    lines.push('', 'Failures:');
    for (const check of failed) lines.push(`- ${check.label}: ${check.message}`);
  }

  if (warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const check of warnings) lines.push(`- ${check.label}: ${check.message}`);
  }

  return lines.join('\n');
}
