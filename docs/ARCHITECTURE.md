# Architecture

HoldTheGoblin is a local-first verifier with these integration surfaces:

- CLI: `holdthegoblin verify`, `readiness`, `hook`, `checkpoint`, `handoff`, `config`, `events`, `doctor`, `mcp`, `mcp-http`, `deploy`, `observability`, and `tests`.
- Agent project assets: Claude Code hooks, Cursor rules, Codex/Warp `AGENTS.md` rules, and agent skills.
- SDK/MCP: exported TypeScript functions and a stdio MCP server for MCP-capable agents.
- Framework adapters: dependency-light LangGraph and CrewAI helpers.
- Model provider router: local Ollama, Ollama Cloud, OpenAI-compatible endpoints, OpenAI, Groq, OpenRouter, Anthropic, MiniMax, z.ai/GLM, Kimi/Moonshot, and DeepSeek for optional test-plan generation.

## Verification Flow

1. Load defaults or validate `.holdthegoblin/config.json`; invalid config exits non-zero before checks run.
2. Detect project type and planned test/security commands.
3. Read changed files from git when available.
4. Run deterministic edge-case analysis.
5. Run tests and optional Semgrep/Trivy scans.
6. Run the built-in secret scanner.
7. Evaluate policy according to `relaxed`, `balanced`, or `strict` mode.
8. Run report-only GitHub Actions ref pinning audit when workflow files exist.
9. Write `.holdthegoblin/latest.md`, `.holdthegoblin/latest.html`, immutable run JSON/Markdown/HTML, and event logs.
10. When `--github-step-summary` is passed inside GitHub Actions, append a concise redacted Markdown summary to `GITHUB_STEP_SUMMARY`.
11. When `--github-annotations` is passed inside GitHub Actions, emit escaped workflow command annotations for failed checks, failed commands, warnings/skips, and scanner findings.

## Policy Preflight Flow

Claude Code `PreToolUse` hooks are normalized into `holdthegoblin.policy_event.v1` records before risk evaluation. The shared policy preflight core evaluates shell commands, file reads/writes, and generic tool calls into `allow`, `ask`, or `deny` decisions, then writes a redacted `holdthegoblin.policy_decision.v1` audit event.

Credential-looking command arguments are treated as policy input, not log text. Split flags, inline flags, quoted shell fragments, generic authorization headers, URL credentials, and percent-encoded credential fragments are rejected or redacted before evidence is persisted. Pure environment references such as `$TOKEN`, `${TOKEN}`, and `Authorization: Bearer $TOKEN` remain allowed.

MCP-capable agents can call `policy_evaluate` with a normalized shell/file/tool event before acting. The tool returns the same structured event/decision pair and writes the redacted policy audit locally; enforcement still depends on the caller honoring a non-allow decision unless the host provides a hard hook.

## Readiness Flow

`holdthegoblin readiness` reads local setup evidence and returns an advisory 0-100 score with a `release-ready`, `guarded`, `partial`, or `at-risk` status. It checks the latest immutable verification report, GitHub Actions verification gates, Claude Code hard hooks, advisory agent rules and skills, scanner availability, config policy downgrades, GitHub Actions pinning policy posture, and `.gitignore` hygiene for runtime evidence. Non-passing checks carry remediation text so agents can tell the difference between a working hook engine and project-level hook installation.

By default readiness does not run tests or scanners. `readiness --verify` runs the normal verification flow first, which writes fresh `.holdthegoblin/` reports, and then scores the resulting evidence.

## Deploy Flow

`holdthegoblin deploy run --plan <file>` reads a versioned deploy plan, validates policy downgrade controls, runs verification, creates a checkpoint, executes shadow/canary/promote commands, and runs rollback command plus checkpoint restore on failure.

The deploy guard is command-runner based. It deliberately does not embed cloud-provider credentials or assume a specific platform.

Deploy commands can use `argv` arrays to run without a shell. Legacy `command` strings are still accepted for compatibility, but shell/interpreter wrappers are treated as human-review risk. Hard-deny risk rules are blocked even if a plan sets `allowDangerous`. Human-approval `ask` rules require `allowDangerous: true` in the reviewed plan plus the explicit run flag `--allow-dangerous`.

Spawned commands receive a minimal environment by default instead of the full parent process environment. Project config can set `execution.env` for verification and scanner commands. Deploy command specs can set `env` to add per-phase variable names. HoldTheGoblin records allowed and blocked environment key names in command results, but never records environment values.

Deploy plans cannot silently disable verification, checkpoint creation, checkpoint rollback, or promotion health gates. Those policy downgrades require both `allowPolicyDowngrade: true` in the reviewed plan and `--allow-dangerous` at runtime.

## Observability Flow

Observability export reads verification JSON reports only from `.holdthegoblin/runs`, redacts known secret patterns, removes raw stdout/stderr from command payloads, and writes provider-shaped JSON under `.holdthegoblin/exports/`.

Direct network send is opt-in through `--send`.

## Model Provider Flow

LLM-assisted test generation is opt-in. Provider base URLs are validated before network calls: URL credentials, credential-like path/query/fragment values, non-loopback cleartext HTTP, and redirects are rejected. Loopback HTTP remains allowed for local Ollama, LM Studio, vLLM, and compatible local gateways.

## Enforcement Boundaries

Claude Code hooks are the hard tool-call enforcement path in V0. Other agent integrations are intentionally described as advisory because they rely on the host agent following project instructions.

CI or another external gate should run `holdthegoblin verify` when a hard merge/deploy boundary is required.

GitHub Actions summaries and annotations are report-only. They do not alter policy evaluation, hook decisions, or process exit codes.

The GitHub Actions ref pinning audit is report-only by default. Repositories can set `githubActions.requirePinnedActions` to make non-allowlisted mutable `uses:` refs fail verification.

Pinning audit findings include remediation guidance with the safe replacement shape `owner/repo@<40-char-sha>`. HoldTheGoblin does not resolve mutable refs to SHAs automatically because that must be reviewed against the upstream action commit before use.

Readiness is an advisory posture report. It is useful for dashboards and agent context, but hard enforcement still comes from Claude Code hooks, CLI verify exit codes, CI, or guarded deploy plans.

## Local State

HoldTheGoblin writes runtime state under `.holdthegoblin/`:

- `config.json`
- `latest.md`
- `latest.html`
- `runs/*.json`
- `runs/*.md`
- `runs/*.html`
- `events.jsonl`
- `checkpoints/*`
- `exports/*.json`
- `deploy-latest.json`
- `deploy-runs/*.json`
- `generated-tests.md`

Projects should ignore run reports and checkpoints unless they intentionally want to commit policy configuration.
