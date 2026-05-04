import { realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appPath, ensureAppDirs } from './config.js';
import { appendEvent } from './events.js';
import { renderHtmlReport, renderMarkdownReport } from './output.js';
import { isInsidePath } from './paths.js';
import { redactSensitiveData } from './redact.js';
import type { VerifyResult } from './types.js';

export function writeReports(root: string, result: VerifyResult): VerifyResult {
  if (!/^\d{14}-[a-z0-9]{6}$/.test(result.runId)) throw new Error(`Invalid verification run id: ${result.runId}`);
  ensureAppDirs(root);
  const runDir = appPath(root, 'runs');
  assertRuntimeDir(root, appPath(root));
  assertRuntimeDir(root, runDir);
  const jsonPath = path.join(runDir, `${result.runId}.json`);
  const markdownPath = path.join(runDir, `${result.runId}.md`);
  const htmlPath = path.join(runDir, `${result.runId}.html`);
  assertReportPath(runDir, jsonPath);
  assertReportPath(runDir, markdownPath);
  assertReportPath(runDir, htmlPath);
  const latestPath = appPath(root, 'latest.md');
  const latestHtmlPath = appPath(root, 'latest.html');

  const withPath = redactSensitiveData({
    ...result,
    reportPath: latestPath,
    markdownReportPath: markdownPath,
    jsonReportPath: jsonPath,
    htmlReportPath: htmlPath,
  });
  writeAtomic(jsonPath, JSON.stringify(withPath, null, 2) + '\n');
  const markdown = renderMarkdownReport(withPath);
  writeAtomic(markdownPath, markdown);
  writeAtomic(latestPath, markdown);
  const html = renderHtmlReport(withPath);
  writeAtomic(htmlPath, html);
  writeAtomic(latestHtmlPath, html);
  appendEvent(root, {
    type: 'verify',
    ok: withPath.ok,
    summary: `Verification ${withPath.ok ? 'passed' : 'failed'} with ${withPath.checks.length} checks and ${withPath.findings.length} findings.`,
    data: {
      runId: withPath.runId,
      reportPath: withPath.reportPath,
      markdownReportPath: withPath.markdownReportPath,
      jsonReportPath: withPath.jsonReportPath,
      htmlReportPath: withPath.htmlReportPath,
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

function assertRuntimeDir(root: string, dir: string): void {
  const realRoot = realpathSync(root);
  const realDir = realpathSync(dir);
  if (!isInsidePath(realRoot, realDir)) throw new Error(`HoldTheGoblin runtime path resolves outside project root: ${dir}`);
}

function assertReportPath(runDir: string, file: string): void {
  if (!isInsidePath(runDir, file)) throw new Error(`Report path resolves outside HoldTheGoblin runs directory: ${file}`);
}
