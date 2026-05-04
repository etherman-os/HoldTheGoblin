import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, realpathSync, type Stats } from 'node:fs';
import path from 'node:path';
import { appPath, ensureAppDirs } from './config.js';
import { isInsidePath } from './paths.js';
import { redactSensitiveData } from './redact.js';
import type { ToolCallPreflightResult } from './preflight.js';

export interface PolicyAuditRecord {
  schema: 'holdthegoblin.policy_audit.v1';
  timestamp: string;
  event: ToolCallPreflightResult['event'];
  decision: ToolCallPreflightResult['decision'];
  redaction: {
    secretsRedacted: true;
    toolArgumentValuesOmitted: true;
    payloadsCapped: true;
  };
}

export function appendPolicyAudit(root: string, result: ToolCallPreflightResult): PolicyAuditRecord {
  const record = redactSensitiveData<PolicyAuditRecord>({
    schema: 'holdthegoblin.policy_audit.v1',
    timestamp: new Date().toISOString(),
    event: result.event,
    decision: result.decision,
    redaction: {
      secretsRedacted: true,
      toolArgumentValuesOmitted: true,
      payloadsCapped: true,
    },
  });
  const file = policyAuditPath(root);
  ensurePolicyAuditPath(root, file);
  appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  setPrivatePermissions(file, 0o600);
  return record;
}

export function policyAuditPath(root: string): string {
  return appPath(root, 'policy', 'audit.jsonl');
}

function ensurePolicyAuditPath(root: string, file: string): void {
  ensureAppDirs(root);
  const dir = path.dirname(file);
  const realRoot = realpathSync(root);
  if (pathStat(dir)?.isSymbolicLink()) throw new Error(`HoldTheGoblin policy audit directory must not be a symlink: ${dir}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dirStat = pathStat(dir);
  if (!dirStat?.isDirectory()) throw new Error(`HoldTheGoblin policy audit path must be a directory: ${dir}`);
  if (dirStat.isSymbolicLink()) throw new Error(`HoldTheGoblin policy audit directory must not be a symlink: ${dir}`);
  if (!isInsidePath(realRoot, realpathSync(dir))) throw new Error(`HoldTheGoblin policy audit directory resolves outside project root: ${dir}`);
  setPrivatePermissions(dir, 0o700);

  const fileStat = pathStat(file);
  if (fileStat?.isSymbolicLink()) throw new Error(`HoldTheGoblin policy audit file must not be a symlink: ${file}`);
  if (fileStat && !fileStat.isFile()) throw new Error(`HoldTheGoblin policy audit path must be a file: ${file}`);
}

function pathStat(file: string): Stats | undefined {
  try {
    return lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function setPrivatePermissions(file: string, mode: number): void {
  if (process.platform === 'win32') return;
  try {
    chmodSync(file, mode);
  } catch {
    // Best-effort permission hardening; symlink/root checks remain blocking.
  }
}
