import { readFileSync } from 'node:fs';
import { findGitRoot } from './git.js';
import { renderMarkdownReport } from './output.js';
import { auditPolicyDecision, evaluateToolCallPreflight } from './preflight.js';
import { hasMutationTool } from './risk.js';
import type { HookInput } from './types.js';
import { verify } from './verify.js';

export async function handleClaudeHook(stdin = readStdin()): Promise<{ stdout: string; exitCode: number }> {
  const input = parseHookInput(stdin);
  if (!input) return denyPreTool('HoldTheGoblin: malformed hook input.');
  const event = input.hook_event_name;
  const root = await findGitRoot(input.cwd ?? process.cwd());

  if (event === 'PreToolUse') return handlePreToolUse(input, root);
  if (event === 'PostToolBatch') return handlePostToolBatch(input, root);
  if (event === 'Stop') return handleStop(input, root);

  return { stdout: '', exitCode: 0 };
}

function handlePreToolUse(input: HookInput, root: string): { stdout: string; exitCode: number } {
  const preflight = evaluateToolCallPreflight({
    host: 'claude-code',
    root,
    cwd: input.cwd,
    toolName: input.tool_name,
    toolInput: input.tool_input,
  });
  auditPolicyDecision(root, preflight);

  if (preflight.decision.decision !== 'allow') {
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: preflight.decision.decision,
          permissionDecisionReason: `HoldTheGoblin: ${preflight.decision.reason}`,
        },
      }),
    };
  }

  return { stdout: '', exitCode: 0 };
}

function denyPreTool(reason: string): { stdout: string; exitCode: number } {
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  };
}

async function handlePostToolBatch(input: HookInput, root: string): Promise<{ stdout: string; exitCode: number }> {
  const mutated = (input.tool_calls ?? []).some((call) => hasMutationTool(call.tool_name));
  if (!mutated) return { stdout: '', exitCode: 0 };

  const result = await verify({ root, includeTests: false, includeSecurity: true });
  if (result.ok) {
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolBatch',
          additionalContext: `HoldTheGoblin quick scan passed. Evidence report: ${result.reportPath}`,
        },
      }),
    };
  }

  return {
    exitCode: 0,
    stdout: JSON.stringify({
      decision: 'block',
      reason: `HoldTheGoblin quick scan failed. Report: ${result.reportPath}`,
      hookSpecificOutput: {
        hookEventName: 'PostToolBatch',
        additionalContext: renderAgentContext(result),
      },
    }),
  };
}

async function handleStop(input: HookInput, root: string): Promise<{ stdout: string; exitCode: number }> {
  if (input.stop_hook_active) return { stdout: '', exitCode: 0 };
  const result = await verify({ root });
  if (result.ok) {
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'Stop',
          additionalContext: `HoldTheGoblin full verification passed. Evidence report: ${result.reportPath}`,
        },
      }),
    };
  }

  return {
    exitCode: 0,
    stdout: JSON.stringify({
      decision: 'block',
      reason: `HoldTheGoblin blocked completion because verification failed. Report: ${result.reportPath}`,
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: renderAgentContext(result),
      },
    }),
  };
}

function renderAgentContext(result: Awaited<ReturnType<typeof verify>>): string {
  const report = renderMarkdownReport(result);
  return report.length > 9000 ? `${report.slice(0, 9000)}\n\nFull report: ${result.reportPath}` : report;
}

function parseHookInput(stdin: string): HookInput | undefined {
  if (!stdin.trim()) return {};
  try {
    return JSON.parse(stdin) as HookInput;
  } catch {
    return undefined;
  }
}

function readStdin(): string {
  return readFileSync(0, 'utf8');
}
