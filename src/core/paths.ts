import path from 'node:path';

export function toPosixPath(value: string): string {
  return value.replace(/[\\/]+/g, '/');
}

export function relativePosix(root: string, file: string): string {
  return toPosixPath(path.relative(root, file));
}

export function resolveProjectPath(root: string, input: string): string {
  return path.isAbsolute(input) ? input : path.join(root, input);
}

export function resolveInsideProject(root: string, input: string): string {
  const resolved = path.resolve(root, input);
  if (isInsidePath(root, resolved)) return resolved;
  throw new Error(`Path escapes project root: ${input}`);
}

export function isInsidePath(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function assertSafeRelativePath(input: string): string {
  const normalized = toPosixPath(input);
  if (
    normalized === '' ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`Unsafe relative path: ${input}`);
  }
  return normalized;
}
