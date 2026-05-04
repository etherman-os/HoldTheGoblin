import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { z } from 'zod';
import { createCheckpoint, rollbackCheckpoint, type CheckpointMeta } from './checkpoint.js';
import { appPath, ensureAppDirs, loadConfig } from './config.js';
import { appendEvent } from './events.js';
import { resolveExistingInsideProject } from './paths.js';
import { redactSensitiveData, redactSensitiveText } from './redact.js';
import { runId } from './report.js';
import { commandContainsLiteralCredential, evaluateCommandRisk } from './risk.js';
import { runShell } from './runner.js';
import { verify } from './verify.js';
import type { CommandResult, PlannedCommand, VerifyResult } from './types.js';

const commandSchema = z.object({
  command: z.string().min(1).optional(),
  argv: z.array(z.string().min(1)).min(1).optional(),
  env: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).max(50).optional(),
  timeoutMs: z.number().int().positive().optional(),
  retries: z.number().int().nonnegative().optional(),
  allowDangerous: z.boolean().default(false),
}).refine((value) => Boolean(value.command) !== Boolean(value.argv), {
  message: 'Set exactly one of "command" or "argv". Prefer "argv" for new deploy plans.',
}).refine((value) => !commandContainsLiteralCredential(commandTextForSchemaSpec(value)), {
  message: 'Deploy command contains a literal credential; use environment references such as $TOKEN instead.',
});

const deployPlanSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).default('holdthegoblin-deploy'),
  verify: z.boolean().default(true),
  checkpoint: z.boolean().default(true),
  allowPolicyDowngrade: z.boolean().default(false),
  shadow: commandSchema.optional(),
  shadowHealth: commandSchema.optional(),
  canary: commandSchema.optional(),
  canaryHealth: commandSchema.optional(),
  promote: commandSchema.optional(),
  rollback: commandSchema.optional(),
  rollbackCheckpoint: z.boolean().default(true),
});

export type DeployPlan = z.infer<typeof deployPlanSchema>;
type DeployCommandSpec = z.infer<typeof commandSchema>;

export interface DeployPhaseResult {
  phase: 'policy' | 'verify' | 'checkpoint' | 'shadow' | 'shadowHealth' | 'canary' | 'canaryHealth' | 'promote' | 'rollback' | 'checkpointRollback';
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
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  dryRun: boolean;
  rolledBack: boolean;
  checkpointId?: string;
  phases: DeployPhaseResult[];
  reportPath: string;
  runReportPath: string;
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
    allowPolicyDowngrade: false,
    shadow: { argv: ['npm', 'run', 'deploy:shadow'], allowDangerous: false },
    shadowHealth: { argv: ['npm', 'run', 'health:shadow'], allowDangerous: false },
    canary: { argv: ['npm', 'run', 'deploy:canary'], allowDangerous: false },
    canaryHealth: { argv: ['npm', 'run', 'health:canary'], allowDangerous: false },
    promote: { argv: ['npm', 'run', 'deploy:promote'], allowDangerous: false },
    rollback: { argv: ['npm', 'run', 'deploy:rollback'], allowDangerous: false },
    rollbackCheckpoint: true,
  };
  writeFileSync(file, JSON.stringify(plan, null, 2) + '\n');
  return file;
}

export async function runDeployPlan(options: {
  root: string;
  planPath: string;
  dryRun?: boolean;
  allowDangerous?: boolean;
}): Promise<DeployRunResult> {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const deployRunId = runId();
  const root = options.root;
  if (!existsSync(path.resolve(root, options.planPath))) throw new Error(`Deploy plan not found: ${options.planPath}`);
  const planPath = resolveExistingInsideProject(root, options.planPath);

  const config = loadConfig(root);
  const plan = readDeployPlan(planPath);
  const phases: DeployPhaseResult[] = [];
  let checkpoint: CheckpointMeta | undefined;
  let rolledBack = false;
  const policyPhase = evaluateDeployPolicy(plan, options.allowDangerous === true);
  if (policyPhase) {
    phases.push(policyPhase);
    if (!policyPhase.ok) {
      const result = finalizeDeployResult({ root, planPath, plan, runId: deployRunId, startedAt, started, dryRun: options.dryRun === true, rolledBack, checkpoint, phases });
      appendDeployEvent(result);
      return result;
    }
  }

  if (options.dryRun) {
    for (const phase of plannedPhases(plan)) {
      const spec = deploySpecForPhase(plan, phase.phase);
      if (spec) {
        const risk = evaluateCommandRisk(commandTextForSpec(spec));
        const approved = risk.decision === 'allow' || (risk.decision === 'ask' && spec.allowDangerous && options.allowDangerous === true);
        phases.push({
          phase: phase.phase,
          ok: approved,
          skipped: true,
          onFailure: phase.onFailure,
          message: approved
            ? phase.onFailure ? 'Dry run: on-failure phase, command not executed.' : 'Dry run: command not executed.'
            : risk.decision === 'deny'
              ? `Dry run blocked by HoldTheGoblin deploy guard: ${risk.reason}`
              : `Dry run blocked by HoldTheGoblin deploy guard: ${risk.reason} Set allowDangerous in the reviewed plan and pass --allow-dangerous only after human review.`,
        });
        continue;
      }
      phases.push({
        phase: phase.phase,
        ok: true,
        skipped: true,
        onFailure: phase.onFailure,
        message: phase.onFailure ? 'Dry run: on-failure phase, command not executed.' : 'Dry run: command not executed.',
      });
    }
    const result = finalizeDeployResult({ root, planPath, plan, runId: deployRunId, startedAt, started, dryRun: true, rolledBack, checkpoint, phases });
    appendDeployEvent(result);
    return result;
  }

  if (plan.verify) {
    const verifyResult = await verify({ root, enforcePolicyFloor: true });
    phases.push({ phase: 'verify', ok: verifyResult.ok, verifyResult });
    if (!verifyResult.ok) {
      const result = finalizeDeployResult({ root, planPath, plan, runId: deployRunId, startedAt, started, dryRun: false, rolledBack, checkpoint, phases });
      appendDeployEvent(result);
      return result;
    }
  }

  if (plan.checkpoint) {
    try {
      checkpoint = await createCheckpoint(root, `deploy:${plan.name}`);
      phases.push({ phase: 'checkpoint', ok: true, checkpoint });
    } catch (error) {
      phases.push({ phase: 'checkpoint', ok: false, message: errorMessage(error) });
      const result = finalizeDeployResult({ root, planPath, plan, runId: deployRunId, startedAt, started, dryRun: false, rolledBack, checkpoint, phases });
      appendDeployEvent(result);
      return result;
    }
  }

  for (const phase of ['shadow', 'shadowHealth', 'canary', 'canaryHealth', 'promote'] as const) {
    const spec = plan[phase];
    if (!spec) continue;
    const commandResult = await runDeployCommand(phase, spec, root, config.execution.timeoutMs, config.execution.retries, config.execution.env, options.allowDangerous === true);
    phases.push({ phase, ok: commandResult.exitCode === 0 && !commandResult.timedOut, commandResult });
    if (commandResult.exitCode !== 0 || commandResult.timedOut) {
      if (plan.rollback) {
        const rollbackResult = await runDeployCommand('rollback', plan.rollback, root, config.execution.timeoutMs, 0, config.execution.env, options.allowDangerous === true);
        phases.push({ phase: 'rollback', ok: rollbackResult.exitCode === 0 && !rollbackResult.timedOut, commandResult: rollbackResult });
      }
      if (checkpoint && plan.rollbackCheckpoint) {
        try {
          rollbackCheckpoint(root, checkpoint.id, false);
          rolledBack = true;
          phases.push({ phase: 'checkpointRollback', ok: true, checkpoint, message: 'Restored checkpoint-tracked files.' });
        } catch (error) {
          phases.push({ phase: 'checkpointRollback', ok: false, checkpoint, message: errorMessage(error) });
        }
      }
      const result = finalizeDeployResult({ root, planPath, plan, runId: deployRunId, startedAt, started, dryRun: false, rolledBack, checkpoint, phases });
      appendDeployEvent(result);
      return result;
    }
  }

  const result = finalizeDeployResult({ root, planPath, plan, runId: deployRunId, startedAt, started, dryRun: false, rolledBack, checkpoint, phases });
  appendDeployEvent(result);
  return result;
}

function plannedPhases(plan: DeployPlan): Array<{ phase: DeployPhaseResult['phase']; onFailure?: boolean }> {
  const phases: Array<{ phase: DeployPhaseResult['phase']; onFailure?: boolean }> = [];
  if (plan.verify) phases.push({ phase: 'verify' });
  if (plan.checkpoint) phases.push({ phase: 'checkpoint' });
  for (const phase of ['shadow', 'shadowHealth', 'canary', 'canaryHealth', 'promote'] as const) {
    if (plan[phase]) phases.push({ phase });
  }
  if (plan.rollback) phases.push({ phase: 'rollback', onFailure: true });
  if (plan.checkpoint && plan.rollbackCheckpoint) phases.push({ phase: 'checkpointRollback', onFailure: true });
  return phases;
}

function deploySpecForPhase(plan: DeployPlan, phase: DeployPhaseResult['phase']): DeployCommandSpec | undefined {
  if (phase === 'shadow' || phase === 'shadowHealth' || phase === 'canary' || phase === 'canaryHealth' || phase === 'promote' || phase === 'rollback') {
    return plan[phase];
  }
  return undefined;
}

async function runDeployCommand(
  phase: DeployPhaseResult['phase'],
  spec: DeployCommandSpec,
  root: string,
  defaultTimeoutMs: number,
  defaultRetries: number,
  defaultEnv: string[],
  allowDangerous: boolean
): Promise<CommandResult> {
  const commandText = commandTextForSpec(spec);
  const risk = evaluateCommandRisk(commandText);
  if (risk.decision === 'deny' || (risk.decision === 'ask' && !(spec.allowDangerous && allowDangerous))) {
    return {
      id: `deploy:${phase}`,
      label: `Deploy ${phase}`,
      command: redactSensitiveText(commandText),
      skipped: false,
      exitCode: 1,
      stdout: '',
      stderr: risk.decision === 'deny'
        ? `Blocked by HoldTheGoblin deploy guard: ${risk.reason}`
        : `Blocked by HoldTheGoblin deploy guard: ${risk.reason} Set allowDangerous in the reviewed plan and pass --allow-dangerous only after human review.`,
      durationMs: 0,
      timedOut: false,
      attempts: 0,
    };
  }
  const command: PlannedCommand = {
    id: `deploy:${phase}`,
    label: `Deploy ${phase}`,
    command: commandText,
    argv: spec.argv,
    env: spec.env,
    shell: spec.argv ? false : true,
    kind: 'deploy',
    required: true,
    reason: `Deploy phase ${phase}`,
  };
  return runShell(command, {
    cwd: root,
    timeoutMs: spec.timeoutMs ?? defaultTimeoutMs,
    retries: spec.retries ?? defaultRetriesForPhase(phase, defaultRetries),
    env: defaultEnv,
  });
}

function evaluateDeployPolicy(plan: DeployPlan, allowDangerous: boolean): DeployPhaseResult | undefined {
  const downgrades: string[] = [];
  if (!plan.verify) downgrades.push('pre-deploy verification is disabled');
  if (!plan.checkpoint) downgrades.push('checkpoint creation is disabled');
  if (plan.checkpoint && !plan.rollbackCheckpoint) downgrades.push('checkpoint rollback is disabled');
  if (plan.promote && !plan.shadowHealth && !plan.canaryHealth) {
    downgrades.push('promote is configured without any health gate');
  } else {
    if (plan.promote && plan.shadow && !plan.shadowHealth) downgrades.push('promote is configured without shadowHealth');
    if (plan.promote && plan.canary && !plan.canaryHealth) downgrades.push('promote is configured without canaryHealth');
  }
  if (downgrades.length === 0) return undefined;

  const approved = plan.allowPolicyDowngrade && allowDangerous;
  return {
    phase: 'policy',
    ok: approved,
    message: approved
      ? `Policy downgrade approved by reviewed plan and external --allow-dangerous: ${downgrades.join('; ')}.`
      : `Blocked deploy policy downgrade: ${downgrades.join('; ')}. Keep verify/checkpoint protections enabled, or set allowPolicyDowngrade in the reviewed plan and pass --allow-dangerous after human review.`,
  };
}

function defaultRetriesForPhase(phase: DeployPhaseResult['phase'], configuredRetries: number): number {
  return phase === 'shadowHealth' || phase === 'canaryHealth' ? configuredRetries : 0;
}

function commandTextForSpec(spec: DeployCommandSpec): string {
  if (spec.command) return spec.command;
  return renderArgv(spec.argv ?? []);
}

function commandTextForSchemaSpec(spec: { command?: string; argv?: string[] }): string {
  if (spec.command) return spec.command;
  return renderArgv(spec.argv ?? []);
}

function renderArgv(argv: string[]): string {
  return argv.map((arg) => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(' ');
}

function finalizeDeployResult(input: {
  root: string;
  planPath: string;
  plan: DeployPlan;
  runId: string;
  startedAt: string;
  started: number;
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
    runId: input.runId,
    startedAt: input.startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - input.started),
    dryRun: input.dryRun,
    rolledBack: input.rolledBack,
    checkpointId: input.checkpoint?.id,
    phases: input.phases,
    reportPath: appPath(input.root, 'deploy-latest.json'),
    runReportPath: appPath(input.root, 'deploy-runs', `${input.runId}.json`),
  });
  mkdirSync(path.dirname(result.runReportPath), { recursive: true });
  writeAtomic(result.runReportPath, JSON.stringify(result, null, 2) + '\n');
  writeAtomic(result.reportPath, JSON.stringify(result, null, 2) + '\n');
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
      runReportPath: result.runReportPath,
      dryRun: result.dryRun,
      rolledBack: result.rolledBack,
      checkpointId: result.checkpointId,
      phases: result.phases.map((phase) => ({ phase: phase.phase, ok: phase.ok, skipped: phase.skipped })),
    },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}
