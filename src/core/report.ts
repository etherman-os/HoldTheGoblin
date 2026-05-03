import { renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appPath, ensureAppDirs } from './config.js';
import { appendEvent } from './events.js';
import { renderMarkdownReport } from './output.js';
import { redactSensitiveData } from './redact.js';
import type { VerifyResult } from './types.js';

export function writeReports(root: string, result: VerifyResult): VerifyResult {
  ensureAppDirs(root);
  const runDir = appPath(root, 'runs');
  const jsonPath = path.join(runDir, `${result.runId}.json`);
  const markdownPath = path.join(runDir, `${result.runId}.md`);
  const latestPath = appPath(root, 'latest.md');

  const withPath = redactSensitiveData({
    ...result,
    reportPath: latestPath,
    markdownReportPath: markdownPath,
    jsonReportPath: jsonPath,
  });
  writeAtomic(jsonPath, JSON.stringify(withPath, null, 2) + '\n');
  const markdown = renderMarkdownReport(withPath);
  writeAtomic(markdownPath, markdown);
  writeAtomic(latestPath, markdown);
  appendEvent(root, {
    type: 'verify',
    ok: withPath.ok,
    summary: `Verification ${withPath.ok ? 'passed' : 'failed'} with ${withPath.checks.length} checks and ${withPath.findings.length} findings.`,
    data: {
      runId: withPath.runId,
      reportPath: withPath.reportPath,
      markdownReportPath: withPath.markdownReportPath,
      jsonReportPath: withPath.jsonReportPath,
      failedChecks: withPath.checks.filter((check) => check.status === 'fail').map((check) => check.label),
      warnings: withPath.checks.filter((check) => check.status === 'warn').map((check) => check.label),
      edgeCases: withPath.edgeCases.length,
    },
  });
  return withPath;
}

export function runId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}
