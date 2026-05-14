# Changelog

## 0.1.3

- Added advisory readiness scoring across latest verification evidence, CI gates, hard/advisory agent setup, scanner availability, policy posture, and runtime evidence hygiene through CLI, SDK, and MCP.
- Added readiness remediation guidance so warnings distinguish hook-engine tests from project-level Claude hook wiring and tell users the next command to run.
- Added GitHub Actions pinning remediation in verification checks and evidence so mutable `uses:` refs point to reviewed full-SHA replacement guidance.
- Added MCP `policy_evaluate` for normalized shell/file/tool policy events with structured decisions and redacted local audit records.
- Added deploy policy downgrade blocking for disabled verification, checkpointing, checkpoint rollback, and promotion health gates.
- Added shell-free deploy `argv` commands, inline interpreter review gates, dry-run risk evaluation, deploy run history, and non-retry defaults for mutating deploy phases.
- Added configuration policy-floor findings so weakened test, secret, Semgrep, or Trivy policies are explicit and blocking in strict/release verification.
- Added documented config schema validation, `config validate`, `config schema`, and MCP `config_validate`.
- Added downstream GitHub Actions verification workflow template.
- Added optional Semgrep and Trivy setup recipes with scanner skip semantics and Trivy supply-chain cautions.
- Added local HTML evidence reports alongside Markdown and JSON verification reports.
- Added GitHub Actions step summaries and escaped workflow annotations for concise CI evidence with artifact upload guidance.
- Added GitHub Actions ref pinning audit with opt-in blocking policy and allowlists for mutable external workflow action refs.
- Added installed-package smoke testing, package content allow/deny checks, sourcemap omission, MCP version derivation from package metadata, and token-gated npm provenance publishing.
- Hardened release automation by separating read-only release checks from privileged GitHub Release/npm publishing and publishing the exact packed tarball.
- Restricted observability exports to immutable `.holdthegoblin/runs` verification reports and added immutable report paths to verification evidence.

## 0.1.2

- Hardened command timeouts to terminate process trees instead of only the shell wrapper.
- Made truncated scanner JSON fail closed as skipped evidence instead of silently parsing partial output.
- Broadened sensitive path blocking for `.npmrc`, `.netrc`, Kubernetes, Docker, cloud credential, private key, and shell upload references.
- Added fail-closed malformed Claude hook handling and `LS` sensitive path denial.
- Scoped deploy, test generation, observability, and MCP handoff paths to the project root.
- Validated checkpoint metadata paths and skipped symlink snapshots.
- Redacted additional token forms, bearer headers, JWTs, URL credentials, events, and observability command metadata.
- Improved CLI boolean parsing, command-local help, deploy approval semantics, MCP HTTP network hardening, CI permissions, provenance publishing workflow, config/privacy docs, and tests.

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
