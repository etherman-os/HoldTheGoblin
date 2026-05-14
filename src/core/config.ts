import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { isInsidePath, relativePosix } from './paths.js';
import { redactSensitiveText } from './redact.js';
import { commandContainsLiteralCredential, evaluatePathReadRisk } from './risk.js';
import type { GuardMode, HoldTheGoblinConfig } from './types.js';

export const APP_DIR = '.holdthegoblin';

export const DEFAULT_CONFIG: HoldTheGoblinConfig = {
  version: 1,
  mode: 'balanced',
  failPolicy: {
    failOnMissingTests: false,
    failOnTestFailure: true,
    failOnSecrets: true,
    semgrepSeverities: ['ERROR'],
    trivySeverities: ['HIGH', 'CRITICAL'],
  },
  execution: {
    timeoutMs: 120_000,
    retries: 1,
    env: [],
  },
  security: {
    secretScan: true,
    semgrep: true,
    trivy: true,
  },
  observability: {
    exportCommands: true,
    exportFindings: true,
  },
  githubActions: {
    requirePinnedActions: false,
    allowedUnpinnedActions: [],
  },
  commands: {},
};

const guardModeSchema = z.enum(['relaxed', 'balanced', 'strict']);
const PROJECT_KINDS = ['javascript', 'python', 'go', 'rust', 'java', 'unknown'] as const;
const severitySchema = z.string().trim().min(1).regex(/^[A-Z]+$/i).transform((value) => value.toUpperCase());
const envKeySchema = z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const commandStringSchema = z.string().trim().min(1).refine((value) => !commandContainsLiteralCredential(value), {
  message: 'Command contains a literal credential; use environment references such as $TOKEN instead.',
});
const actionUsesSchema = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[A-Za-z0-9_./-]+$/);
const commandsSchema = z.record(z.string(), z.array(commandStringSchema).max(50)).superRefine((value, ctx) => {
  for (const key of Object.keys(value)) {
    if (!(PROJECT_KINDS as readonly string[]).includes(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `Unknown project kind. Supported: ${PROJECT_KINDS.join(', ')}.`,
      });
    }
  }
});

const partialConfigSchema = z.object({
  version: z.literal(1).optional(),
  mode: guardModeSchema.optional(),
  failPolicy: z.object({
    failOnMissingTests: z.boolean().optional(),
    failOnTestFailure: z.boolean().optional(),
    failOnSecrets: z.boolean().optional(),
    semgrepSeverities: z.array(severitySchema).max(20).optional(),
    trivySeverities: z.array(severitySchema).max(20).optional(),
  }).strict().optional(),
  execution: z.object({
    timeoutMs: z.number().int().min(1000).max(30 * 60 * 1000).optional(),
    retries: z.number().int().min(0).max(5).optional(),
    env: z.array(envKeySchema).max(100).optional(),
  }).strict().optional(),
  security: z.object({
    secretScan: z.boolean().optional(),
    semgrep: z.boolean().optional(),
    trivy: z.boolean().optional(),
  }).strict().optional(),
  observability: z.object({
    exportCommands: z.boolean().optional(),
    exportFindings: z.boolean().optional(),
  }).strict().optional(),
  githubActions: z.object({
    requirePinnedActions: z.boolean().optional(),
    allowedUnpinnedActions: z.array(actionUsesSchema).max(100).optional(),
  }).strict().optional(),
  commands: commandsSchema.optional(),
}).strict();

export type ConfigInput = z.output<typeof partialConfigSchema>;

export interface ConfigValidationIssue {
  path: string;
  message: string;
}

export interface ConfigValidationResult {
  ok: boolean;
  path?: string;
  issues: ConfigValidationIssue[];
}

export const CONFIG_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'HoldTheGoblin configuration',
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { const: 1 },
    mode: { enum: ['relaxed', 'balanced', 'strict'] },
    failPolicy: {
      type: 'object',
      additionalProperties: false,
      properties: {
        failOnMissingTests: { type: 'boolean' },
        failOnTestFailure: { type: 'boolean' },
        failOnSecrets: { type: 'boolean' },
        semgrepSeverities: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, pattern: '^[A-Za-z]+$', description: 'Severity names are normalized to uppercase.' } },
        trivySeverities: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, pattern: '^[A-Za-z]+$', description: 'Severity names are normalized to uppercase.' } },
      },
    },
    execution: {
      type: 'object',
      additionalProperties: false,
      properties: {
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 1800000 },
        retries: { type: 'integer', minimum: 0, maximum: 5 },
        env: {
          type: 'array',
          maxItems: 100,
          items: {
            type: 'string',
            minLength: 1,
            pattern: '^[A-Za-z_][A-Za-z0-9_]*$',
            description: 'Environment variable names to pass through to spawned verification and scanner commands. Values are read from the current process and are not stored in config.',
          },
        },
      },
    },
    security: {
      type: 'object',
      additionalProperties: false,
      properties: {
        secretScan: { type: 'boolean' },
        semgrep: { type: 'boolean' },
        trivy: { type: 'boolean' },
      },
    },
    observability: {
      type: 'object',
      additionalProperties: false,
      properties: {
        exportCommands: { type: 'boolean' },
        exportFindings: { type: 'boolean' },
      },
    },
    githubActions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        requirePinnedActions: { type: 'boolean', description: 'When true, unpinned external GitHub Actions refs fail verification unless allowlisted.' },
        allowedUnpinnedActions: {
          type: 'array',
          maxItems: 100,
          items: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            pattern: '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(/[A-Za-z0-9_./-]+)?@[A-Za-z0-9_./-]+$',
            description: 'Exact external uses: value that may remain unpinned, for example actions/checkout@v6.',
          },
        },
      },
    },
    commands: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        PROJECT_KINDS.map((kind) => [
          kind,
          { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, pattern: '\\S' } },
        ])
      ),
    },
  },
} as const;

export function appPath(root: string, ...parts: string[]): string {
  return path.join(root, APP_DIR, ...parts);
}

export function ensureAppDir(root: string, ...parts: string[]): string {
  const base = appPath(root);
  ensureRuntimeDir(root, base);
  const dir = appPath(root, ...parts);
  if (parts.length > 0) ensureRuntimeDir(root, dir);
  return dir;
}

export function ensureAppDirs(root: string): void {
  ensureAppDir(root);
  ensureAppDir(root, 'runs');
  ensureAppDir(root, 'checkpoints');
  ensureAppDir(root, 'tmp');
}

export function configPath(root: string): string {
  return appPath(root, 'config.json');
}

export function loadConfig(root: string): HoldTheGoblinConfig {
  const file = configPath(root);
  if (!existsSync(file)) return DEFAULT_CONFIG;

  const parsed = parseConfigFile(file, root);
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    failPolicy: { ...DEFAULT_CONFIG.failPolicy, ...parsed.failPolicy },
    execution: { ...DEFAULT_CONFIG.execution, ...parsed.execution },
    security: { ...DEFAULT_CONFIG.security, ...parsed.security },
    observability: { ...DEFAULT_CONFIG.observability, ...parsed.observability },
    githubActions: { ...DEFAULT_CONFIG.githubActions, ...parsed.githubActions },
    commands: { ...DEFAULT_CONFIG.commands, ...parsed.commands },
  };
}

export function validateProjectConfig(root: string): ConfigValidationResult {
  const file = configPath(root);
  if (!existsSync(file)) return { ok: true, path: file, issues: [] };
  return validateConfigFile(file, { root });
}

export function validateConfigFile(file: string, options: { root?: string } = {}): ConfigValidationResult {
  try {
    validateConfigObject(JSON.parse(readConfigText(file, options.root)));
    return { ok: true, path: file, issues: [] };
  } catch (error) {
    return {
      ok: false,
      path: file,
      issues: error instanceof ConfigValidationError ? error.issues : [{ path: '$', message: sanitizeIssueMessage(error instanceof Error ? error.message : String(error)) }],
    };
  }
}

export function validateConfigObject(input: unknown): ConfigInput {
  const result = partialConfigSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigValidationError(result.error.issues.map((issue) => ({
      path: formatIssuePath(issue.path),
      message: sanitizeIssueMessage(issue.message),
    })));
  }
  return result.data;
}

export function writeDefaultConfig(root: string, mode: GuardMode = 'balanced'): string {
  ensureAppDirs(root);
  const file = configPath(root);
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify({ ...DEFAULT_CONFIG, mode }, null, 2) + '\n');
  }
  return file;
}

export function modeFromArg(value: string | undefined): GuardMode {
  if (value === undefined) return 'balanced';
  if (value === 'relaxed' || value === 'balanced' || value === 'strict') return value;
  throw new Error(`Invalid mode "${value}". Supported: relaxed, balanced, strict.`);
}

function parseConfigFile(file: string, root?: string): ConfigInput {
  try {
    return validateConfigObject(JSON.parse(readConfigText(file, root)));
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      const details = error.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
      throw new Error(`Invalid HoldTheGoblin config at ${file}: ${details}`);
    }
    throw error;
  }
}

function readConfigText(file: string, root?: string): string {
  const resolved = path.resolve(file);
  if (root !== undefined && !isInsidePath(root, resolved)) {
    throw new Error(`Config path escapes project root: ${relativePosix(root, resolved)}`);
  }
  rejectSensitiveConfigPath(resolved, root);
  const real = realpathSync(resolved);
  if (root !== undefined && !isInsidePath(root, real)) {
    throw new Error(`Config path resolves outside project root: ${relativePosix(root, resolved)}`);
  }
  rejectSensitiveConfigPath(real, root);
  return readFileSync(real, 'utf8');
}

function rejectSensitiveConfigPath(file: string, root?: string): void {
  const candidates = root !== undefined && isInsidePath(root, file) ? [relativePosix(root, file), file] : [file];
  for (const candidate of candidates) {
    const risk = evaluatePathReadRisk(candidate);
    if (risk.decision === 'deny') throw new Error(risk.reason);
  }
}

function ensureRuntimeDir(root: string, dir: string): void {
  const realRoot = realpathSync(root);
  if (existsSync(dir)) assertRuntimeDirSafe(realRoot, dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  assertRuntimeDirSafe(realRoot, dir);
  setPrivateDirectoryPermissions(dir);
}

function assertRuntimeDirSafe(realRoot: string, dir: string): void {
  const stat = lstatSync(dir);
  if (stat.isSymbolicLink()) throw new Error(`HoldTheGoblin runtime directory must not be a symlink: ${dir}`);
  if (!stat.isDirectory()) throw new Error(`HoldTheGoblin runtime path must be a directory: ${dir}`);
  const realDir = realpathSync(dir);
  if (!isInsidePath(realRoot, realDir)) throw new Error(`HoldTheGoblin runtime directory resolves outside project root: ${dir}`);
}

function setPrivateDirectoryPermissions(dir: string): void {
  if (process.platform === 'win32') return;
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Best-effort permission hardening; symlink/root checks above remain blocking.
  }
}

const KNOWN_CONFIG_PATH_SEGMENTS = new Set([
  'version',
  'mode',
  'failPolicy',
  'failOnMissingTests',
  'failOnTestFailure',
  'failOnSecrets',
  'semgrepSeverities',
  'trivySeverities',
  'execution',
  'timeoutMs',
  'retries',
  'env',
  'security',
  'secretScan',
  'semgrep',
  'trivy',
  'observability',
  'exportCommands',
  'exportFindings',
  'githubActions',
  'requirePinnedActions',
  'allowedUnpinnedActions',
  'commands',
  ...PROJECT_KINDS,
]);

function formatIssuePath(segments: readonly (string | number | symbol)[]): string {
  if (segments.length === 0) return '$';
  let formatted = '$';
  for (const segment of segments) {
    if (typeof segment === 'number') {
      formatted += `[${segment}]`;
    } else if (typeof segment === 'string' && KNOWN_CONFIG_PATH_SEGMENTS.has(segment)) {
      formatted += `.${segment}`;
    } else {
      formatted += '.<key>';
    }
  }
  return formatted;
}

function sanitizeIssueMessage(value: string): string {
  const sanitized = redactSensitiveText(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized.length <= 500 ? sanitized : `${sanitized.slice(0, 500)}...`;
}

class ConfigValidationError extends Error {
  constructor(readonly issues: ConfigValidationIssue[]) {
    super('Invalid HoldTheGoblin config.');
  }
}
