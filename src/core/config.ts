import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
  commands: {},
};

export function appPath(root: string, ...parts: string[]): string {
  return path.join(root, APP_DIR, ...parts);
}

export function ensureAppDirs(root: string): void {
  mkdirSync(appPath(root), { recursive: true });
  mkdirSync(appPath(root, 'runs'), { recursive: true });
  mkdirSync(appPath(root, 'checkpoints'), { recursive: true });
  mkdirSync(appPath(root, 'tmp'), { recursive: true });
}

export function configPath(root: string): string {
  return appPath(root, 'config.json');
}

export function loadConfig(root: string): HoldTheGoblinConfig {
  const file = configPath(root);
  if (!existsSync(file)) return DEFAULT_CONFIG;

  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<HoldTheGoblinConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    failPolicy: { ...DEFAULT_CONFIG.failPolicy, ...parsed.failPolicy },
    execution: { ...DEFAULT_CONFIG.execution, ...parsed.execution },
    security: { ...DEFAULT_CONFIG.security, ...parsed.security },
    observability: { ...DEFAULT_CONFIG.observability, ...parsed.observability },
    commands: { ...DEFAULT_CONFIG.commands, ...parsed.commands },
  };
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
