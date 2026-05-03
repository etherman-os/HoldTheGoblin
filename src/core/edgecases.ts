import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { EdgeCaseSuggestion } from './types.js';

const EXCLUDED_DIRS = new Set(['.git', '.holdthegoblin', 'node_modules', 'dist', 'build', 'coverage', '.next', 'target']);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.rs', '.java']);

const RULES: Array<{
  category: EdgeCaseSuggestion['category'];
  pattern: RegExp;
  message: string;
  suggestedTest: string;
}> = [
  {
    category: 'auth',
    pattern: /\b(?:jwt|token|session|authorization|auth)\b/i,
    message: 'Auth/session logic changed or exists near this line.',
    suggestedTest: 'Add tests for missing credentials, expired credentials, malformed credentials, and insufficient role/permission.',
  },
  {
    category: 'database',
    pattern: /\b(?:prisma|sequelize|typeorm|mongoose|sql|query|transaction|deleteMany|updateMany|DROP|TRUNCATE)\b/,
    message: 'Database mutation/query logic detected.',
    suggestedTest: 'Add tests for empty result, not-found row, duplicate writes, transaction rollback, and unauthorized mutation.',
  },
  {
    category: 'env',
    pattern: /\bprocess\.env\b|\bos\.environ\b|\benv::var\b/,
    message: 'Environment-dependent behavior detected.',
    suggestedTest: 'Add tests for missing env var, invalid env var, and safe default behavior.',
  },
  {
    category: 'filesystem',
    pattern: /\b(?:readFile|writeFile|unlink|rmSync|cpSync|mkdir|openSync|fs\.|Path\(|File\()\b/,
    message: 'Filesystem behavior detected.',
    suggestedTest: 'Add tests for missing file, permission error, path traversal input, and existing target overwrite.',
  },
  {
    category: 'network',
    pattern: /\b(?:fetch|axios|http\.|https\.|requests\.|urllib|grpc|WebSocket)\b/,
    message: 'Network call detected.',
    suggestedTest: 'Add tests for timeout, non-2xx response, malformed response body, and retry exhaustion.',
  },
  {
    category: 'date',
    pattern: /\b(?:Date\.|new Date|datetime|time\.Now|chrono|Instant|LocalDate)\b/,
    message: 'Time/date behavior detected.',
    suggestedTest: 'Add tests for timezone boundaries, invalid dates, clock skew, and daylight-saving transitions.',
  },
  {
    category: 'payment',
    pattern: /\b(?:stripe|payment|invoice|refund|checkout|subscription|billing)\b/i,
    message: 'Payment/billing behavior detected.',
    suggestedTest: 'Add tests for duplicate webhook delivery, failed payment, refund edge cases, and idempotency.',
  },
  {
    category: 'deploy',
    pattern: /\b(?:docker|kubernetes|kubectl|terraform|flyctl|railway|vercel|netlify|coolify)\b/i,
    message: 'Deploy/infrastructure behavior detected.',
    suggestedTest: 'Add tests or dry-runs for missing secret, failed healthcheck, rollback path, and config drift.',
  },
];

export function findEdgeCases(root: string, changedFiles: string[]): EdgeCaseSuggestion[] {
  const candidates = changedFiles.length > 0 ? changedFiles : listSourceFiles(root);
  const suggestions: EdgeCaseSuggestion[] = [];
  const seen = new Set<string>();

  for (const rel of candidates) {
    if (!SOURCE_EXTENSIONS.has(path.extname(rel))) continue;
    const file = path.join(root, rel);
    if (!existsSync(file)) continue;
    let content = '';
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    content.split(/\r?\n/).forEach((line, index) => {
      for (const rule of RULES) {
        if (!rule.pattern.test(line)) continue;
        const key = `${rel}:${rule.category}`;
        if (seen.has(key)) continue;
        seen.add(key);
        suggestions.push({
          file: rel,
          line: index + 1,
          category: rule.category,
          message: rule.message,
          suggestedTest: rule.suggestedTest,
        });
      }
    });
  }

  return suggestions.slice(0, 30);
}

function listSourceFiles(root: string): string[] {
  const files: string[] = [];
  walk(root, files, root);
  return files;
}

function walk(root: string, files: string[], base: string): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walk(full, files, base);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    const stat = statSync(full);
    if (stat.size > 512 * 1024) continue;
    files.push(path.relative(base, full));
  }
}
