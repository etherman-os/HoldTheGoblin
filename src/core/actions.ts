import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { CheckResult } from './types.js';

export interface WorkflowActionRefFinding {
  file: string;
  line: number;
  uses: string;
  ref?: string;
  message: string;
}

export interface WorkflowActionAuditOptions {
  requirePinnedActions?: boolean;
  allowedUnpinnedActions?: string[];
}

const WORKFLOW_EXTENSIONS = new Set(['.yml', '.yaml']);
const MAX_WORKFLOW_BYTES = 512 * 1024;

export function auditWorkflowActionRefs(root: string, options: WorkflowActionAuditOptions = {}): CheckResult[] {
  const workflowFiles = listWorkflowFiles(root);
  if (workflowFiles.length === 0) return [];
  const findings = workflowFiles.flatMap((file) => findUnpinnedWorkflowActionRefs(root, file));
  if (findings.length === 0) {
    return [{
      id: 'github-actions:pinning',
      label: 'GitHub Actions pinning audit',
      status: 'pass',
      severity: 'info',
      message: 'External GitHub Actions refs are pinned to full commit SHAs.',
    }];
  }
  const allowed = new Set(options.allowedUnpinnedActions ?? []);
  const blockingFindings = findings.filter((finding) => !allowed.has(finding.uses));
  const blocking = options.requirePinnedActions === true && blockingFindings.length > 0;
  const allowedCount = findings.length - blockingFindings.length;
  return [{
    id: 'github-actions:pinning',
    label: 'GitHub Actions pinning audit',
    status: blocking ? 'fail' : 'warn',
    severity: blocking ? 'high' : 'medium',
    message: blocking
      ? `${blockingFindings.length} external GitHub Actions ref(s) are not pinned to a full commit SHA and are not allowlisted.`
      : `${findings.length} external GitHub Actions ref(s) are not pinned to a full commit SHA.${allowedCount > 0 ? ` ${allowedCount} allowlisted.` : ''} This is report-only; pin security-sensitive workflow refs downstream.`,
    evidence: findings.slice(0, 20).map((finding) => ({ ...finding, allowlisted: allowed.has(finding.uses) })),
  }];
}

export function findUnpinnedWorkflowActionRefs(root: string, file: string): WorkflowActionRefFinding[] {
  let content = '';
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const rel = path.relative(root, file).replace(/[\\/]+/g, '/');
  const findings: WorkflowActionRefFinding[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    const target = parseUsesTarget(line);
    if (!target || isLocalOrDockerAction(target)) return;
    const at = target.lastIndexOf('@');
    const ref = at >= 0 ? target.slice(at + 1) : undefined;
    if (ref && /^[a-f0-9]{40}$/i.test(ref)) return;
    findings.push({
      file: rel,
      line: index + 1,
      uses: target,
      ref,
      message: ref ? `Action ref "${ref}" is not a full commit SHA.` : 'Action reference has no explicit ref.',
    });
  });
  return findings;
}

function listWorkflowFiles(root: string): string[] {
  const dir = path.join(root, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  const stat = lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!WORKFLOW_EXTENSIONS.has(path.extname(entry.name))) continue;
    const file = path.join(dir, entry.name);
    if (statSync(file).size > MAX_WORKFLOW_BYTES) continue;
    files.push(file);
  }
  return files.sort();
}

function parseUsesTarget(line: string): string | undefined {
  if (line.trimStart().startsWith('#')) return undefined;
  const match = line.match(/^\s*(?:-\s*)?uses:\s*['"]?([^'"\s#]+)['"]?/);
  return match?.[1];
}

function isLocalOrDockerAction(target: string): boolean {
  return target.startsWith('./') || target.startsWith('../') || target.startsWith('docker://');
}
