import { randomUUID } from 'node:crypto';
import { appendEvent } from './events.js';
import { appendPolicyAudit } from './policy-audit.js';
import { redactSensitiveData } from './redact.js';
import { evaluateToolCallRisk } from './risk.js';
import type { PolicyActionType, PolicyDecision, PolicyEvent } from './types.js';

const MAX_POLICY_STRING_BYTES = 8192;
const MAX_POLICY_KEYS = 50;

export interface ToolCallPreflightInput {
  host?: PolicyEvent['host'];
  root?: string;
  cwd?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
}

export interface ToolCallPreflightResult {
  event: PolicyEvent;
  decision: PolicyDecision;
}

export interface PolicyEventPreflightInput {
  host?: PolicyEvent['host'];
  cwd?: string;
  actionType: PolicyActionType;
  toolName?: string;
  action?: Record<string, unknown>;
}

export function evaluateToolCallPreflight(input: ToolCallPreflightInput): ToolCallPreflightResult {
  const event = buildPolicyEvent(input);
  const risk = evaluateToolCallRisk(input.toolName, input.toolInput);
  return {
    event,
    decision: {
      schema: 'holdthegoblin.policy_decision.v1',
      eventId: event.id,
      decision: risk.decision,
      reason: risk.reason,
    },
  };
}

export function evaluatePolicyEventPreflight(input: PolicyEventPreflightInput): ToolCallPreflightResult {
  const event = buildNormalizedPolicyEvent(input);
  const riskInput = toolCallInputForPolicyEvent(input);
  const risk = evaluateToolCallRisk(riskInput.toolName, riskInput.toolInput);
  return {
    event,
    decision: {
      schema: 'holdthegoblin.policy_decision.v1',
      eventId: event.id,
      decision: risk.decision,
      reason: risk.reason,
    },
  };
}

export function auditPolicyDecision(root: string, result: ToolCallPreflightResult): void {
  appendPolicyAudit(root, result);
  appendEvent(root, {
    type: 'policy',
    ok: result.decision.decision === 'allow',
    summary: `Policy ${result.decision.decision} for ${result.event.actionType}.`,
    data: {
      event: result.event,
      decision: result.decision,
    },
  });
}

function buildPolicyEvent(input: ToolCallPreflightInput): PolicyEvent {
  const actionType = policyActionType(input.toolName);
  const event: PolicyEvent = {
    schema: 'holdthegoblin.policy_event.v1',
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    host: input.host ?? 'unknown',
    actionType,
    cwd: policyString(input.cwd),
    toolName: input.toolName,
    action: policyActionPayload(actionType, input.toolInput),
  };
  return redactSensitiveData(event);
}

function buildNormalizedPolicyEvent(input: PolicyEventPreflightInput): PolicyEvent {
  const event: PolicyEvent = {
    schema: 'holdthegoblin.policy_event.v1',
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    host: input.host ?? 'unknown',
    actionType: input.actionType,
    cwd: policyString(input.cwd),
    toolName: policyString(input.toolName),
    action: policyActionPayload(input.actionType, input.action),
  };
  return redactSensitiveData(event);
}

function toolCallInputForPolicyEvent(input: PolicyEventPreflightInput): { toolName: string; toolInput: Record<string, unknown> } {
  if (input.actionType === 'shell_command') return { toolName: 'Bash', toolInput: { command: input.action?.command } };
  if (input.actionType === 'file_read') return { toolName: input.toolName ?? 'Read', toolInput: { path: input.action?.path, pattern: input.action?.pattern } };
  if (input.actionType === 'file_write') return { toolName: input.toolName ?? 'Write', toolInput: { path: input.action?.path } };
  return { toolName: input.toolName ?? 'Tool', toolInput: input.action ?? {} };
}

function policyActionType(toolName: string | undefined): PolicyActionType {
  if (toolName === 'Bash') return 'shell_command';
  if (toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob' || toolName === 'LS') return 'file_read';
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') return 'file_write';
  return 'tool_call';
}

function policyActionPayload(actionType: PolicyActionType, input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {};
  if (actionType === 'shell_command') return { command: policyString(input.command) };
  if (actionType === 'file_read' || actionType === 'file_write') {
    return {
      path: policyString(input.file_path ?? input.path ?? input.notebook_path),
      pattern: policyString(input.pattern),
    };
  }
  const keys = Object.keys(input);
  return {
    keys: keys.slice(0, MAX_POLICY_KEYS).map(policyString),
    omittedKeyCount: Math.max(0, keys.length - MAX_POLICY_KEYS),
  };
}

function policyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length <= MAX_POLICY_STRING_BYTES) return value;
  return `${value.slice(0, MAX_POLICY_STRING_BYTES)}...[truncated]`;
}
