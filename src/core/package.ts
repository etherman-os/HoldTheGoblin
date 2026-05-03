import { readFileSync } from 'node:fs';

export function readPackageVersion(): string {
  for (const candidate of ['../../../package.json', '../../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(candidate, import.meta.url), 'utf8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // Try the next relative location. dist/src/core and src/core differ.
    }
  }
  return '0.0.0';
}
