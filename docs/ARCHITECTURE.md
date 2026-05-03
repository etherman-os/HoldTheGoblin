# Architecture

HoldTheGoblin is a local-first verifier with three integration surfaces:

- CLI: `holdthegoblin verify`, `hook`, `checkpoint`, `handoff`, `events`, `doctor`, `mcp`, `mcp-http`, `deploy`, `observability`, and `tests`.
- Agent project assets: Claude Code hooks, Cursor rules, Codex/Warp `AGENTS.md` rules, and agent skills.
- SDK/MCP: exported TypeScript functions and a stdio MCP server for MCP-capable agents.
- Framework adapters: dependency-light LangGraph and CrewAI helpers.
- Model provider router: local Ollama, Ollama Cloud, OpenAI-compatible endpoints, OpenAI, Groq, OpenRouter, Anthropic, MiniMax, z.ai/GLM, Kimi/Moonshot, and DeepSeek for optional test-plan generation.

## Verification Flow

1. Load `.holdthegoblin/config.json` or defaults.
2. Detect project type and planned test/security commands.
3. Read changed files from git when available.
4. Run deterministic edge-case analysis.
5. Run tests and optional Semgrep/Trivy scans.
6. Run the built-in secret scanner.
7. Evaluate policy according to `relaxed`, `balanced`, or `strict` mode.
8. Write `.holdthegoblin/latest.md`, run JSON, and event logs.

## Deploy Flow

`holdthegoblin deploy run --plan <file>` reads a versioned deploy plan, creates a checkpoint, runs verification, executes shadow/canary/promote commands, and runs rollback command plus checkpoint restore on failure.

The deploy guard is command-runner based. It deliberately does not embed cloud-provider credentials or assume a specific platform.

Deploy commands that match hard-deny risk rules are blocked even if a plan sets `allowDangerous`. Human-approval `ask` rules require `allowDangerous: true` in the reviewed plan.

## Observability Flow

Observability export reads a verification JSON report, redacts known secret patterns, removes raw stdout/stderr from command payloads, and writes provider-shaped JSON under `.holdthegoblin/exports/`.

Direct network send is opt-in through `--send`.

## Enforcement Boundaries

Claude Code hooks are the hard tool-call enforcement path in V0. Other agent integrations are intentionally described as advisory because they rely on the host agent following project instructions.

CI or another external gate should run `holdthegoblin verify` when a hard merge/deploy boundary is required.

## Local State

HoldTheGoblin writes runtime state under `.holdthegoblin/`:

- `config.json`
- `latest.md`
- `runs/*.json`
- `runs/*.md`
- `events.jsonl`
- `checkpoints/*`
- `exports/*.json`
- `deploy-latest.json`
- `generated-tests.md`

Projects should ignore run reports and checkpoints unless they intentionally want to commit policy configuration.
