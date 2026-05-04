const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const CREDENTIAL_KEY = String.raw`(?:authorization|x-api-key|x-auth-token|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|token|password|private[_-]?key)`;
const CREDENTIAL_FLAG = String.raw`--(?:api-?key|client-?secret|access-?token|refresh-?token|id-?token|auth(?:orization)?|token|secret|password)(?:[-_](?:key|value|header))?`;

export function redactSensitiveText(value: string): string {
  return redactCommandCredentialArgs(redactEncodedCredentialFragments(value)
    .replace(PRIVATE_KEY_PATTERN, '[redacted private key]')
    .replace(/\bAuthorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Authorization: Bearer [redacted]')
    .replace(/\bAuthorization:\s*Basic\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Authorization: Basic [redacted]')
    .replace(/\bBearer\s+eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, 'Bearer [redacted-jwt]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted-jwt]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, 'sk-[redacted]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g, 'gh_[redacted]')
    .replace(/\bglpat-[A-Za-z0-9_-]{16,}\b/g, 'glpat-[redacted]')
    .replace(/\bnpm_[A-Za-z0-9]{16,}\b/g, 'npm_[redacted]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA[redacted]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g, 'xox-[redacted]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^:/\s]+):([^@\s]+)@/gi, '$1[redacted]@')
    .replace(new RegExp(String.raw`\b(${CREDENTIAL_KEY}\b\s*:\s*)[^\s'"]{4,}`, 'gi'), '$1[redacted]')
    .replace(new RegExp(String.raw`\b(${CREDENTIAL_KEY}\b\s*[:=]\s*['"])[^'"\n]{4,}(['"])`, 'gi'), '$1[redacted]$2')
    .replace(new RegExp(String.raw`\b(${CREDENTIAL_KEY}\b\s*[:=]\s*)[^\s'"]{4,}`, 'gi'), '$1[redacted]'));
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

function redactCommandCredentialArgs(value: string): string {
  return value
    .replace(new RegExp(String.raw`(^|[\s"'(])(${CREDENTIAL_FLAG})(=)(?:"[^"\n]*"|'[^'\n]*'|[^\s'"]+)`, 'gi'), '$1$2$3[redacted]')
    .replace(new RegExp(String.raw`(^|[\s"'(])(${CREDENTIAL_FLAG})(\s+)(?:"[^"\n]*"|'[^'\n]*'|[^\s'"]+)`, 'gi'), '$1$2$3[redacted]')
    .replace(/(^|[\s"'(])((?:-u|--user|--proxy-user)(?:=|\s+))(?:"[^"\n]*"|'[^'\n]*'|[^\s'"]+)/gi, '$1$2[redacted]');
}

function redactEncodedCredentialFragments(value: string): string {
  return value.replace(/(?:[A-Za-z0-9._~:/?#[\]@!$&()*+,;=-]|%[0-9A-Fa-f]{2}){12,}/g, (fragment) => {
    const decoded = percentDecode(fragment);
    if (decoded === fragment) return fragment;
    return containsCredentialMaterial(decoded) ? '[redacted encoded credential]' : fragment;
  });
}

function percentDecode(value: string): string {
  let current = value;
  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return current;
      current = decoded;
    } catch {
      return current;
    }
  }
  return current;
}

function containsCredentialMaterial(value: string): boolean {
  return (
    new RegExp(String.raw`\b${CREDENTIAL_KEY}\b\s*[:=]\s*\S{4,}`, 'i').test(value) ||
    /\bAuthorization:\s*(?:Bearer|Basic)\s+\S{4,}/i.test(value) ||
    /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})\b/.test(value)
  );
}
