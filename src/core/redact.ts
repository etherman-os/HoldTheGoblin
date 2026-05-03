const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g;

export function redactSensitiveText(value: string): string {
  return value
    .replace(PRIVATE_KEY_PATTERN, '[redacted private key]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, 'sk-[redacted]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g, 'gh_[redacted]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA[redacted]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g, 'xox-[redacted]')
    .replace(/\b((?:api[_-]?key|secret|token|password)\b\s*[:=]\s*['"])[^'"\n]{12,}(['"])/gi, '$1[redacted]$2')
    .replace(/\b((?:api[_-]?key|secret|token|password)\b\s*[:=]\s*)[^\s'"]{12,}/gi, '$1[redacted]');
}

export function redactSensitiveData<T>(value: T): T {
  if (typeof value === 'string') return redactSensitiveText(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveData(item)) as T;
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactSensitiveData(item)])
  ) as T;
}
