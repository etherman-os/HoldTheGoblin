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
    lines.push(`- ${statusIcon(check.status)} **${check.label}** (${check.severity}): ${check.message}${check.remediation ? ` Fix: ${check.remediation}` : ''}`);
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
  if (result.findings.length === 0) lines.push('- No findings reported by enabled scans. Review checks for skipped scanners.');
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

export function renderHtmlReport(result: VerifyResult): string {
  const failed = result.checks.filter((check) => check.status === 'fail').length;
  const warnings = result.checks.filter((check) => check.status === 'warn').length;
  const sections = [
    renderChecksTable(result.checks),
    renderCommandsTable(result.commandResults),
    renderFindingsTable(result.findings),
    renderEdgeCasesTable(result.edgeCases),
  ].join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HoldTheGoblin Verification ${escapeHtml(result.ok ? 'PASS' : 'FAIL')}</title>
  <style>
    :root { color-scheme: light; --bg: #f7f7f4; --panel: #ffffff; --text: #1e2328; --muted: #667085; --line: #d9ddd6; --pass: #0f7b45; --fail: #b42318; --warn: #a15c07; --skip: #4b5563; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: var(--bg); }
    main { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 48px; }
    header { border-bottom: 1px solid var(--line); padding-bottom: 20px; margin-bottom: 24px; }
    h1 { margin: 0 0 12px; font-size: 28px; line-height: 1.15; letter-spacing: 0; }
    h2 { margin: 28px 0 12px; font-size: 18px; letter-spacing: 0; }
    .status { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; }
    .badge { display: inline-block; min-width: 58px; text-align: center; border-radius: 4px; padding: 2px 8px; color: white; font-size: 12px; font-weight: 700; }
    .pass { background: var(--pass); } .fail { background: var(--fail); } .warn { background: var(--warn); } .skip { background: var(--skip); }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-top: 16px; }
    .metric { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; }
    .metric span { display: block; color: var(--muted); font-size: 12px; }
    .metric strong { display: block; margin-top: 2px; overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; text-align: left; }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; font-weight: 700; background: #fbfbf9; }
    tr:last-child td { border-bottom: 0; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
    .empty { color: var(--muted); background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px; }
    .summary { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>HoldTheGoblin Verification <span class="badge ${result.ok ? 'pass' : 'fail'}">${escapeHtml(result.ok ? 'PASS' : 'FAIL')}</span></h1>
      <div class="summary">${escapeHtml(result.checks.length)} checks, ${escapeHtml(result.commandResults.length)} commands, ${escapeHtml(result.findings.length)} findings, ${escapeHtml(result.edgeCases.length)} edge-case suggestions, ${escapeHtml(failed)} failures, ${escapeHtml(warnings)} warnings</div>
      <div class="meta">
        ${metric('Run', result.runId)}
        ${metric('Mode', result.mode)}
        ${metric('Duration', formatDuration(result.durationMs))}
        ${metric('Changed Files', String(result.changedFiles.length))}
        ${metric('Started', result.startedAt)}
        ${metric('Finished', result.finishedAt)}
      </div>
    </header>
${sections}
  </main>
</body>
</html>
`;
}

export function renderTextSummary(result: VerifyResult): string {
  const header = `HoldTheGoblin ${result.ok ? 'PASS' : 'FAIL'} (${formatDuration(result.durationMs)})`;
  const failed = result.checks.filter((check) => check.status === 'fail');
  const warnings = result.checks.filter((check) => check.status === 'warn');
  const lines = [header, `Run: ${result.runId}`, `Report: ${result.reportPath ?? 'not written'}`];
  if (result.htmlReportPath) lines.push(`HTML Report: ${result.htmlReportPath}`);

  if (failed.length > 0) {
    lines.push('', 'Failures:');
    for (const check of failed) lines.push(`- ${check.label}: ${check.message}${check.remediation ? ` Fix: ${check.remediation}` : ''}`);
  }

  if (warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const check of warnings) lines.push(`- ${check.label}: ${check.message}${check.remediation ? ` Fix: ${check.remediation}` : ''}`);
  }

  return lines.join('\n');
}

function renderChecksTable(checks: VerifyResult['checks']): string {
  if (checks.length === 0) return section('Checks', '<div class="empty">No checks ran.</div>');
  const rows = checks.map((check) => `<tr><td><span class="badge ${escapeAttr(check.status)}">${escapeHtml(statusIcon(check.status))}</span></td><td>${escapeHtml(check.label)}</td><td>${escapeHtml(check.severity)}</td><td>${escapeHtml(check.message)}</td><td>${escapeHtml(check.remediation ?? '')}</td></tr>`).join('\n');
  return section('Checks', `<table><thead><tr><th>Status</th><th>Check</th><th>Severity</th><th>Message</th><th>Remediation</th></tr></thead><tbody>${rows}</tbody></table>`);
}

function renderCommandsTable(commands: VerifyResult['commandResults']): string {
  if (commands.length === 0) return section('Commands', '<div class="empty">No commands ran.</div>');
  const rows = commands.map((command) => `<tr><td><span class="badge ${command.skipped ? 'skip' : command.exitCode === 0 && !command.timedOut ? 'pass' : 'fail'}">${escapeHtml(command.skipped ? 'SKIP' : command.exitCode === 0 && !command.timedOut ? 'PASS' : 'FAIL')}</span></td><td>${escapeHtml(command.label)}</td><td><code>${escapeHtml(command.command)}</code></td><td>${escapeHtml(formatDuration(command.durationMs))}</td><td>${escapeHtml(String(command.attempts))}</td></tr>`).join('\n');
  return section('Commands', `<table><thead><tr><th>Status</th><th>Command</th><th>Text</th><th>Duration</th><th>Attempts</th></tr></thead><tbody>${rows}</tbody></table>`);
}

function renderFindingsTable(findings: VerifyResult['findings']): string {
  if (findings.length === 0) return section('Findings', '<div class="empty">No findings reported by enabled scans. Review checks for skipped scanners.</div>');
  const rows = findings.map((finding) => `<tr><td>${escapeHtml(finding.scanner.toUpperCase())}</td><td>${escapeHtml(finding.severity)}</td><td>${escapeHtml(finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}` : '')}</td><td>${escapeHtml(finding.ruleId ?? '')}</td><td>${escapeHtml(finding.message)}</td></tr>`).join('\n');
  return section('Findings', `<table><thead><tr><th>Scanner</th><th>Severity</th><th>Location</th><th>Rule</th><th>Message</th></tr></thead><tbody>${rows}</tbody></table>`);
}

function renderEdgeCasesTable(edgeCases: VerifyResult['edgeCases']): string {
  if (edgeCases.length === 0) return section('Edge-Case Suggestions', '<div class="empty">No edge-case suggestions.</div>');
  const rows = edgeCases.map((edgeCase) => `<tr><td>${escapeHtml(`${edgeCase.file}:${edgeCase.line}`)}</td><td>${escapeHtml(edgeCase.category)}</td><td>${escapeHtml(edgeCase.suggestedTest)}</td></tr>`).join('\n');
  return section('Edge-Case Suggestions', `<table><thead><tr><th>Location</th><th>Category</th><th>Suggested Test</th></tr></thead><tbody>${rows}</tbody></table>`);
}

function section(title: string, body: string): string {
  return `    <section>
      <h2>${escapeHtml(title)}</h2>
      ${body}
    </section>`;
}

function metric(label: string, value: string): string {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/[^a-z-]/g, '');
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
