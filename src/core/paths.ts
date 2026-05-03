import path from 'node:path';

export function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

export function relativePosix(root: string, file: string): string {
  return toPosixPath(path.relative(root, file));
}

export function resolveProjectPath(root: string, input: string): string {
  return path.isAbsolute(input) ? input : path.join(root, input);
}
