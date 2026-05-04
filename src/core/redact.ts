const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;

export function redactSensitiveText(value: string): string {
  return value
    .replace(PRIVATE_KEY_PATTERN, '[redacted private key]')
    .replace(/\bAuthorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Authorization: Bearer [redacted]')
    .replace(/\bBearer\s+eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, 'Bearer [redacted-jwt]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted-jwt]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, 'sk-[redacted]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g, 'gh_[redacted]')
    .replace(/\bglpat-[A-Za-z0-9_-]{16,}\b/g, 'glpat-[redacted]')
    .replace(/\bnpm_[A-Za-z0-9]{16,}\b/g, 'npm_[redacted]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA[redacted]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g, 'xox-[redacted]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^:/\s]+):([^@\s]+)@/gi, '$1[redacted]@')
    .replace(/\b((?:authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|token|password)\b\s*:\s*)[^\s'"]{12,}/gi, '$1[redacted]')
    .replace(/\b((?:api[_-]?key|secret|token|password)\b\s*[:=]\s*['"])[^'"\n]{12,}(['"])/gi, '$1[redacted]$2')
    .replace(/\b((?:api[_-]?key|secret|token|password)\b\s*[:=]\s*)[^\s'"]{12,}/gi, '$1[redacted]');
}

export function redactSensitiveData<T>(value: T): T {
  if (typeof value === 'string') return redactSensitiveText(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveData(item)) as T;
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      isSensitiveKey(key) && typeof item === 'string' ? '[redacted]' : redactSensitiveData(item),
    ])
  ) as T;
}

function isSensitiveKey(key: string): boolean {
  return /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|private[_-]?key)$/i.test(key);
}
