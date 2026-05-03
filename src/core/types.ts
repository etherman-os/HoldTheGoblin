export type GuardMode = 'relaxed' | 'balanced' | 'strict';
export type AgentKind = 'claude' | 'cursor' | 'codex' | 'warp' | 'all';

export interface HoldTheGoblinConfig {
  version: 1;
  mode: GuardMode;
  failPolicy: {
    failOnMissingTests: boolean;
    failOnTestFailure: boolean;
    failOnSecrets: boolean;
    semgrepSeverities: string[];
    trivySeverities: string[];
  };
  execution: {
    timeoutMs: number;
    retries: number;
  };
  security: {
    secretScan: boolean;
    semgrep: boolean;
    trivy: boolean;
  };
  observability: {
    exportCommands: boolean;
    exportFindings: boolean;
  };
  commands: Partial<Record<ProjectKind, string[]>>;
}

export type ProjectKind = 'javascript' | 'python' | 'go' | 'rust' | 'java' | 'unknown';

export interface ProjectDetection {
  root: string;
  kinds: ProjectKind[];
  testCommands: PlannedCommand[];
  securityCommands: PlannedCommand[];
  warnings: string[];
}

export interface PlannedCommand {
  id: string;
  label: string;
  command: string;
  kind: ProjectKind | 'security' | 'doctor' | 'deploy' | 'testgen' | 'observability';
  required: boolean;
  reason: string;
}

export interface CommandResult {
  id: string;
  label: string;
  command: string;
  skipped: boolean;
  skipReason?: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  attempts: number;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  message: string;
  evidence?: unknown;
}

export interface Finding {
  scanner: 'secret' | 'semgrep' | 'trivy';
  severity: string;
  message: string;
  file?: string;
  line?: number;
  ruleId?: string;
}

export interface EdgeCaseSuggestion {
  file: string;
  line: number;
  category: 'auth' | 'database' | 'env' | 'filesystem' | 'network' | 'date' | 'payment' | 'deploy';
  message: string;
  suggestedTest: string;
}

export interface VerifyResult {
  ok: boolean;
  mode: GuardMode;
  root: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  changedFiles: string[];
  detections: ProjectDetection;
  commandResults: CommandResult[];
  checks: CheckResult[];
  findings: Finding[];
  edgeCases: EdgeCaseSuggestion[];
  reportPath?: string;
}

export interface GuardEvent {
  id: string;
  type: 'init' | 'verify' | 'hook' | 'checkpoint' | 'handoff' | 'deploy' | 'observability' | 'testgen' | 'mcp';
  timestamp: string;
  root: string;
  ok?: boolean;
  summary: string;
  data?: unknown;
}

export interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  permission_mode?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  tool_calls?: Array<{
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    tool_response?: unknown;
    tool_use_id?: string;
  }>;
  stop_hook_active?: boolean;
  last_assistant_message?: string;
}
