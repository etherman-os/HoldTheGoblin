import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG, appPath, loadConfig, validateProjectConfig } from './config.js';
import { findConfigPolicyDowngrades } from './policy.js';
import { commandExists } from './runner.js';
import { verify } from './verify.js';
import type { GuardMode, VerifyResult } from './types.js';

export type ReadinessStatus = 'release-ready' | 'guarded' | 'partial' | 'at-risk';
export type ReadinessCheckStatus = 'pass' | 'warn' | 'fail';

export interface ReadinessCheck {
  id: string;
  label: string;
  status: ReadinessCheckStatus;
  score: number;
  maxScore: number;
  message: string;
  remediation?: string;
  evidence?: unknown;
}

export interface LatestVerifyReadiness {
  runId: string;
  ok: boolean;
  finishedAt: string;
  ageHours: number | null;
  stale: boolean;
  reportPath?: string;
  jsonReportPath?: string;
  source: 'fresh' | 'latest';
}

export interface ReadinessResult {
  schema: 'holdthegoblin.readiness.v1';
  root: string;
  generatedAt: string;
  mode: GuardMode;
  score: number;
  status: ReadinessStatus;
  checks: ReadinessCheck[];
  summary: {
    passed: number;
    warnings: number;
    failures: number;
  };
  latestVerify?: LatestVerifyReadiness;
}

export interface AssessReadinessOptions {
  root: string;
  runVerify?: boolean;
  now?: Date;
  staleAfterHours?: number;
  toolExists?: (tool: string, cwd: string) => Promise<boolean>;
  latestVerify?: VerifyResult | null;
}

interface WorkflowGateEvidence {
  workflows: string[];
  matched: string[];
}

const MAX_TEXT_FILE_BYTES = 512 * 1024;
const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const DEFAULT_STALE_AFTER_HOURS = 24;
const WORKFLOW_EXTENSIONS = new Set(['.yml', '.yaml']);
const RUNTIME_IGNORE_ENTRIES = [
  '.holdthegoblin/runs/',
  '.holdthegoblin/checkpoints/',
  '.holdthegoblin/tmp/',
  '.holdthegoblin/latest.md',
  '.holdthegoblin/latest.html',
  '.holdthegoblin/events.jsonl',
];
const CI_GATE_PATTERNS = [
  /\bholdthegoblin\s+verify\b/,
  /\bhtg\s+verify\b/,
  /\bnpm\s+run\s+verify:self\b/,
  /\bnpm\s+run\s+release:check\b/,
  /\bnpm\s+exec\s+--\s+holdthegoblin\s+verify\b/,
  /\bnode\s+dist\/src\/cli\.js\s+verify\b/,
];

export async function assessReadiness(options: AssessReadinessOptions): Promise<ReadinessResult> {
  const now = options.now ?? new Date();
  const config = safeLoadConfig(options.root);
  const workflowEvidence = findWorkflowGateEvidence(options.root);
  const latestVerify = await resolveLatestVerify(options, now);
  const checks: ReadinessCheck[] = [
    checkLatestVerification(latestVerify, options.staleAfterHours ?? DEFAULT_STALE_AFTER_HOURS),
    checkCiGate(workflowEvidence),
    checkAgentCoverage(options.root),
    await checkScannerCoverage(options.root, config.security, options.toolExists ?? commandExists),
    checkPolicyPosture(options.root, config.mode, config.githubActions.requirePinnedActions, workflowEvidence.workflows.length),
    checkEvidenceHygiene(options.root),
  ];
  const score = Math.max(0, Math.min(100, checks.reduce((total, check) => total + check.score, 0)));
  const summary = {
    passed: checks.filter((check) => check.status === 'pass').length,
    warnings: checks.filter((check) => check.status === 'warn').length,
    failures: checks.filter((check) => check.status === 'fail').length,
  };
  return {
    schema: 'holdthegoblin.readiness.v1',
    root: options.root,
    generatedAt: now.toISOString(),
    mode: config.mode,
    score,
    status: readinessStatus(score, checks, latestVerify),
    checks,
    summary,
    latestVerify,
  };
}

export function renderReadinessText(result: ReadinessResult): string {
  const lines = [
    `HoldTheGoblin Readiness: ${result.status} (${result.score}/100)`,
    `Mode: ${result.mode}`,
  ];
  if (result.latestVerify) {
    const age = result.latestVerify.ageHours === null ? 'unknown age' : `${result.latestVerify.ageHours.toFixed(1)}h old`;
    lines.push(`Latest verify: ${result.latestVerify.ok ? 'pass' : 'fail'} ${result.latestVerify.runId} (${age})`);
  } else {
    lines.push('Latest verify: missing');
  }
  lines.push('');
  for (const check of result.checks) {
    lines.push(`- ${check.status.toUpperCase()} ${check.label}: ${check.message} (${check.score}/${check.maxScore})`);
    if (check.remediation) lines.push(`  Fix: ${check.remediation}`);
  }
  return lines.join('\n');
}

async function resolveLatestVerify(options: AssessReadinessOptions, now: Date): Promise<LatestVerifyReadiness | undefined> {
  const staleAfterHours = options.staleAfterHours ?? DEFAULT_STALE_AFTER_HOURS;
  if (options.runVerify === true) {
    const fresh = await verify({ root: options.root });
    return summarizeLatestVerify(options.root, fresh, now, 'fresh', staleAfterHours);
  }
  if (options.latestVerify !== undefined) {
    return options.latestVerify ? summarizeLatestVerify(options.root, options.latestVerify, now, 'latest', staleAfterHours) : undefined;
  }
  const latest = readLatestVerifyResult(options.root);
  return latest ? summarizeLatestVerify(options.root, latest, now, 'latest', staleAfterHours) : undefined;
}

function checkLatestVerification(latest: LatestVerifyReadiness | undefined, staleAfterHours: number): ReadinessCheck {
  if (!latest) {
    return {
      id: 'evidence:latest-verify',
      label: 'Latest verification evidence',
      status: 'fail',
      score: 0,
      maxScore: 25,
      message: 'No immutable verification report was found under .holdthegoblin/runs; run holdthegoblin verify.',
      remediation: 'Run holdthegoblin verify, or use holdthegoblin readiness --verify to create fresh evidence before scoring.',
    };
  }
  if (!latest.ok) {
    return {
      id: 'evidence:latest-verify',
      label: 'Latest verification evidence',
      status: 'fail',
      score: 0,
      maxScore: 25,
      message: `Verification ${latest.runId} failed; fix the report findings and rerun verify.`,
      remediation: 'Open .holdthegoblin/latest.md, fix the failing checks, then rerun holdthegoblin verify.',
      evidence: latest,
    };
  }
  if (latest.stale) {
    const age = latest.ageHours === null ? 'unknown age' : `${latest.ageHours.toFixed(1)} hours old`;
    return {
      id: 'evidence:latest-verify',
      label: 'Latest verification evidence',
      status: 'warn',
      score: 12,
      maxScore: 25,
      message: `Last verification passed but is stale (${age}; threshold ${staleAfterHours}h).`,
      remediation: 'Run holdthegoblin readiness --verify before release, merge, or deploy decisions.',
      evidence: latest,
    };
  }
  return {
    id: 'evidence:latest-verify',
    label: 'Latest verification evidence',
    status: 'pass',
    score: 25,
    maxScore: 25,
    message: `Verification ${latest.runId} passed within the freshness window.`,
    evidence: latest,
  };
}

function checkCiGate(evidence: WorkflowGateEvidence): ReadinessCheck {
  if (evidence.workflows.length === 0) {
    return {
      id: 'ci:verification-gate',
      label: 'CI verification gate',
      status: 'warn',
      score: 0,
      maxScore: 15,
      message: 'No GitHub Actions workflow files were found.',
      remediation: 'Add a CI workflow that runs holdthegoblin verify, npm run verify:self, or npm run release:check.',
      evidence,
    };
  }
  if (evidence.matched.length === 0) {
    return {
      id: 'ci:verification-gate',
      label: 'CI verification gate',
      status: 'warn',
      score: 5,
      maxScore: 15,
      message: 'Workflow files exist, but no holdthegoblin verify, verify:self, or release:check gate was found.',
      remediation: 'Add holdthegoblin verify or npm run release:check to the pull request workflow.',
      evidence,
    };
  }
  return {
    id: 'ci:verification-gate',
    label: 'CI verification gate',
    status: 'pass',
    score: 15,
    maxScore: 15,
    message: `Verification gate found in ${evidence.matched.length} workflow file(s).`,
    evidence,
  };
}

function checkAgentCoverage(root: string): ReadinessCheck {
  const claudeSettings = readSmallTextFile(path.join(root, '.claude', 'settings.json'));
  const hardClaude = Boolean(claudeSettings && /hook claude/.test(claudeSettings) && /PreToolUse/.test(claudeSettings));
  const agentsRules = readSmallTextFile(path.join(root, 'AGENTS.md'));
  const advisory = {
    cursorRules: fileContains(path.join(root, '.cursor', 'rules', 'holdthegoblin.mdc'), 'holdthegoblin verify'),
    codexRules: Boolean(agentsRules && (
      agentsRules.includes('holdthegoblin:start') ||
      agentsRules.includes('holdthegoblin verify') ||
      agentsRules.includes('HoldTheGoblin Project Rules') ||
      agentsRules.includes('npm run release:check')
    )),
    warpRules: fileContains(path.join(root, 'WARP.md'), 'holdthegoblin verify'),
    sharedSkill: (
      fileContains(path.join(root, '.agents', 'skills', 'holdthegoblin', 'SKILL.md'), 'HoldTheGoblin Workflow') ||
      fileContains(path.join(root, '.codex', 'skills', 'holdthegoblin', 'SKILL.md'), 'HoldTheGoblin Workflow') ||
      fileContains(path.join(root, '.warp', 'skills', 'holdthegoblin', 'SKILL.md'), 'HoldTheGoblin Workflow')
    ),
  };
  const advisoryCount = Object.values(advisory).filter(Boolean).length;
  const score = (hardClaude ? 12 : 0) + Math.min(8, advisoryCount * 2);
  if (hardClaude) {
    return {
      id: 'agents:coverage',
      label: 'Agent guard coverage',
      status: 'pass',
      score,
      maxScore: 20,
      message: advisoryCount > 0
        ? 'Claude Code hard hooks and advisory agent assets are installed.'
        : 'Claude Code hard hooks are installed; no advisory rule assets were found.',
      remediation: advisoryCount > 0 ? undefined : 'Run holdthegoblin wrap --agent all . if this project should also guide Cursor, Codex, Warp, or skill-capable agents.',
      evidence: { hardHooks: { claudeCode: hardClaude }, advisory },
    };
  }
  if (advisoryCount > 0) {
    return {
      id: 'agents:coverage',
      label: 'Agent guard coverage',
      status: 'warn',
      score,
      maxScore: 20,
      message: 'Advisory agent guidance was found, but Claude Code hard hooks are not installed in this project. Demo tests exercise the hook engine; this check verifies automatic .claude/settings.json wiring.',
      remediation: 'Run holdthegoblin wrap --agent claude-code . to install project-level Claude Code hooks, or rely on CI when hard host hooks are not desired.',
      evidence: { hardHooks: { claudeCode: hardClaude }, advisory },
    };
  }
  return {
    id: 'agents:coverage',
    label: 'Agent guard coverage',
    status: 'fail',
    score: 0,
    maxScore: 20,
    message: 'No Claude Code hard hooks or advisory agent rule assets were detected in this project.',
    remediation: 'Run holdthegoblin wrap --agent all . to install Claude Code hooks plus advisory rules and skills.',
    evidence: { hardHooks: { claudeCode: hardClaude }, advisory },
  };
}

async function checkScannerCoverage(
  root: string,
  security: { secretScan: boolean; semgrep: boolean; trivy: boolean },
  toolExists: (tool: string, cwd: string) => Promise<boolean>
): Promise<ReadinessCheck> {
  const semgrepFound = security.semgrep ? await toolExists('semgrep', root) : false;
  const trivyFound = security.trivy ? await toolExists('trivy', root) : false;
  const evidence = {
    secretScan: security.secretScan ? 'enabled' : 'disabled',
    semgrep: security.semgrep ? semgrepFound ? 'enabled-found' : 'enabled-missing' : 'disabled',
    trivy: security.trivy ? trivyFound ? 'enabled-found' : 'enabled-missing' : 'disabled',
  };
  const score = (security.secretScan ? 8 : 0) + (semgrepFound ? 6 : 0) + (trivyFound ? 6 : 0);
  if (!security.secretScan) {
    return {
      id: 'scanners:coverage',
      label: 'Scanner coverage',
      status: 'fail',
      score,
      maxScore: 20,
      message: 'Built-in secret scanning is disabled.',
      remediation: 'Set security.secretScan to true in .holdthegoblin/config.json and rerun verification.',
      evidence,
    };
  }
  const skipped = [
    security.semgrep && !semgrepFound ? 'Semgrep configured but CLI missing; verify will report it as skipped, not passed' : undefined,
    security.trivy && !trivyFound ? 'Trivy configured but CLI missing; verify will report it as skipped, not passed' : undefined,
    !security.semgrep ? 'Semgrep policy is disabled' : undefined,
    !security.trivy ? 'Trivy policy is disabled' : undefined,
  ].filter(Boolean);
  if (skipped.length > 0) {
    return {
      id: 'scanners:coverage',
      label: 'Scanner coverage',
      status: 'warn',
      score,
      maxScore: 20,
      message: skipped.join('; '),
      remediation: scannerRemediation(security, semgrepFound, trivyFound),
      evidence,
    };
  }
  return {
    id: 'scanners:coverage',
    label: 'Scanner coverage',
    status: 'pass',
    score: 20,
    maxScore: 20,
    message: 'Built-in secret scan, Semgrep, and Trivy are enabled and available.',
    evidence,
  };
}

function checkPolicyPosture(root: string, mode: GuardMode, requirePinnedActions: boolean, workflowCount: number): ReadinessCheck {
  const validation = validateProjectConfig(root);
  if (!validation.ok) {
    return {
      id: 'policy:posture',
      label: 'Policy posture',
      status: 'fail',
      score: 0,
      maxScore: 15,
      message: 'Configuration is invalid; verification cannot evaluate policy reliably.',
      remediation: 'Run holdthegoblin config validate, fix the reported schema issues, then rerun readiness.',
      evidence: { path: validation.path, issues: validation.issues },
    };
  }
  const config = loadConfig(root);
  const downgrades = findConfigPolicyDowngrades(config);
  const evidence = { mode, downgrades, githubActions: { requirePinnedActions }, workflowCount };
  if (downgrades.length > 0) {
    const strictFailure = mode === 'strict';
    return {
      id: 'policy:posture',
      label: 'Policy posture',
      status: strictFailure ? 'fail' : 'warn',
      score: Math.max(0, 10 - downgrades.length * 2) + (requirePinnedActions ? 2 : 0),
      maxScore: 15,
      message: strictFailure
        ? `${downgrades.length} policy downgrade(s) detected; strict verification treats these as failures.`
        : `${downgrades.length} policy downgrade(s) detected; balanced/relaxed verification reports these as warnings.`,
      remediation: 'Restore the default failPolicy/security settings unless the weaker policy is intentionally documented and enforced elsewhere.',
      evidence,
    };
  }
  if (workflowCount > 0 && !requirePinnedActions) {
    return {
      id: 'policy:posture',
      label: 'Policy posture',
      status: 'warn',
      score: 12,
      maxScore: 15,
      message: 'Core policy floor is intact; GitHub Actions ref pinning remains report-only.',
      remediation: 'Set githubActions.requirePinnedActions to true after allowlisting any intentional mutable action refs.',
      evidence,
    };
  }
  return {
    id: 'policy:posture',
    label: 'Policy posture',
    status: 'pass',
    score: 15,
    maxScore: 15,
    message: 'Core policy floor is intact.',
    evidence,
  };
}

function checkEvidenceHygiene(root: string): ReadinessCheck {
  const gitignore = readSmallTextFile(path.join(root, '.gitignore'));
  if (!gitignore) {
    return {
      id: 'evidence:hygiene',
      label: 'Evidence hygiene',
      status: 'warn',
      score: 0,
      maxScore: 5,
      message: '.gitignore was not found or could not be read; runtime evidence paths may be committed accidentally.',
      remediation: 'Add .holdthegoblin/ or the generated runtime paths to .gitignore.',
    };
  }
  const lines = gitignore.split(/\r?\n/);
  const fullRuntimeDirIgnored = lines.includes('.holdthegoblin/') || lines.includes('/.holdthegoblin/');
  if (fullRuntimeDirIgnored) {
    return {
      id: 'evidence:hygiene',
      label: 'Evidence hygiene',
      status: 'pass',
      score: 5,
      maxScore: 5,
      message: 'The .holdthegoblin runtime directory is ignored locally.',
      evidence: { coveringEntry: '.holdthegoblin/' },
    };
  }
  const missing = RUNTIME_IGNORE_ENTRIES.filter((entry) => !lines.includes(entry));
  if (missing.length > 0) {
    return {
      id: 'evidence:hygiene',
      label: 'Evidence hygiene',
      status: 'warn',
      score: 2,
      maxScore: 5,
      message: `${missing.length} runtime evidence ignore entr${missing.length === 1 ? 'y is' : 'ies are'} missing.`,
      remediation: 'Run holdthegoblin wrap --agent all . or add the missing runtime entries to .gitignore.',
      evidence: { missing },
    };
  }
  return {
    id: 'evidence:hygiene',
    label: 'Evidence hygiene',
    status: 'pass',
    score: 5,
    maxScore: 5,
    message: 'Runtime reports, checkpoints, events, and temp files are ignored locally.',
  };
}

function readinessStatus(score: number, checks: ReadinessCheck[], latestVerify: LatestVerifyReadiness | undefined): ReadinessStatus {
  if (latestVerify && !latestVerify.ok) return 'at-risk';
  const failed = checks.some((check) => check.status === 'fail');
  if (score >= 90 && !failed) return 'release-ready';
  if (score >= 75 && !failed) return 'guarded';
  if (score >= 50) return 'partial';
  return 'at-risk';
}

function scannerRemediation(security: { semgrep: boolean; trivy: boolean }, semgrepFound: boolean, trivyFound: boolean): string {
  const actions: string[] = [];
  if (security.semgrep && !semgrepFound) actions.push('install Semgrep or set security.semgrep to false if intentionally skipped');
  if (security.trivy && !trivyFound) actions.push('install Trivy or set security.trivy to false if intentionally skipped');
  if (!security.semgrep) actions.push('set security.semgrep to true for SAST coverage');
  if (!security.trivy) actions.push('set security.trivy to true for filesystem vulnerability/misconfiguration coverage');
  return actions.length > 0 ? `${actions.join('; ')}.` : 'Review scanner configuration and rerun holdthegoblin verify.';
}

function summarizeLatestVerify(root: string, result: VerifyResult, now: Date, source: 'fresh' | 'latest', staleAfterHours: number): LatestVerifyReadiness {
  const finishedAt = Date.parse(result.finishedAt);
  const ageHours = Number.isFinite(finishedAt) ? Math.max(0, (now.getTime() - finishedAt) / 3_600_000) : null;
  return {
    runId: result.runId,
    ok: result.ok,
    finishedAt: result.finishedAt,
    ageHours,
    stale: ageHours === null || ageHours > staleAfterHours,
    reportPath: result.reportPath ? relativeToRoot(root, result.reportPath) : undefined,
    jsonReportPath: result.jsonReportPath ? relativeToRoot(root, result.jsonReportPath) : undefined,
    source,
  };
}

function safeLoadConfig(root: string) {
  try {
    return loadConfig(root);
  } catch {
    return DEFAULT_CONFIG;
  }
}

function readLatestVerifyResult(root: string): VerifyResult | undefined {
  const runDir = appPath(root, 'runs');
  if (!isSafeDirectory(runDir)) return undefined;
  const files = readdirSync(runDir)
    .filter((entry) => /^\d{14}-[a-z0-9]{6}\.json$/.test(entry))
    .sort()
    .reverse();
  for (const entry of files) {
    const file = path.join(runDir, entry);
    if (!isSafeRegularFile(file, MAX_REPORT_BYTES)) continue;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<VerifyResult>;
      if (typeof parsed.runId !== 'string' || typeof parsed.ok !== 'boolean' || typeof parsed.finishedAt !== 'string') continue;
      return {
        ok: parsed.ok,
        mode: parsed.mode ?? 'balanced',
        root: typeof parsed.root === 'string' ? parsed.root : root,
        runId: parsed.runId,
        startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : parsed.finishedAt,
        finishedAt: parsed.finishedAt,
        durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : 0,
        changedFiles: Array.isArray(parsed.changedFiles) ? parsed.changedFiles : [],
        detections: parsed.detections ?? { root, kinds: ['unknown'], testCommands: [], securityCommands: [], warnings: [] },
        commandResults: Array.isArray(parsed.commandResults) ? parsed.commandResults : [],
        checks: Array.isArray(parsed.checks) ? parsed.checks : [],
        findings: Array.isArray(parsed.findings) ? parsed.findings : [],
        edgeCases: Array.isArray(parsed.edgeCases) ? parsed.edgeCases : [],
        reportPath: parsed.reportPath,
        markdownReportPath: parsed.markdownReportPath,
        jsonReportPath: parsed.jsonReportPath ?? file,
        htmlReportPath: parsed.htmlReportPath,
      };
    } catch {
      continue;
    }
  }
  return undefined;
}

function findWorkflowGateEvidence(root: string): WorkflowGateEvidence {
  const workflows = listWorkflowFiles(root);
  const matched: string[] = [];
  for (const workflow of workflows) {
    const content = readSmallTextFile(path.join(root, workflow));
    if (content && CI_GATE_PATTERNS.some((pattern) => pattern.test(content))) matched.push(workflow);
  }
  return { workflows, matched };
}

function listWorkflowFiles(root: string): string[] {
  const dir = path.join(root, '.github', 'workflows');
  if (!isSafeDirectory(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !WORKFLOW_EXTENSIONS.has(path.extname(entry.name))) continue;
    const file = path.join(dir, entry.name);
    if (!isSafeRegularFile(file, MAX_TEXT_FILE_BYTES)) continue;
    files.push(relativeToRoot(root, file));
  }
  return files.sort();
}

function fileContains(file: string, needle: string): boolean {
  return readSmallTextFile(file)?.includes(needle) ?? false;
}

function readSmallTextFile(file: string): string | undefined {
  if (!isSafeRegularFile(file, MAX_TEXT_FILE_BYTES)) return undefined;
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function isSafeDirectory(dir: string): boolean {
  try {
    const stat = lstatSync(dir);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function isSafeRegularFile(file: string, maxBytes: number): boolean {
  try {
    const stat = lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size <= maxBytes;
  } catch {
    return false;
  }
}

function relativeToRoot(root: string, file: string): string {
  const absolute = path.isAbsolute(file) ? file : path.join(root, file);
  return path.relative(root, absolute).replace(/[\\/]+/g, '/');
}
