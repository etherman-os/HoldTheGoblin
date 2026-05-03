# Roadmap

## V0.1 Release Candidate

Implemented:

- Local verifier with evidence reports.
- Built-in secret scanning.
- Optional Semgrep and Trivy execution.
- Deterministic edge-case suggestions.
- Claude Code hard hook integration.
- Cursor, Codex, and Warp project guidance.
- Agent skills for `.agents`, `.codex`, and `.warp`.
- Checkpoint create/list/rollback.
- JSON schema handoff validation.
- JSONL observability events.
- Local stdio MCP server.
- Streamable HTTP MCP server for local/network-hosted tool access.
- Guarded deploy plans with verify, checkpoint, shadow/canary, health checks, rollback command, and checkpoint restore.
- Langfuse and AgentOps-compatible observability exports.
- Deterministic and LLM-assisted test plan generation with local, cloud, and OpenAI-compatible providers.
- Dependency-light LangGraph and CrewAI adapters.
- CI, smoke tests, demo fixture, and npm package dry-run.

## V0.2

- Configurable custom policy packs.
- HTML evidence report.
- First-class GitHub Action template for downstream projects.
- Provider-specific observability SDK bridges where the upstream APIs are stable enough to avoid brittle direct ingestion.

## V1

- Signed release provenance.
- Organization policy management.
- Native package split for framework adapters if demand justifies separate installs.
- Deeper OpenAI Agents SDK adapter once its stable hook surface is settled for this use case.

## Non-Goals For V0

- Claiming advisory rules are hard sandboxing.
- Claiming skipped external scanners passed.
- Replacing production backups, least-privilege credentials, or CI branch protection.
