import { redactSensitiveText } from './redact.js';

export function validateHttpEndpoint(value: string, label: string): string {
  const parsed = new URL(value);
  if (parsed.username || parsed.password) throw new Error(`${label} must not include URL credentials.`);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname))) {
    throw new Error(`${label} must use HTTPS unless targeting localhost.`);
  }

  const sensitivePart = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (containsEncodedCredentialMaterial(sensitivePart) || redactSensitiveText(sensitivePart) !== sensitivePart) {
    throw new Error(`${label} must not include credential-like path, query, or fragment values.`);
  }
  return parsed.toString();
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function containsEncodedCredentialMaterial(value: string): boolean {
  let current = value;
  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return false;
      if (redactSensitiveText(decoded) !== decoded) return true;
      current = decoded;
    } catch {
      return false;
    }
  }
  return false;
}
