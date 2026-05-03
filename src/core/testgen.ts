import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appPath, ensureAppDirs } from './config.js';
import { appendEvent } from './events.js';
import { findEdgeCases } from './edgecases.js';
import { getChangedFiles } from './git.js';
import { generateText, type ModelProvider } from './llm.js';
import type { EdgeCaseSuggestion } from './types.js';

export type TestGenerationProvider = 'deterministic' | ModelProvider;

export interface TestGenerationResult {
  ok: boolean;
  provider: TestGenerationProvider;
  model?: string;
  outputPath: string;
  suggestions: EdgeCaseSuggestion[];
  content: string;
  error?: string;
}

export async function generateTests(options: {
  root: string;
  provider?: TestGenerationProvider;
  model?: string;
  baseUrl?: string;
  output?: string;
  timeoutMs?: number;
}): Promise<TestGenerationResult> {
  const provider = options.provider ?? 'deterministic';
  const changedFiles = await getChangedFiles(options.root);
  const suggestions = findEdgeCases(options.root, changedFiles);
  const outputPath = options.output
    ? path.resolve(options.output)
    : appPath(options.root, 'generated-tests.md');
  mkdirSync(path.dirname(outputPath), { recursive: true });

  let content = renderDeterministicTestPlan(suggestions);
  let ok = true;
  let error: string | undefined;

  if (provider !== 'deterministic') {
    const generated = await generateWithProvider(suggestions, {
      provider,
      model: options.model,
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs ?? readModelTimeoutMs(),
    });
    ok = generated.ok;
    error = generated.error;
    if (generated.content) content = generated.content;
  }

  ensureAppDirs(options.root);
  writeFileSync(outputPath, content.endsWith('\n') ? content : `${content}\n`);
  const result: TestGenerationResult = {
    ok,
    provider,
    model: provider !== 'deterministic' ? options.model ?? providerModelFromEnv(provider) : undefined,
    outputPath,
    suggestions,
    content,
    error,
  };
  appendEvent(options.root, {
    type: 'testgen',
    ok,
    summary: `Generated ${provider} test plan with ${suggestions.length} suggestion(s).`,
    data: {
      outputPath,
      provider,
      model: result.model,
      error,
    },
  });
  return result;
}

export function renderDeterministicTestPlan(suggestions: EdgeCaseSuggestion[]): string {
  const lines = ['# HoldTheGoblin Generated Test Plan', ''];
  if (suggestions.length === 0) {
    lines.push('No risky changed code paths were detected. Keep the normal project test suite as the completion gate.');
    return lines.join('\n');
  }
  suggestions.forEach((suggestion, index) => {
    lines.push(`## ${index + 1}. ${suggestion.category}: ${suggestion.file}:${suggestion.line}`);
    lines.push('');
    lines.push(suggestion.message);
    lines.push('');
    lines.push('Suggested test:');
    lines.push('');
    lines.push('```text');
    lines.push(suggestion.suggestedTest);
    lines.push('```');
    lines.push('');
  });
  return lines.join('\n');
}

async function generateWithProvider(
  suggestions: EdgeCaseSuggestion[],
  options: { provider: ModelProvider; model?: string; baseUrl?: string; timeoutMs: number }
): Promise<{ ok: boolean; content?: string; error?: string }> {
  if (suggestions.length === 0) return { ok: true, content: renderDeterministicTestPlan(suggestions) };
  const result = await generateText({
    provider: options.provider,
    model: options.model,
    baseUrl: options.baseUrl,
    timeoutMs: options.timeoutMs,
    prompt: [
      'You are generating concrete test cases for a software project.',
      'Return markdown only. Do not invent passed results.',
      'For each item, propose a focused test name, setup, action, expected assertion, and likely file to edit.',
      JSON.stringify(suggestions, null, 2),
    ].join('\n\n'),
  });
  if (!result.ok) {
    return {
      ok: false,
      content: renderDeterministicTestPlan(suggestions),
      error: result.error,
    };
  }
  return { ok: true, content: result.text?.trim() || renderDeterministicTestPlan(suggestions) };
}

function readModelTimeoutMs(): number {
  const value = Number(process.env.HOLDTHEGOBLIN_MODEL_TIMEOUT_MS ?? process.env.HOLDTHEGOBLIN_OLLAMA_TIMEOUT_MS ?? '60000');
  return Number.isFinite(value) && value > 0 ? value : 60000;
}

function providerModelFromEnv(provider: ModelProvider): string | undefined {
  switch (provider) {
    case 'ollama':
      return process.env.OLLAMA_MODEL ?? 'llama3.1';
    case 'ollama-cloud':
      return process.env.OLLAMA_CLOUD_MODEL ?? process.env.OLLAMA_MODEL;
    case 'openai-compatible':
      return process.env.OPENAI_COMPATIBLE_MODEL;
    case 'openai':
      return process.env.OPENAI_MODEL;
    case 'groq':
      return process.env.GROQ_MODEL;
    case 'openrouter':
      return process.env.OPENROUTER_MODEL;
    case 'anthropic':
      return process.env.ANTHROPIC_MODEL;
    case 'minimax':
      return process.env.MINIMAX_MODEL ?? 'MiniMax-M2.7';
    case 'zai':
      return process.env.ZAI_MODEL ?? process.env.GLM_MODEL ?? 'glm-5.1';
    case 'kimi':
      return process.env.KIMI_MODEL ?? process.env.MOONSHOT_MODEL ?? 'kimi-k2.6';
    case 'deepseek':
      return process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';
  }
}
