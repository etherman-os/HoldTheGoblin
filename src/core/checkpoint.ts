import { randomUUID } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appPath, ensureAppDirs } from './config.js';
import { assertSafeRelativePath, isInsidePath, relativePosix, toPosixPath } from './paths.js';
import { isSensitivePath } from './risk.js';
import { runShell } from './runner.js';
import type { PlannedCommand } from './types.js';

export interface CheckpointMeta {
  id: string;
  root: string;
  createdAt: string;
  files: string[];
  note?: string;
}

const EXCLUDE = new Set(['.git', '.holdthegoblin', 'node_modules', 'dist', 'build', 'coverage', '.next', 'target']);
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MAX_CHECKPOINT_FILES = 5000;
const MAX_CHECKPOINT_BYTES = 200 * 1024 * 1024;
const MAX_RETAINED_CHECKPOINTS = 20;

export async function createCheckpoint(root: string, note?: string): Promise<CheckpointMeta> {
  ensureAppDirs(root);
  const id = checkpointId();
  const dir = appPath(root, 'checkpoints', id);
  const stagingDir = appPath(root, 'checkpoints', `${id}.tmp-${process.pid}`);
  if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
  if (existsSync(dir)) throw new Error(`Checkpoint already exists: ${id}`);
  const filesDir = path.join(stagingDir, 'files');
  mkdirSync(filesDir, { recursive: true });

  try {
    const files = await listCandidateFiles(root);
    if (files.length > MAX_CHECKPOINT_FILES) {
      throw new Error(`Cannot create checkpoint: ${files.length} files exceeds the limit of ${MAX_CHECKPOINT_FILES}.`);
    }

    let totalBytes = 0;
    for (const file of files) {
      const source = path.join(root, file);
      totalBytes += statSync(source).size;
      if (totalBytes > MAX_CHECKPOINT_BYTES) {
        throw new Error(`Cannot create checkpoint: snapshot exceeds ${Math.round(MAX_CHECKPOINT_BYTES / 1024 / 1024)} MiB.`);
      }
      const target = path.join(filesDir, file);
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(source, target);
    }

    const meta: CheckpointMeta = { id, root, createdAt: new Date().toISOString(), files, note };
    writeFileSync(path.join(stagingDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
    renameSync(stagingDir, dir);
    pruneOldCheckpoints(root);
    return meta;
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

function checkpointId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

export function listCheckpoints(root: string): CheckpointMeta[] {
  const dir = appPath(root, 'checkpoints');
  if (!existsSync(dir)) return [];
  assertCheckpointRuntimeDir(root, dir);
  return readdirSync(dir)
    .map((entry) => checkpointMetaPath(root, path.join(dir, entry)))
    .filter((file): file is string => Boolean(file))
    .map((file) => JSON.parse(readFileSync(file, 'utf8')) as CheckpointMeta)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function rollbackCheckpoint(root: string, id?: string, deleteNew = false): CheckpointMeta {
  const checkpoint = resolveCheckpoint(root, id);
  const dir = appPath(root, 'checkpoints', checkpoint.id, 'files');
  for (const file of checkpoint.files) {
    const safeFile = assertSafeRelativePath(file);
    const source = path.join(dir, safeFile);
    const target = path.join(root, safeFile);
    if (!isInsidePath(dir, source) || !isInsidePath(root, target)) throw new Error(`Unsafe checkpoint path: ${file}`);
    if (!existsSync(source)) continue;
    assertCheckpointSourceFile(dir, source, file);
    prepareRollbackTarget(root, target, file);
    copyFileSync(source, target);
  }

  if (deleteNew) {
    const checkpointFiles = new Set(checkpoint.files.map((file) => toPosixPath(file)));
    for (const file of walkFiles(root)) {
      const rel = relativePosix(root, file);
      if (!checkpointFiles.has(rel) && !isSensitivePath(rel)) rmSync(file, { force: true });
    }
  }

  return checkpoint;
}

function resolveCheckpoint(root: string, id?: string): CheckpointMeta {
  const checkpoints = listCheckpoints(root);
  if (checkpoints.length === 0) throw new Error('No checkpoints found.');
  if (!id || id === 'latest') return checkpoints[checkpoints.length - 1];
  const match = checkpoints.find((checkpoint) => checkpoint.id === id);
  if (!match) throw new Error(`Checkpoint not found: ${id}`);
  return match;
}

async function listCandidateFiles(root: string): Promise<string[]> {
  const gitFiles = await listGitFiles(root);
  if (gitFiles.length > 0) return gitFiles.map(toPosixPath).filter((file) => canSnapshot(path.join(root, file), file));
  return [...walkFiles(root)]
    .map((file) => relativePosix(root, file))
    .filter((file) => canSnapshot(path.join(root, file), file));
}

async function listGitFiles(root: string): Promise<string[]> {
  const command: PlannedCommand = {
    id: 'git:list-files',
    label: 'List git files',
    command: 'git ls-files --cached --others --exclude-standard',
    kind: 'doctor',
    required: false,
    reason: 'Checkpoint candidate files',
  };
  const result = await runShell(command, { cwd: root, timeoutMs: 10_000, retries: 0 });
  if (result.exitCode !== 0) return [];
  if (result.stdoutTruncated) throw new Error('Cannot create checkpoint: git file list exceeded the in-memory limit and was truncated.');
  return result.stdout.split(/\r?\n/).map((line) => toPosixPath(line.trim())).filter(Boolean);
}

function* walkFiles(root: string): Generator<string> {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    if (entry.isFile()) yield full;
  }
}

function canSnapshot(file: string, relativeFile = toPosixPath(file)): boolean {
  if (!existsSync(file)) return false;
  if (lstatSync(file).isSymbolicLink()) return false;
  if (isSensitivePath(relativeFile)) return false;
  const parts = toPosixPath(file).split('/');
  if (parts.some((part) => EXCLUDE.has(part))) return false;
  const stat = statSync(file);
  return stat.isFile() && stat.size <= MAX_FILE_SIZE;
}

function pruneOldCheckpoints(root: string): void {
  const checkpoints = listCheckpoints(root);
  const stale = checkpoints.slice(0, Math.max(0, checkpoints.length - MAX_RETAINED_CHECKPOINTS));
  for (const checkpoint of stale) {
    rmSync(appPath(root, 'checkpoints', checkpoint.id), { recursive: true, force: true });
  }
}

function assertCheckpointRuntimeDir(root: string, dir: string): void {
  const stat = lstatSync(dir);
  if (stat.isSymbolicLink()) throw new Error(`HoldTheGoblin checkpoint directory must not be a symlink: ${dir}`);
  if (!stat.isDirectory()) throw new Error(`HoldTheGoblin checkpoint path must be a directory: ${dir}`);
  const realRoot = realpathSync(root);
  const realDir = realpathSync(dir);
  if (!isInsidePath(realRoot, realDir)) throw new Error(`HoldTheGoblin checkpoint directory resolves outside project root: ${dir}`);
}

function checkpointMetaPath(root: string, dir: string): string | undefined {
  const stat = lstatSync(dir);
  if (stat.isSymbolicLink()) throw new Error(`HoldTheGoblin checkpoint directory must not be a symlink: ${dir}`);
  if (!stat.isDirectory()) return undefined;
  const realRoot = realpathSync(root);
  const realDir = realpathSync(dir);
  if (!isInsidePath(realRoot, realDir)) throw new Error(`HoldTheGoblin checkpoint directory resolves outside project root: ${dir}`);

  const file = path.join(dir, 'meta.json');
  if (!existsSync(file)) return undefined;
  const fileStat = lstatSync(file);
  if (fileStat.isSymbolicLink()) throw new Error(`HoldTheGoblin checkpoint metadata must not be a symlink: ${file}`);
  if (!fileStat.isFile()) throw new Error(`HoldTheGoblin checkpoint metadata path must be a file: ${file}`);
  const realFile = realpathSync(file);
  if (!isInsidePath(realDir, realFile)) throw new Error(`HoldTheGoblin checkpoint metadata resolves outside checkpoint directory: ${file}`);
  return realFile;
}

function assertCheckpointSourceFile(checkpointFilesDir: string, source: string, file: string): void {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`HoldTheGoblin checkpoint source file must not be a symlink: ${file}`);
  if (!stat.isFile()) throw new Error(`HoldTheGoblin checkpoint source path must be a file: ${file}`);
  const realFilesDir = realpathSync(checkpointFilesDir);
  const realSource = realpathSync(source);
  if (!isInsidePath(realFilesDir, realSource)) throw new Error(`HoldTheGoblin checkpoint source resolves outside checkpoint directory: ${file}`);
}

function prepareRollbackTarget(root: string, target: string, file: string): void {
  const parent = path.dirname(target);
  assertRollbackTargetAncestorsSafe(root, parent, file);
  mkdirSync(parent, { recursive: true });
  const realRoot = realpathSync(root);
  const realParent = realpathSync(parent);
  if (!isInsidePath(realRoot, realParent)) throw new Error(`HoldTheGoblin checkpoint target directory resolves outside project root: ${file}`);

  if (!existsSync(target)) return;
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) {
    rmSync(target, { force: true });
    return;
  }
  if (!stat.isFile()) throw new Error(`HoldTheGoblin checkpoint target path must be a file: ${file}`);
}

function assertRollbackTargetAncestorsSafe(root: string, parent: string, file: string): void {
  const relative = path.relative(root, parent);
  if (relative === '') return;
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Unsafe checkpoint target path: ${file}`);

  const realRoot = realpathSync(root);
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!existsSync(current)) return;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`HoldTheGoblin checkpoint target directory must not contain symlinks: ${file}`);
    if (!stat.isDirectory()) throw new Error(`HoldTheGoblin checkpoint target parent must be a directory: ${file}`);
    if (!isInsidePath(realRoot, realpathSync(current))) throw new Error(`HoldTheGoblin checkpoint target directory resolves outside project root: ${file}`);
  }
}
