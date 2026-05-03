import { appendFileSync, closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { appPath, ensureAppDirs } from './config.js';
import { redactSensitiveData } from './redact.js';
import type { GuardEvent } from './types.js';

export function appendEvent(root: string, event: Omit<GuardEvent, 'id' | 'timestamp' | 'root'>): GuardEvent {
  ensureAppDirs(root);
  const full: GuardEvent = {
    id: randomUUID().slice(0, 8),
    timestamp: new Date().toISOString(),
    root,
    ...event,
  };
  const safe = redactSensitiveData(full);
  const file = eventLogPath(root);
  appendFileSync(file, `${JSON.stringify(safe)}\n`);
  return safe;
}

export function readEvents(root: string, limit = 20): GuardEvent[] {
  const file = eventLogPath(root);
  if (!existsSync(file)) return [];
  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit === 0) return [];
  return readTail(file, Math.max(64 * 1024, safeLimit * 4096))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as GuardEvent;
      } catch {
        return undefined;
      }
    })
    .filter((event): event is GuardEvent => Boolean(event))
    .slice(-safeLimit);
}

export function eventLogPath(root: string): string {
  return appPath(root, 'events.jsonl');
}

function readTail(file: string, maxBytes: number): string {
  const stat = statSync(file);
  if (stat.size <= maxBytes) return readFileSync(file, 'utf8');

  const fd = openSync(file, 'r');
  try {
    const start = stat.size - maxBytes;
    const buffer = Buffer.allocUnsafe(maxBytes);
    readSync(fd, buffer, 0, maxBytes, start);
    const text = buffer.toString('utf8');
    const firstNewline = text.indexOf('\n');
    return firstNewline >= 0 ? text.slice(firstNewline + 1) : text;
  } finally {
    closeSync(fd);
  }
}
