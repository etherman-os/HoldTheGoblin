import { performance } from 'node:perf_hooks';
import { auditWorkflowActionRefs } from './actions.js';
import { loadConfig } from './config.js';
import { detectProject } from './detect.js';
import { findEdgeCases } from './edgecases.js';
import { getChangedFiles } from './git.js';
import { evaluateResults, isOk } from './policy.js';
import { writeReports, runId } from './report.js';
import { runPlannedCommands } from './runner.js';
import { runSecurityScans } from './security.js';
import type { VerifyResult } from './types.js';

export interface VerifyOptions {
  root: string;
  writeReport?: boolean;
  includeTests?: boolean;
  includeSecurity?: boolean;
  enforcePolicyFloor?: boolean;
}

export async function verify(options: VerifyOptions): Promise<VerifyResult> {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const config = loadConfig(options.root);
  const detections = detectProject(options.root, config);
  const includeTests = options.includeTests ?? true;
  const includeSecurity = options.includeSecurity ?? true;

  const changedFiles = await getChangedFiles(options.root);
  const edgeCases = findEdgeCases(options.root, changedFiles);
  const testResults = includeTests
    ? await runPlannedCommands(detections.testCommands, {
        cwd: options.root,
        timeoutMs: config.execution.timeoutMs,
        retries: config.execution.retries,
      })
    : [];

  const security = includeSecurity
    ? await runSecurityScans(options.root, config, detections.securityCommands)
    : { commandResults: [], findings: [], skipped: [] };

  const checks = evaluateResults(
    config,
    testResults,
    security.findings,
    [
      ...detections.warnings,
      ...security.skipped.map((item) => `${item}; scanner skipped.`),
    ],
    edgeCases,
    { enforcePolicyFloor: options.enforcePolicyFloor === true }
  );
  checks.push(...auditWorkflowActionRefs(options.root, config.githubActions));
  const finishedAt = new Date().toISOString();
  const result: VerifyResult = {
    ok: isOk(checks),
    mode: config.mode,
    root: options.root,
    runId: runId(),
    startedAt,
    finishedAt,
    durationMs: Math.round(performance.now() - started),
    changedFiles,
    detections,
    commandResults: [...testResults, ...security.commandResults],
    checks,
    findings: security.findings,
    edgeCases,
  };

  return options.writeReport === false ? result : writeReports(options.root, result);
}
