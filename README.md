# HoldTheGoblin

**Stops unsafe coding agents before they call it done.**

HoldTheGoblin is a local-first verification layer for AI coding agents. It blocks dangerous tool calls where the host agent supports hard hooks, runs tests and security scans before completion, writes evidence reports, and gives the agent concrete feedback to fix the work.

It is not a prompt checklist. It runs commands and fails closed when the configured gate fails.

## 30 Second Start

Current local checkout:

```bash
npm ci
npm run build
npm install -g .
cd your-project
holdthegoblin wrap --agent all .
holdthegoblin verify
```

After the public npm package is published, the install step becomes `npm install -g holdthegoblin`.

After wrapping a project:

- Claude Code gets hard hook blocking for dangerous Bash calls and sensitive file reads.
- Cursor gets project rules that require verification before completion.
- Codex gets `AGENTS.md`, `.agents/skills`, and `.codex/skills` guidance.
- Warp gets `AGENTS.md`, `WARP.md`, `.agents/skills`, and `.warp/skills` guidance.
- Any agent can use `holdthegoblin verify`, `checkpoint`, `handoff validate`, `deploy run`, `tests generate`, and MCP tools.

## Demo: Block A Production DB Delete

```bash
cd holdthegoblin
npm ci
npm run demo:db-delete
```

The demo sends a Claude Code `PreToolUse` payload containing:

```bash
dropdb production
```

Expected output includes:

```json
{"permissionDecision":"deny"}
```

The demo uses the real `holdthegoblin hook claude` entrypoint, not a mocked decision.

## What It Checks

| Layer | Behavior |
| --- | --- |
| Tool-call guard | Blocks destructive shell commands and sensitive file reads through Claude Code hooks. |
| Test verifier | Detects JS/TS, Python, Go, Rust, and Java test/lint/typecheck commands. |
| Security scanner | Runs built-in secret scan; uses Semgrep and Trivy when installed. |
| Test generation | Flags risky code paths and writes deterministic or LLM-assisted test plans through local/cloud providers. |
| Handoff proof | Validates multi-agent JSON handoffs against a schema. |
| Deploy guard | Runs verify, checkpoint, shadow/canary commands, health checks, rollback command, and checkpoint restore from a deploy plan. |
| Rollback | Creates local file checkpoints and restores them on demand or during failed deploy phases. |
| Observability | Writes evidence reports, JSONL event logs, and Langfuse/AgentOps-compatible export payloads under `.holdthegoblin/`. |
| MCP | Exposes verifier, checkpoint, handoff, deploy, test generation, and observability tools over stdio or Streamable HTTP. |

## Commands

```bash
holdthegoblin --version
holdthegoblin wrap --agent claude-code|cursor|codex|warp|all [path]
holdthegoblin init --agent claude-code|cursor|codex|warp|all [--mode relaxed|balanced|strict]
holdthegoblin verify [--format text|json|markdown]
holdthegoblin hook claude
holdthegoblin checkpoint create|list|rollback [--id latest] [--delete-new]
holdthegoblin handoff validate --schema schema.json --input payload.json
holdthegoblin events [--limit 20] [--format text|json]
holdthegoblin doctor
holdthegoblin mcp
holdthegoblin mcp-http [--host 127.0.0.1] [--port 3333] [--allowed-host localhost] [--auth-token token]
holdthegoblin deploy init [--output holdthegoblin.deploy.json]
holdthegoblin deploy run --plan holdthegoblin.deploy.json [--dry-run] [--format json]
holdthegoblin observability export --provider langfuse|agentops|all [--send] [--timeout-ms 15000]
holdthegoblin tests generate [--provider deterministic|ollama|ollama-cloud|openai-compatible|openai|groq|openrouter|anthropic|minimax|zai|kimi|deepseek] [--model model] [--base-url url] [--timeout-ms 60000]
holdthegoblin models providers [--format json]
holdthegoblin demo
```

## Agent Integrations

### Claude Code

`holdthegoblin wrap --agent claude-code .` writes project hooks to `.claude/settings.json`.

Hard blocking is available for:

- `PreToolUse`: dangerous Bash commands and sensitive reads.
- `PostToolBatch`: quick security verification after file mutations.
- `Stop`: full verification before Claude finishes.

Claude Code hook behavior is based on the official hooks contract: https://code.claude.com/docs/en/hooks

### Cursor

`holdthegoblin wrap --agent cursor .` writes `.cursor/rules/holdthegoblin.mdc`.

Cursor rules are guidance, not a hard sandbox. They are still useful because they keep verification visible in the coding loop, but production enforcement should happen through Claude hooks, CLI verification, or CI.

Cursor project rules live in `.cursor/rules`: https://docs.cursor.com/en/context

### Codex

`holdthegoblin wrap --agent codex .` writes `AGENTS.md`, `.agents/skills/holdthegoblin/SKILL.md`, and `.codex/skills/holdthegoblin/SKILL.md`.

This is project guidance for Codex: run `holdthegoblin verify`, use checkpoints before risky changes, avoid credential reads, and cite `.holdthegoblin/latest.md` as evidence. It is not a hard runtime sandbox.

### Warp

`holdthegoblin wrap --agent warp .` writes `AGENTS.md`, `WARP.md`, `.agents/skills/holdthegoblin/SKILL.md`, and `.warp/skills/holdthegoblin/SKILL.md`.

Warp uses project rules from `AGENTS.md` by default and supports `WARP.md` for compatibility: https://docs.warp.dev/agent-platform/capabilities/rules

### Generic Agents And Frameworks

Use the CLI directly:

```bash
holdthegoblin verify --format json
npm exec -- holdthegoblin verify --format json
holdthegoblin handoff validate --schema examples/handoff/schema.json --input examples/handoff/payload.json
```

The `npm exec` fallback is for projects that install HoldTheGoblin as a dependency. For unpublished local development, use `npm install -g .` or `npm link` from this repository.

The TypeScript SDK is exported from `holdthegoblin`. It includes dependency-light LangGraph node helpers and CrewAI guard helpers. Python CrewAI projects can use `integrations/crewai/holdthegoblin_guard.py`.

## Test Generation

```bash
holdthegoblin tests generate
holdthegoblin tests generate --provider ollama --model glm-5.1:cloud
holdthegoblin tests generate --provider ollama-cloud --model gpt-oss:120b
holdthegoblin tests generate --provider openrouter --model openrouter/auto
holdthegoblin tests generate --provider kimi --model kimi-k2.6
holdthegoblin tests generate --provider zai --model glm-5.1
holdthegoblin tests generate --provider minimax --model MiniMax-M2.7
holdthegoblin tests generate --provider deepseek --model deepseek-v4-flash
```

The default deterministic provider writes `.holdthegoblin/generated-tests.md` from risky changed code paths. LLM providers expand that into richer test drafts and fall back to the deterministic plan if the provider fails. It does not silently modify your test suite.

Supported providers:

- `ollama`: local Ollama daemon, including signed-in `:cloud` models through `ollama run/pull`.
- `ollama-cloud`: direct Ollama Cloud API with `OLLAMA_API_KEY`.
- `openai-compatible`: any OpenAI-compatible endpoint through `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY`, and `OPENAI_COMPATIBLE_MODEL`.
- `openai`, `groq`, `openrouter`, `anthropic`: user-supplied API keys and model names.
- `minimax`: MiniMax native subscriptions through `MINIMAX_API_KEY`, with `MINIMAX_BASE_URL` available for regional or legacy endpoints.
- `zai`: z.ai / GLM native subscriptions through `ZAI_API_KEY` or `GLM_API_KEY`.
- `kimi`: Kimi / Moonshot native subscriptions through `KIMI_API_KEY` or `MOONSHOT_API_KEY`.
- `deepseek`: DeepSeek native subscriptions through `DEEPSEEK_API_KEY`.

Use:

```bash
holdthegoblin models providers
```

to print the current provider registry and required environment variables.

## Deploy Guard

```bash
holdthegoblin deploy init --output holdthegoblin.deploy.json
holdthegoblin deploy run --plan holdthegoblin.deploy.json
```

A deploy plan can define `shadow`, `shadowHealth`, `canary`, `canaryHealth`, `promote`, and `rollback` commands. HoldTheGoblin runs verification first, creates a local checkpoint by default, and restores checkpoint-tracked files if a guarded deploy phase fails.

Commands that match destructive or human-approval risk rules are blocked by default. Hard-deny rules cannot be bypassed by deploy-plan JSON. A deploy plan can set `allowDangerous: true` only for human-approval `ask` rules after separate review.

## Observability Export

```bash
holdthegoblin observability export --provider all
holdthegoblin observability export --provider langfuse --send
```

Local exports are written to `.holdthegoblin/exports/`. `--send` is opt-in. Langfuse send mode uses `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and optional `LANGFUSE_BASE_URL`. AgentOps send mode expects `AGENTOPS_API_KEY` and `AGENTOPS_INGEST_URL` for an OpenTelemetry relay you control.

## MCP Server

HoldTheGoblin ships a local stdio MCP server so MCP-capable agents can call the same verifier, checkpoint, handoff, and event tools without shelling out manually.

```bash
holdthegoblin mcp
holdthegoblin mcp-http --host 127.0.0.1 --port 3333
```

Example MCP client config:

```json
{
  "mcpServers": {
    "holdthegoblin": {
      "command": "holdthegoblin",
      "args": ["mcp"]
    }
  }
}
```

Available tools:

- `verify`: run tests, security checks, edge-case detection, and evidence reporting.
- `doctor`: inspect project setup and planned commands.
- `checkpoint_create`, `checkpoint_list`, `checkpoint_rollback`: snapshot and restore local work.
- `handoff_validate`: validate a JSON handoff payload against a schema.
- `events`: read recent HoldTheGoblin event logs.
- `deploy_run`: execute a guarded deploy plan.
- `observability_export`: write or send observability payloads.
- `tests_generate`: write deterministic or LLM-assisted test plans.
- `models_providers`: list supported model providers and environment variables.

## Evidence Reports

Each verification writes:

```text
.holdthegoblin/latest.md
.holdthegoblin/runs/<run-id>.json
.holdthegoblin/runs/<run-id>.md
.holdthegoblin/events.jsonl
```

Other commands may also write:

```text
.holdthegoblin/exports/*.json
.holdthegoblin/deploy-latest.json
.holdthegoblin/generated-tests.md
```

Use:

```bash
holdthegoblin events --limit 10
```

to review recent init, verification, and guard events.

## Modes

- `relaxed`: more issues are warnings.
- `balanced`: default; fails tests, secrets, Semgrep `ERROR`, Trivy `HIGH|CRITICAL`.
- `strict`: missing tests are also a failure.

## Examples

- `examples/db-delete-block`: hard hook denial demo.
- `examples/handoff`: schema and payload validation.
- `examples/claude-hook`: raw Claude hook payload.
- `examples/cursor-rule`: Cursor integration notes.
- `examples/codex-rule`: Codex `AGENTS.md` integration notes.
- `examples/warp-rule`: Warp `AGENTS.md`/`WARP.md` integration notes.
- `examples/mcp`: MCP server client config.
- `examples/deploy`: shadow/canary deploy plan example.
- `examples/observability`: Langfuse and AgentOps export notes.
- `examples/langgraph`: LangGraph adapter example.
- `examples/crewai`: CrewAI guard example.
- `examples/testgen`: deterministic, Ollama Cloud, and external provider test generation notes.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run smoke
npm run demo:db-delete
npm run release:check
npm pack --dry-run
```

CI runs the same checks on Node 20 and 22.

Project docs:

- `docs/ARCHITECTURE.md`: verifier and integration design.
- `docs/ROADMAP.md`: what is implemented now and what stays on the V1 roadmap.
- `CONTRIBUTING.md`: local development and release checklist.
- `SECURITY.md`: vulnerability reporting and guardrail scope.

## Limitations

- Cursor rules are advisory; they cannot enforce a hard block by themselves.
- Codex and Warp project rules are advisory; use CI or Claude Code hooks for hard enforcement.
- `mcp-http` exposes Streamable HTTP on a host/port. It uses MCP SDK host validation. When binding beyond localhost, `--auth-token` or `HOLDTHEGOBLIN_MCP_HTTP_TOKEN` is required; still put TLS and network policy in front of it.
- Semgrep and Trivy are optional external CLIs. If missing, HoldTheGoblin reports them as skipped.
- Deterministic test generation writes a test plan, not committed test files. External providers require the user to bring their own API key/subscription. HoldTheGoblin does not resell model access.
- Langfuse direct send uses the legacy ingestion API shape; Langfuse recommends OpenTelemetry for new ingestion pipelines. AgentOps export is OTLP-style JSON intended for a relay or SDK bridge.
- Deploy guard runs the commands you configure. It is not a replacement for cloud-provider permissions, backups, or production deployment controls.

For intentional fake credentials in tests or demos, add `holdthegoblin: allow-secret` on that line.

## License

MIT
