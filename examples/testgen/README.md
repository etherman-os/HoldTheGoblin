# Test Generation Example

Generate deterministic test suggestions from changed risky code paths:

```bash
holdthegoblin tests generate
```

Use local Ollama when you want expanded test case drafts:

```bash
ollama pull llama3.1
holdthegoblin tests generate --provider ollama --model llama3.1
```

Use Ollama cloud models through your signed-in local Ollama daemon:

```bash
ollama signin
holdthegoblin tests generate --provider ollama --model glm-5.1:cloud
```

Use Ollama Cloud directly with an API key:

```bash
export OLLAMA_API_KEY=...
holdthegoblin tests generate --provider ollama-cloud --model gpt-oss:120b
```

Use an external subscription or router:

```bash
export OPENROUTER_API_KEY=...
holdthegoblin tests generate --provider openrouter --model openrouter/auto

export GROQ_API_KEY=...
holdthegoblin tests generate --provider groq --model openai/gpt-oss-20b

export KIMI_API_KEY=...
holdthegoblin tests generate --provider kimi --model kimi-k2.6

export ZAI_API_KEY=...
holdthegoblin tests generate --provider zai --model glm-5.1

export MINIMAX_API_KEY=...
holdthegoblin tests generate --provider minimax --model MiniMax-M2.7

export DEEPSEEK_API_KEY=...
holdthegoblin tests generate --provider deepseek --model deepseek-v4-flash

export OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:1234/v1
export OPENAI_COMPATIBLE_MODEL=local-model
holdthegoblin tests generate --provider openai-compatible
```

List all providers:

```bash
holdthegoblin models providers
```

HoldTheGoblin writes markdown to `.holdthegoblin/generated-tests.md`. It does not silently edit your test suite; agents should inspect the generated plan, add real tests, then run `holdthegoblin verify`.
