import { toPosixPath } from './paths.js';

export type RiskDecision = 'allow' | 'ask' | 'deny';

export interface RiskResult {
  decision: RiskDecision;
  reason: string;
}

const DENY_COMMANDS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(?:^|[\s"'=<>@])(?:[^\s"']*\/)?(?:\.env(?:$|[\w.-]*)|\.npmrc\b|\.pypirc\b|\.netrc\b|\.kube\/(?:config)?|\.docker\/config\.json\b|\.aws\/(?:credentials|config)\b|\.config\/gcloud\/|application_default_credentials\.json\b|\.azure\/|\.gnupg\/|id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?\b|[^"' ]+\.(?:pem|key|p12|pfx|jks|keystore)\b|\.ssh\/)/, reason: 'Shell command references a sensitive credential path.' },
  { pattern: /\b(?:cat|grep|rg|sed|awk|head|tail|less|more|nl)\b[\s\S]*(?:^|[\s"'=<>])(?:[^\s"']*\/)?(?:\.env(?:$|[\w.-]*)|id_rsa\b|id_ed25519\b|[^"' ]+\.(?:pem|key)\b|\.aws\/credentials\b|\.ssh\/)/, reason: 'Reading sensitive files through shell commands is blocked.' },
  { pattern: /\b(?:mkfs|dd)\b.*\b(?:\/dev\/|of=\/dev\/)/, reason: 'Direct disk mutation is blocked.' },
  { pattern: /\bchmod\s+-R\s+777\s+(?:\/|~|\$HOME)/, reason: 'Unsafe recursive permissions change is blocked.' },
  { pattern: /\b(?:shutdown|halt|poweroff|reboot)\b/, reason: 'System shutdown is blocked.' },
  { pattern: /\b(dropdb|DROP\s+DATABASE)\b/i, reason: 'Database deletion is blocked.' },
  { pattern: /\bgit\s+push\b.*\s(?:--force|-f)(?:\s|$)/, reason: 'Force push is blocked.' },
  { pattern: /\b(?:curl|wget)\b.+\|\s*(?:sh|bash|zsh)\b/, reason: 'Piping network content into a shell is blocked.' },
  { pattern: /\bcat\s+.*(?:\.env|id_rsa|id_ed25519|\.pem)\b.*\|\s*(?:curl|wget|nc|netcat)\b/, reason: 'Possible credential exfiltration is blocked.' },
];

const ASK_COMMANDS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(?:bash|sh|zsh|fish|node|python|python3|ruby|perl|php)\s+-(?:c|e)\b/, reason: 'Inline interpreter execution requires human approval.' },
  { pattern: /\bkubectl\s+(?:apply|delete|rollout|scale|patch)\b/, reason: 'Kubernetes mutation requires human approval.' },
  { pattern: /\bterraform\s+(?:apply|destroy)\b/, reason: 'Terraform mutation requires human approval.' },
  { pattern: /\bdocker\s+compose\s+down\b.*\s-v\b/, reason: 'Docker volume deletion requires human approval.' },
  { pattern: /\b(?:fly|railway|vercel|netlify)\s+deploy\b.*(?:--prod|--production)?/, reason: 'Production deploy requires human approval.' },
  { pattern: /\b(?:npm|pnpm|yarn)\s+(?:publish|version)\b/, reason: 'Package publishing requires human approval.' },
  { pattern: /\b(?:psql|mysql)\b.*\b(?:delete|truncate|drop)\b/i, reason: 'Database mutation requires human approval.' },
];

const SENSITIVE_FILE_PATTERNS = [
  /(^|\/)\.env(?:$|[\w.-]*)/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.pypirc$/,
  /(^|\/)\.netrc$/,
  /(^|\/)id_rsa$/,
  /(^|\/)id_dsa$/,
  /(^|\/)id_ecdsa$/,
  /(^|\/)id_ed25519$/,
  /(^|\/)id_ed25519_sk$/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /\.jks$/,
  /\.keystore$/,
  /(^|\/)\.aws\/credentials$/,
  /(^|\/)\.aws\/config$/,
  /(^|\/)\.ssh\//,
  /(^|\/)\.kube(?:\/|$)/,
  /(^|\/)\.docker\/config\.json$/,
  /(^|\/)\.config\/gcloud\//,
  /(^|\/)application_default_credentials\.json$/,
  /(^|\/)\.azure(?:\/|$)/,
  /(^|\/)\.gnupg(?:\/|$)/,
];

export function evaluateCommandRisk(command: string): RiskResult {
  const normalizedCommand = toPosixPath(command);
  if (commandContainsLiteralCredential(normalizedCommand)) {
    return { decision: 'deny', reason: 'Shell command embeds a literal credential; use environment references or a reviewed secret manager.' };
  }
  if (hasBroadDestructiveRm(normalizedCommand)) {
    return { decision: 'deny', reason: 'Destructive rm target is too broad.' };
  }
  for (const rule of DENY_COMMANDS) {
    if (rule.pattern.test(normalizedCommand)) return { decision: 'deny', reason: rule.reason };
  }
  for (const rule of ASK_COMMANDS) {
    if (rule.pattern.test(normalizedCommand)) return { decision: 'ask', reason: rule.reason };
  }
  return { decision: 'allow', reason: 'No HoldTheGoblin risk rule matched.' };
}

export function commandContainsLiteralCredential(command: string): boolean {
  return hasLiteralCredentialArgument(toPosixPath(command));
}

export function evaluateToolCallRisk(toolName: string | undefined, toolInput: Record<string, unknown> | undefined): RiskResult {
  if (toolName === 'Bash') {
    return evaluateCommandRisk(String(toolInput?.command ?? ''));
  }

  const sensitivePath = sensitiveToolPath(toolInput);
  if (sensitivePath && shouldBlockSensitiveTool(toolName)) {
    return evaluatePathReadRisk(sensitivePath);
  }

  return { decision: 'allow', reason: 'No HoldTheGoblin tool-call risk rule matched.' };
}

export function evaluatePathReadRisk(filePath: string): RiskResult {
  const normalized = toPosixPath(filePath);
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

export function isSensitivePath(filePath: string): boolean {
  return evaluatePathReadRisk(filePath).decision === 'deny';
}

export function hasMutationTool(toolName: string | undefined): boolean {
  return toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit';
}

function shouldBlockSensitiveTool(toolName: string | undefined): boolean {
  return toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob' || toolName === 'LS' || hasMutationTool(toolName);
}

function sensitiveToolPath(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  const values = [
    input.file_path,
    input.path,
    input.notebook_path,
    input.pattern,
    ...flattenStrings(input),
  ];
  for (const value of values) {
    if (typeof value === 'string' && isSensitivePath(value)) return value;
  }
  return undefined;
}

function flattenStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => flattenStrings(item));
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>).flatMap((item) => flattenStrings(item));
}

function hasBroadDestructiveRm(command: string): boolean {
  for (const segment of command.split(/&&|\|\||[;\n\r|]/)) {
    const tokens = shellWords(segment);
    for (let index = 0; index < tokens.length; index += 1) {
      const rmIndex = rmCommandIndex(tokens, index);
      if (rmIndex === undefined) continue;
      if (rmTargetsAreBroad(tokens.slice(rmIndex + 1))) return true;
      index = rmIndex;
    }
  }
  return false;
}

function rmCommandIndex(tokens: string[], index: number): number | undefined {
  if (isRmToken(tokens[index])) return index;
  if (tokens[index] === 'sudo' && isRmToken(tokens[index + 1])) return index + 1;
  return undefined;
}

function rmTargetsAreBroad(tokens: string[]): boolean {
  let recursive = false;
  let force = false;
  let optionsEnded = false;
  for (const token of tokens) {
    if (!optionsEnded && token === '--') {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && token.startsWith('-') && token !== '-') {
      recursive ||= token === '--recursive' || /^-[A-Za-z]*[rR][A-Za-z]*$/.test(token);
      force ||= token === '--force' || /^-[A-Za-z]*f[A-Za-z]*$/.test(token);
      continue;
    }
    if (recursive && force && isBroadRmTarget(token)) return true;
  }
  return false;
}

function isRmToken(token: string | undefined): boolean {
  if (!token) return false;
  return token.split('/').at(-1) === 'rm';
}

function isBroadRmTarget(token: string): boolean {
  return new Set(['/*', '/', '~/*', '~', '$HOME/*', '$HOME', '*', '.', './', './*', '../*']).has(token);
}

function hasLiteralCredentialArgument(command: string): boolean {
  return commandVariants(command).some((candidate) => inspectCredentialTokens(candidate, 0, new Set()));
}

function commandVariants(command: string): string[] {
  const variants = [command];
  let current = command;
  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      variants.push(decoded);
      current = decoded;
    } catch {
      break;
    }
  }
  return variants;
}

function inspectCredentialTokens(value: string, depth: number, seen: Set<string>): boolean {
  if (depth > 3 || seen.has(value)) return false;
  seen.add(value);

  if (hasCredentialFlagLiteral(value) || hasCredentialHeaderLiteral(value) || hasCredentialAssignmentLiteral(value)) return true;

  const tokens = shellWords(value);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const inline = token.match(/^--([A-Za-z][A-Za-z0-9_-]*(?:token|secret|password|authorization|api-key|apikey)[A-Za-z0-9_-]*)(?:=(.*))$/i);
    if (inline && !isSafeSecretReference(inline[2] ?? '')) return true;

    if (isCredentialFlag(token)) {
      const next = tokens[index + 1] ?? '';
      const valueToken = /^bearer$|^basic$/i.test(next) ? `${next} ${tokens[index + 2] ?? ''}` : next;
      if (!isSafeSecretReference(valueToken)) return true;
    }

    if (token.includes(' ') && inspectCredentialTokens(token, depth + 1, seen)) return true;
  }
  return false;
}

function isCredentialFlag(token: string): boolean {
  return /^--(?:api-?key|client-?secret|access-?token|refresh-?token|id-?token|auth(?:orization)?|token|secret|password)(?:[-_](?:key|value|header))?$/i.test(token);
}

function hasCredentialFlagLiteral(value: string): boolean {
  const flag = /(?:^|[\s"'(])--(?:api-?key|client-?secret|access-?token|refresh-?token|id-?token|auth(?:orization)?|token|secret|password)(?:[-_](?:key|value|header))?(?:=|\s+)(?:"([^"\n]*)"|'([^'\n]*)'|([^\s'"]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = flag.exec(value)) !== null) {
    const secret = match[1] ?? match[2] ?? match[3] ?? '';
    if (!isSafeSecretReference(secret)) return true;
  }
  return false;
}

function hasCredentialHeaderLiteral(value: string): boolean {
  const header = /\b(?:authorization|x-api-key|x-auth-token|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token)\b\s*:\s*(?:Bearer\s+|Basic\s+)?([^\s'"]{4,})/gi;
  let match: RegExpExecArray | null;
  while ((match = header.exec(value)) !== null) {
    if (!isSafeSecretReference(match[1])) return true;
  }
  return false;
}

function hasCredentialAssignmentLiteral(value: string): boolean {
  const assignment = /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|secret|token|password)\b\s*=\s*(['"]?)([^'"\s]{4,})\1/gi;
  let match: RegExpExecArray | null;
  while ((match = assignment.exec(value)) !== null) {
    if (!isSafeSecretReference(match[2])) return true;
  }
  return false;
}

function isSafeSecretReference(value: string): boolean {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed || /\[redacted/.test(trimmed)) return true;
  if (/^(?:Bearer|Basic)\s+\$[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) return true;
  if (/^(?:Bearer|Basic)\s+\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(trimmed)) return true;
  return /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) || /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(trimmed);
}

function shellWords(value: string): string[] {
  const words: string[] = [];
  const regex = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    words.push((match[1] ?? match[2] ?? match[3] ?? '').replace(/\\"/g, '"'));
  }
  return words;
}
