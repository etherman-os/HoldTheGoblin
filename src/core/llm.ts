import { redactSensitiveText } from './redact.js';

export type ModelProvider =
  | 'ollama'
  | 'ollama-cloud'
  | 'openai-compatible'
  | 'openai'
  | 'groq'
  | 'openrouter'
  | 'anthropic'
  | 'minimax'
  | 'zai'
  | 'kimi'
  | 'deepseek';

export interface ModelProviderInfo {
  id: ModelProvider;
  label: string;
  env: string[];
  defaultModel?: string;
  modelExamples?: string[];
  defaultBaseUrl?: string;
  notes: string;
}

export interface GenerateTextOptions {
  provider: ModelProvider;
  prompt: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export function listModelProviders(): ModelProviderInfo[] {
  return [
    {
      id: 'ollama',
      label: 'Ollama local or signed-in cloud models',
      env: ['OLLAMA_BASE_URL', 'OLLAMA_MODEL'],
      defaultModel: 'llama3.1',
      modelExamples: ['llama3.1', 'glm-5.1:cloud', 'kimi-k2.6:cloud'],
      defaultBaseUrl: 'http://localhost:11434',
      notes: 'Use local models or signed-in :cloud models through the local Ollama daemon, for example glm-5.1:cloud.',
    },
    {
      id: 'ollama-cloud',
      label: 'Ollama Cloud direct API',
      env: ['OLLAMA_API_KEY', 'OLLAMA_CLOUD_MODEL', 'OLLAMA_CLOUD_BASE_URL'],
      modelExamples: ['gpt-oss:120b'],
      defaultBaseUrl: 'https://ollama.com',
      notes: 'Calls ollama.com directly with OLLAMA_API_KEY. Use direct cloud model names such as gpt-oss:120b.',
    },
    {
      id: 'openai-compatible',
      label: 'Any OpenAI-compatible endpoint',
      env: ['OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_API_KEY', 'OPENAI_COMPATIBLE_MODEL'],
      modelExamples: ['local-model', 'provider/model-name'],
      notes: 'Works with OpenAI-compatible gateways, local servers, OpenRouter-like routers, LM Studio, vLLM, and similar endpoints.',
    },
    {
      id: 'openai',
      label: 'OpenAI API',
      env: ['OPENAI_API_KEY', 'OPENAI_MODEL'],
      modelExamples: ['gpt-4o', 'gpt-4.1'],
      defaultBaseUrl: 'https://api.openai.com/v1',
      notes: 'Uses /chat/completions. Model must be passed with --model or OPENAI_MODEL.',
    },
    {
      id: 'groq',
      label: 'Groq API',
      env: ['GROQ_API_KEY', 'GROQ_MODEL'],
      modelExamples: ['openai/gpt-oss-20b'],
      defaultBaseUrl: 'https://api.groq.com/openai/v1',
      notes: 'Uses Groq OpenAI-compatible chat completions.',
    },
    {
      id: 'openrouter',
      label: 'OpenRouter API',
      env: ['OPENROUTER_API_KEY', 'OPENROUTER_MODEL'],
      modelExamples: ['openrouter/auto', 'moonshotai/kimi-k2.6', 'z-ai/glm-5.1', 'minimax/minimax-m2.7'],
      defaultBaseUrl: 'https://openrouter.ai/api/v1',
      notes: 'Uses OpenRouter OpenAI-compatible chat completions.',
    },
    {
      id: 'anthropic',
      label: 'Anthropic Messages API',
      env: ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'],
      modelExamples: ['claude-sonnet-4-6-20250514'],
      defaultBaseUrl: 'https://api.anthropic.com',
      notes: 'Uses /v1/messages. Model must be passed with --model or ANTHROPIC_MODEL.',
    },
    {
      id: 'minimax',
      label: 'MiniMax native subscription',
      env: ['MINIMAX_API_KEY', 'MINIMAX_MODEL', 'MINIMAX_BASE_URL', 'MINIMAX_GROUP_ID'],
      defaultModel: 'MiniMax-M2.7',
      modelExamples: ['MiniMax-M2.7', 'MiniMax-M2.5', 'MiniMax-M2.1'],
      defaultBaseUrl: 'https://api.minimaxi.com/v1',
      notes: 'Uses MiniMax OpenAI-compatible chat completions. Set MINIMAX_BASE_URL for regional or legacy endpoints such as https://api.minimax.io/v1.',
    },
    {
      id: 'zai',
      label: 'z.ai / GLM native subscription',
      env: ['ZAI_API_KEY or GLM_API_KEY', 'ZAI_MODEL or GLM_MODEL', 'ZAI_BASE_URL or GLM_BASE_URL'],
      defaultModel: 'glm-5.1',
      modelExamples: ['glm-5.1', 'glm-5-turbo', 'glm-4.5', 'glm-4.5-air'],
      defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
      notes: 'Uses the z.ai chat completion endpoint directly, so GLM subscriptions do not have to route through OpenRouter.',
    },
    {
      id: 'kimi',
      label: 'Kimi / Moonshot native subscription',
      env: ['KIMI_API_KEY or MOONSHOT_API_KEY', 'KIMI_MODEL or MOONSHOT_MODEL', 'KIMI_BASE_URL or MOONSHOT_BASE_URL'],
      defaultModel: 'kimi-k2.6',
      modelExamples: ['kimi-k2.6', 'kimi-k2.5', 'moonshot-v1-8k', 'moonshot-v1-128k'],
      defaultBaseUrl: 'https://api.moonshot.ai/v1',
      notes: 'Uses Kimi OpenAI-compatible chat completions directly with user-supplied Kimi or Moonshot API keys.',
    },
    {
      id: 'deepseek',
      label: 'DeepSeek native subscription',
      env: ['DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL', 'DEEPSEEK_BASE_URL'],
      defaultModel: 'deepseek-v4-flash',
      modelExamples: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
      defaultBaseUrl: 'https://api.deepseek.com',
      notes: 'Uses DeepSeek OpenAI-compatible chat completions. deepseek-chat and deepseek-reasoner remain accepted as compatibility model names.',
    },
  ];
}

export async function generateText(options: GenerateTextOptions): Promise<{ ok: boolean; text?: string; error?: string }> {
  const timeoutMs = options.timeoutMs ?? readModelTimeoutMs();
  try {
    if (options.provider === 'ollama') return await generateOllama(options, false, timeoutMs);
    if (options.provider === 'ollama-cloud') return await generateOllama(options, true, timeoutMs);
    if (options.provider === 'anthropic') return await generateAnthropic(options, timeoutMs);
    return await generateOpenAiCompatible(options, timeoutMs);
  } catch (error) {
    return { ok: false, error: redactSensitiveText(error instanceof Error ? error.message : String(error)) };
  }
}

function resolveModel(provider: ModelProvider, explicit?: string): string {
  const model = explicit
    ?? env(`${provider.toUpperCase().replace(/-/g, '_')}_MODEL`)
    ?? providerDefaultModelEnv(provider);
  if (!model) throw new Error(`Model is required for provider ${provider}. Pass --model or set the provider model environment variable.`);
  return model;
}

function providerDefaultModelEnv(provider: ModelProvider): string | undefined {
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

async function generateOllama(options: GenerateTextOptions, directCloud: boolean, timeoutMs: number): Promise<{ ok: boolean; text?: string; error?: string }> {
  const model = resolveModel(options.provider, options.model);
  const baseUrl = (options.baseUrl
    ?? (directCloud ? process.env.OLLAMA_CLOUD_BASE_URL : process.env.OLLAMA_BASE_URL)
    ?? (directCloud ? 'https://ollama.com' : 'http://localhost:11434')).replace(/\/$/, '');
  const apiKey = options.apiKey ?? process.env.OLLAMA_API_KEY;
  if (directCloud && !apiKey) throw new Error('OLLAMA_API_KEY is required for provider ollama-cloud.');
  const response = await fetchWithTimeout(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      stream: false,
      prompt: options.prompt,
    }),
  }, timeoutMs);
  if (!response.ok) return { ok: false, error: `Ollama returned HTTP ${response.status}.` };
  const parsed = await response.json() as { response?: string };
  return { ok: true, text: parsed.response?.trim() };
}

async function generateOpenAiCompatible(options: GenerateTextOptions, timeoutMs: number): Promise<{ ok: boolean; text?: string; error?: string }> {
  const model = resolveModel(options.provider, options.model);
  const baseUrl = openAiBaseUrl(options);
  const apiKey = openAiApiKey(options);
  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...(options.provider === 'openrouter' && process.env.OPENROUTER_HTTP_REFERER ? { 'http-referer': process.env.OPENROUTER_HTTP_REFERER } : {}),
      ...(options.provider === 'openrouter' && process.env.OPENROUTER_APP_TITLE ? { 'x-title': process.env.OPENROUTER_APP_TITLE } : {}),
      ...providerExtraHeaders(options),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: options.prompt }],
      temperature: 0.2,
    }),
  }, timeoutMs);
  if (!response.ok) return { ok: false, error: redactSensitiveText(`${options.provider} returned HTTP ${response.status}: ${await response.text()}`) };
  const parsed = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return { ok: true, text: parsed.choices?.[0]?.message?.content?.trim() };
}

async function generateAnthropic(options: GenerateTextOptions, timeoutMs: number): Promise<{ ok: boolean; text?: string; error?: string }> {
  const model = resolveModel('anthropic', options.model);
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for provider anthropic.');
  const baseUrl = (options.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const response = await fetchWithTimeout(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': process.env.ANTHROPIC_VERSION ?? '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: Number(process.env.HOLDTHEGOBLIN_MAX_TOKENS ?? '2048'),
      messages: [{ role: 'user', content: options.prompt }],
    }),
  }, timeoutMs);
  if (!response.ok) return { ok: false, error: redactSensitiveText(`anthropic returned HTTP ${response.status}: ${await response.text()}`) };
  const parsed = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  return { ok: true, text: parsed.content?.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n').trim() };
}

function openAiBaseUrl(options: GenerateTextOptions): string {
  const base = options.baseUrl ?? baseUrlEnv(options.provider);
  if (!base) throw new Error(`Base URL is required for provider ${options.provider}.`);
  const normalized = base.replace(/\/$/, '');
  return normalized.endsWith('/chat/completions') ? normalized.slice(0, -'/chat/completions'.length) : normalized;
}

function baseUrlEnv(provider: ModelProvider): string | undefined {
  switch (provider) {
    case 'openai-compatible':
      return process.env.OPENAI_COMPATIBLE_BASE_URL;
    case 'openai':
      return process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
    case 'groq':
      return process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1';
    case 'openrouter':
      return process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
    case 'minimax':
      return process.env.MINIMAX_BASE_URL ?? process.env.MINIMAX_API_BASE_URL ?? 'https://api.minimaxi.com/v1';
    case 'zai':
      return process.env.ZAI_BASE_URL ?? process.env.GLM_BASE_URL ?? 'https://api.z.ai/api/paas/v4';
    case 'kimi':
      return process.env.KIMI_BASE_URL ?? process.env.MOONSHOT_BASE_URL ?? 'https://api.moonshot.ai/v1';
    case 'deepseek':
      return process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
    default:
      return undefined;
  }
}

function openAiApiKey(options: GenerateTextOptions): string | undefined {
  if (options.apiKey) {
    return options.provider === 'minimax' ? parseMiniMaxCredential(options.apiKey).apiKey : options.apiKey;
  }
  switch (options.provider) {
    case 'openai-compatible':
      return process.env.OPENAI_COMPATIBLE_API_KEY;
    case 'openai':
      return requiredEnv('OPENAI_API_KEY');
    case 'groq':
      return requiredEnv('GROQ_API_KEY');
    case 'openrouter':
      return requiredEnv('OPENROUTER_API_KEY');
    case 'minimax':
      return parseMiniMaxCredential(options.apiKey ?? requiredEnv('MINIMAX_API_KEY')).apiKey;
    case 'zai':
      return requiredEnvAny(['ZAI_API_KEY', 'GLM_API_KEY']);
    case 'kimi':
      return requiredEnvAny(['KIMI_API_KEY', 'MOONSHOT_API_KEY']);
    case 'deepseek':
      return requiredEnv('DEEPSEEK_API_KEY');
    default:
      return undefined;
  }
}

function providerExtraHeaders(options: GenerateTextOptions): Record<string, string> {
  if (options.provider !== 'minimax') return {};
  const credential = options.apiKey ?? process.env.MINIMAX_API_KEY;
  const groupId = process.env.MINIMAX_GROUP_ID ?? (credential ? parseMiniMaxCredential(credential).groupId : undefined);
  return groupId ? { 'x-minimax-group-id': groupId } : {};
}

function parseMiniMaxCredential(credential: string): { apiKey: string; groupId?: string } {
  const [groupId, apiKey] = credential.split('|');
  if (apiKey) return { groupId, apiKey };
  return { apiKey: credential };
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function requiredEnvAny(keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  throw new Error(`${keys.join(' or ')} is required.`);
}

function env(key: string): string | undefined {
  return process.env[key];
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function readModelTimeoutMs(): number {
  const value = Number(process.env.HOLDTHEGOBLIN_MODEL_TIMEOUT_MS ?? '60000');
  return Number.isFinite(value) && value > 0 ? value : 60000;
}
