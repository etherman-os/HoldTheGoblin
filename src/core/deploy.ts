import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { createCheckpoint, rollbackCheckpoint, type CheckpointMeta } from './checkpoint.js';
import { appPath, ensureAppDirs, loadConfig } from './config.js';
import { appendEvent } from './events.js';
import { resolveProjectPath } from './paths.js';
import { redactSensitiveData, redactSensitiveText } from './redact.js';
import { evaluateCommandRisk } from './risk.js';
import { runShell } from './runner.js';
import { verify } from './verify.js';
import type { CommandResult, PlannedCommand, VerifyResult } from './types.js';

const commandSchema = z.object({
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
  retries: z.number().int().nonnegative().optional(),
  allowDangerous: z.boolean().default(false),
});

const deployPlanSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).default('holdthegoblin-deploy'),
  verify: z.boolean().default(true),
  checkpoint: z.boolean().default(true),
  shadow: commandSchema.optional(),
  shadowHealth: commandSchema.optional(),
  canary: commandSchema.optional(),
  canaryHealth: commandSchema.optional(),
  promote: commandSchema.optional(),
  rollback: commandSchema.optional(),
  rollbackCheckpoint: z.boolean().default(true),
});

export type DeployPlan = z.infer<typeof deployPlanSchema>;

export interface DeployPhaseResult {
  phase: 'verify' | 'checkpoint' | 'shadow' | 'shadowHealth' | 'canary' | 'canaryHealth' | 'promote' | 'rollback' | 'checkpointRollback';
  ok: boolean;
  onFailure?: boolean;
  commandResult?: CommandResult;
  verifyResult?: VerifyResult;
  checkpoint?: CheckpointMeta;
  skipped?: boolean;
  message?: string;
}

export interface DeployRunResult {
  ok: boolean;
  root: string;
  planPath: string;
  plan: DeployPlan;
  dryRun: boolean;
  rolledBack: boolean;
  checkpointId?: string;
  phases: DeployPhaseResult[];
  reportPath: string;
}

export function readDeployPlan(file: string): DeployPlan {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  return deployPlanSchema.parse(parsed);
}

export function writeExampleDeployPlan(file: string): string {
  const plan: DeployPlan = {
    version: 1,
    name: 'holdthegoblin-example',
    verify: true,
    checkpoint: true,
    shadow: { command: 'npm run deploy:shadow', allowDangerous: false },
    shadowHealth: { command: 'npm run health:shadow', allowDangerous: false },
    canary: { command: 'npm run deploy:canary', allowDangerous: false },
    canaryHealth: { command: 'npm run health:canary', allowDangerous: false },
    promote: { command: 'npm run deploy:promote', allowDangerous: false },
    rollback: { command: 'npm run deploy:rollback', allowDangerous: false },
    rollbackCheckpoint: true,
  };
  writeFileSync(file, JSON.stringify(plan, null, 2) + '\n');
  return file;
}

export async function runDeployPlan(options: {
  root: string;
  planPath: string;
  dryRun?: boolean;
}): Promise<DeployRunResult> {
  const root = options.root;
  const planPath = resolveProjectPath(root, options.planPath);
  if (!existsSync(planPath)) throw new Error(`Deploy plan not found: ${planPath}`);

  const config = loadConfig(root);
  const plan = readDeployPlan(planPath);
  const phases: DeployPhaseResult[] = [];
  let checkpoint: CheckpointMeta | undefined;
  let rolledBack = false;

  if (options.dryRun) {
    for (const phase of plannedPhases(plan)) {
      phases.push({
        phase: phase.phase,
        ok: true,
        skipped: true,
        onFailure: phase.onFailure,
        message: phase.onFailure ? 'Dry run: on-failure phase, command not executed.' : 'Dry run: command not executed.',
      });
    }
    const result = finalizeDeployResult({ root, planPath, plan, dryRun: true, rolledBack, checkpoint, phases });
    appendDeployEvent(result);
    return result;
  }

  if (plan.checkpoint) {
    checkpoint = await createCheckpoint(root, `deploy:${plan.name}`);
    phases.push({ phase: 'checkpoint', ok: true, checkpoint });
  }

  if (plan.verify) {
    const verifyResult = await verify({ root });
    phases.push({ phase: 'verify', ok: verifyResult.ok, verifyResult });
    if (!verifyResult.ok) {
      const result = finalizeDeployResult({ root, planPath, plan, dryRun: false, rolledBack, checkpoint, phases });
      appendDeployEvent(result);
      return result;
    }
  }

  for (const phase of ['shadow', 'shadowHealth', 'canary', 'canaryHealth', 'promote'] as const) {
    const spec = plan[phase];
    if (!spec) continue;
    const commandResult = await runDeployCommand(phase, spec, root, config.execution.timeoutMs, config.execution.retries);
    phases.push({ phase, ok: commandResult.exitCode === 0 && !commandResult.timedOut, commandResult });
    if (commandResult.exitCode !== 0 || commandResult.timedOut) {
      if (plan.rollback) {
        const rollbackResult = await runDeployCommand('rollback', plan.rollback, root, config.execution.timeoutMs, 0);
        phases.push({ phase: 'rollback', ok: rollbackResult.exitCode === 0 && !rollbackResult.timedOut, commandResult: rollbackResult });
      }
      if (checkpoint && plan.rollbackCheckpoint) {
        rollbackCheckpoint(root, checkpoint.id, false);
        rolledBack = true;
        phases.push({ phase: 'checkpointRollback', ok: true, checkpoint, message: 'Restored checkpoint-tracked files.' });
      }
      const result = finalizeDeployResult({ root, planPath, plan, dryRun: false, rolledBack, checkpoint, phases });
      appendDeployEvent(result);
      return result;
    }
  }

  const result = finalizeDeployResult({ root, planPath, plan, dryRun: false, rolledBack, checkpoint, phases });
  appendDeployEvent(result);
  return result;
}

function plannedPhases(plan: DeployPlan): Array<{ phase: DeployPhaseResult['phase']; onFailure?: boolean }> {
  const phases: Array<{ phase: DeployPhaseResult['phase']; onFailure?: boolean }> = [];
  if (plan.checkpoint) phases.push({ phase: 'checkpoint' });
  if (plan.verify) phases.push({ phase: 'verify' });
  for (const phase of ['shadow', 'shadowHealth', 'canary', 'canaryHealth', 'promote'] as const) {
    if (plan[phase]) phases.push({ phase });
  }
  if (plan.rollback) phases.push({ phase: 'rollback', onFailure: true });
  if (plan.rollbackCheckpoint) phases.push({ phase: 'checkpointRollback', onFailure: true });
  return phases;
}

async function runDeployCommand(
  phase: DeployPhaseResult['phase'],
  spec: z.infer<typeof commandSchema>,
  root: string,
  defaultTimeoutMs: number,
  defaultRetries: number
): Promise<CommandResult> {
  const risk = evaluateCommandRisk(spec.command);
  if (risk.decision === 'deny' || (risk.decision === 'ask' && !spec.allowDangerous)) {
    return {
      id: `deploy:${phase}`,
      label: `Deploy ${phase}`,
      command: redactSensitiveText(spec.command),
      skipped: false,
      exitCode: 1,
      stdout: '',
      stderr: risk.decision === 'deny'
        ? `Blocked by HoldTheGoblin deploy guard: ${risk.reason}`
        : `Blocked by HoldTheGoblin deploy guard: ${risk.reason} Set allowDangerous only after human review.`,
      durationMs: 0,
      timedOut: false,
      attempts: 0,
    };
  }
  const command: PlannedCommand = {
    id: `deploy:${phase}`,
    label: `Deploy ${phase}`,
    command: spec.command,
    kind: 'deploy',
    required: true,
    reason: `Deploy phase ${phase}`,
  };
  return runShell(command, {
    cwd: root,
    timeoutMs: spec.timeoutMs ?? defaultTimeoutMs,
    retries: spec.retries ?? defaultRetries,
  });
}

function finalizeDeployResult(input: {
  root: string;
  planPath: string;
  plan: DeployPlan;
  dryRun: boolean;
  rolledBack: boolean;
  checkpoint?: CheckpointMeta;
  phases: DeployPhaseResult[];
}): DeployRunResult {
  ensureAppDirs(input.root);
  const ok = input.phases.every((phase) => phase.ok);
  const result = redactSensitiveData<DeployRunResult>({
    ok,
    root: input.root,
    planPath: input.planPath,
    plan: input.plan,
    dryRun: input.dryRun,
    rolledBack: input.rolledBack,
    checkpointId: input.checkpoint?.id,
    phases: input.phases,
    reportPath: appPath(input.root, 'deploy-latest.json'),
  });
  writeFileSync(result.reportPath, JSON.stringify(result, null, 2) + '\n');
  return result;
}

function appendDeployEvent(result: DeployRunResult): void {
  appendEvent(result.root, {
    type: 'deploy',
    ok: result.ok,
    summary: `Deploy guard ${result.ok ? 'passed' : 'failed'} for ${result.plan.name}.`,
    data: {
      planPath: result.planPath,
      reportPath: result.reportPath,
      dryRun: result.dryRun,
      rolledBack: result.rolledBack,
      checkpointId: result.checkpointId,
      phases: result.phases.map((phase) => ({ phase: phase.phase, ok: phase.ok, skipped: phase.skipped })),
    },
  });
}
