# Changelog

## 0.1.1

- Hardened evidence redaction for command output, verification reports, deploy reports, observability send errors, and model-provider errors.
- Expanded Claude Code hard hook coverage for sensitive Bash reads, Grep/Glob paths, and sensitive file mutations.
- Prevented deploy-plan `allowDangerous` from bypassing hard-deny risk rules.
- Prevented checkpoints from snapshotting or deleting sensitive local credential files.
- Added root-relative path resolution for deploy plans, generated test plans, MCP handoff validation, and observability run selection.
- Added MCP HTTP bearer-token enforcement when binding outside loopback.
- Added npm metadata, tag-triggered CI, publish gating, security issue-template hardening, and broader release tests.

## 0.1.0

- Added local-first `holdthegoblin verify` gate with test detection, security scanning, edge-case suggestions, evidence reports, and event logs.
- Added hard Claude Code hook integration for destructive Bash commands and sensitive reads.
- Added Cursor, Codex, and Warp project guidance plus agent skills.
- Added checkpoint create/list/rollback commands for local recovery.
- Added JSON schema handoff validation for multi-agent workflows.
- Added stdio and Streamable HTTP MCP servers with verifier, doctor, checkpoint, handoff, deploy, observability, test generation, and event tools.
- Added guarded deploy plans with verify, checkpoint, shadow/canary, health checks, rollback command, and checkpoint restore.
- Added Langfuse and AgentOps-compatible observability exports.
- Added deterministic and LLM-assisted test plan generation with Ollama local/cloud, OpenAI-compatible, OpenAI, Groq, OpenRouter, Anthropic, MiniMax, z.ai/GLM, Kimi/Moonshot, and DeepSeek providers.
- Added dependency-light LangGraph and CrewAI adapters.
- Added CI, smoke tests, demo fixtures, and npm package dry-run validation.
