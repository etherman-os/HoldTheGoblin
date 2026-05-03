import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { appPath, ensureAppDirs } from './config.js';
import type { GuardEvent } from './types.js';

export function appendEvent(root: string, event: Omit<GuardEvent, 'id' | 'timestamp' | 'root'>): GuardEvent {
  ensureAppDirs(root);
  const full: GuardEvent = {
    id: randomUUID().slice(0, 8),
    timestamp: new Date().toISOString(),
    root,
    ...event,
  };
  const file = eventLogPath(root);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  writeFileSync(file, `${current}${JSON.stringify(full)}\n`);
  return full;
}

export function readEvents(root: string, limit = 20): GuardEvent[] {
  const file = eventLogPath(root);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as GuardEvent)
    .slice(-limit);
}

export function eventLogPath(root: string): string {
  return appPath(root, 'events.jsonl');
}
