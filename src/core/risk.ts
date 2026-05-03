import path from 'node:path';

export type RiskDecision = 'allow' | 'ask' | 'deny';

export interface RiskResult {
  decision: RiskDecision;
  reason: string;
}

const DENY_COMMANDS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-rf\s+(?:\/|\*|~|\$HOME)(?:\s|$)/, reason: 'Destructive rm target is too broad.' },
  { pattern: /\bsudo\s+rm\s+-rf\b/, reason: 'Privileged recursive deletion is blocked.' },
  { pattern: /\b(?:mkfs|dd)\b.*\b(?:\/dev\/|of=\/dev\/)/, reason: 'Direct disk mutation is blocked.' },
  { pattern: /\bchmod\s+-R\s+777\s+(?:\/|~|\$HOME)/, reason: 'Unsafe recursive permissions change is blocked.' },
  { pattern: /\b(?:shutdown|halt|poweroff|reboot)\b/, reason: 'System shutdown is blocked.' },
  { pattern: /\b(dropdb|DROP\s+DATABASE)\b/i, reason: 'Database deletion is blocked.' },
  { pattern: /\bgit\s+push\b.*\s(?:--force|-f)(?:\s|$)/, reason: 'Force push is blocked.' },
  { pattern: /\b(?:curl|wget)\b.+\|\s*(?:sh|bash|zsh)\b/, reason: 'Piping network content into a shell is blocked.' },
  { pattern: /\bcat\s+.*(?:\.env|id_rsa|id_ed25519|\.pem)\b.*\|\s*(?:curl|wget|nc|netcat)\b/, reason: 'Possible credential exfiltration is blocked.' },
];

const ASK_COMMANDS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bkubectl\s+(?:apply|delete|rollout|scale|patch)\b/, reason: 'Kubernetes mutation requires human approval.' },
  { pattern: /\bterraform\s+(?:apply|destroy)\b/, reason: 'Terraform mutation requires human approval.' },
  { pattern: /\bdocker\s+compose\s+down\b.*\s-v\b/, reason: 'Docker volume deletion requires human approval.' },
  { pattern: /\b(?:fly|railway|vercel|netlify)\s+deploy\b.*(?:--prod|--production)?/, reason: 'Production deploy requires human approval.' },
  { pattern: /\b(?:npm|pnpm|yarn)\s+(?:publish|version)\b/, reason: 'Package publishing requires human approval.' },
  { pattern: /\b(?:psql|mysql)\b.*\b(?:delete|truncate|drop)\b/i, reason: 'Database mutation requires human approval.' },
];

const SENSITIVE_FILE_PATTERNS = [
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)id_rsa$/,
  /(^|\/)id_ed25519$/,
  /\.pem$/,
  /\.key$/,
  /(^|\/)\.aws\/credentials$/,
  /(^|\/)\.ssh\//,
];

export function evaluateCommandRisk(command: string): RiskResult {
  for (const rule of DENY_COMMANDS) {
    if (rule.pattern.test(command)) return { decision: 'deny', reason: rule.reason };
  }
  for (const rule of ASK_COMMANDS) {
    if (rule.pattern.test(command)) return { decision: 'ask', reason: rule.reason };
  }
  return { decision: 'allow', reason: 'No HoldTheGoblin risk rule matched.' };
}

export function evaluatePathReadRisk(filePath: string): RiskResult {
  const normalized = filePath.split(path.sep).join('/');
  for (const pattern of SENSITIVE_FILE_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        decision: 'deny',
        reason: `Reading sensitive file "${filePath}" would expose credentials to the agent context.`,
      };
    }
  }
  return { decision: 'allow', reason: 'No sensitive path rule matched.' };
}

export function hasMutationTool(toolName: string | undefined): boolean {
  return toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit';
}
