import { readFileSync } from 'node:fs';

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

type JsonSchema = {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  additionalProperties?: boolean;
};

export function validateHandoffFiles(schemaPath: string, inputPath: string): ValidationResult {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as JsonSchema;
  const input = JSON.parse(readFileSync(inputPath, 'utf8')) as unknown;
  return validateHandoff(schema, input);
}

export function validateHandoff(schema: JsonSchema, input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  validateNode(schema, input, '$', issues);
  return { ok: issues.length === 0, issues };
}

function validateNode(schema: JsonSchema, value: unknown, path: string, issues: ValidationIssue[]): void {
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
    issues.push({ path, message: `Expected one of ${JSON.stringify(schema.enum)}` });
  }

  if (schema.type && !matchesType(schema.type, value)) {
    issues.push({ path, message: `Expected type ${Array.isArray(schema.type) ? schema.type.join('|') : schema.type}` });
    return;
  }

  if (schema.type === 'object' || schema.properties) {
    if (!isRecord(value)) {
      issues.push({ path, message: 'Expected object' });
      return;
    }

    for (const required of schema.required ?? []) {
      if (!(required in value)) issues.push({ path: `${path}.${required}`, message: 'Required property missing' });
    }

    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) validateNode(childSchema, value[key], `${path}.${key}`, issues);
    }

    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) issues.push({ path: `${path}.${key}`, message: 'Additional property not allowed' });
      }
    }
  }

  if (schema.type === 'array' || schema.items) {
    if (!Array.isArray(value)) {
      issues.push({ path, message: 'Expected array' });
      return;
    }
    value.forEach((item, index) => validateNode(schema.items ?? {}, item, `${path}[${index}]`, issues));
  }
}

function matchesType(type: string | string[], value: unknown): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((item) => {
    if (item === 'array') return Array.isArray(value);
    if (item === 'null') return value === null;
    if (item === 'integer') return Number.isInteger(value);
    if (item === 'number') return typeof value === 'number';
    if (item === 'object') return isRecord(value);
    return typeof value === item;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
