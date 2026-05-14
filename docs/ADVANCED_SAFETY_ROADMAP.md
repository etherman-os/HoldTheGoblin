# Advanced Safety Roadmap

This roadmap tracks higher-assurance safety work for HoldTheGoblin. Items here should either improve tool-call enforcement, reduce unsafe persistence of sensitive data, or make agent behavior easier to audit after the fact.

## Baseline Now In Place

- Policy preflight events for shell commands, file reads, file writes, and generic tool calls.
- MCP `policy_evaluate` tool for normalized shell/file/tool policy events with local redacted audit records.
- Redacted policy decision audit records under `.holdthegoblin/policy/audit.jsonl`.
- Literal credential detection for split flags, inline flags, authorization headers, quoted shell fragments, URL credentials, and percent-encoded credential fragments.
- Environment-reference allowance for values such as `$TOKEN`, `${TOKEN}`, and `Authorization: Bearer $TOKEN`.
- Private runtime directory and audit file permissions on Unix-like systems.
- Symlink checks before writing event and policy audit logs.
- Observability endpoint validation that rejects credential-bearing URLs, cleartext non-loopback HTTP, and redirects.
- LLM-assisted test generation endpoint validation that rejects credential-bearing URLs, cleartext non-loopback HTTP, credential-like URL material, and redirects while preserving loopback local model endpoints.
- MCP HTTP authentication that requires env-provided tokens for non-loopback use and compares bearer tokens in constant time.
- Config and deploy-plan validation that rejects persisted literal credentials before commands are stored or executed.
- Command execution no longer inherits the full parent process environment by default.
- Project config can explicitly allow environment variable names for verification and scanner commands without persisting values.
- Deploy plans can explicitly allow environment variable names for a command without persisting their values.
- Command results record allowed and blocked environment key names only, never environment values.

## High-Priority Next Work

### External Policy Hook Engine

Add a first-class policy hook engine that can call local or remote guard services before sensitive actions are allowed.

Acceptance criteria:

- Support stdio and HTTP transports behind one normalized policy request/response contract.
- Default to fail-closed or ask-on-unavailable for high-risk actions.
- Enforce timeouts, byte caps, schema validation, and structured error handling.
- For HTTP hooks, require HTTPS except loopback localhost endpoints.
- Reject redirects and credential-bearing URLs.
- For stdio hooks, require `command` to be an executable path or bare command and require arguments to live in `args`.
- Do not inherit the full parent process environment by default.
- Allow explicit env allowlists and secret references by variable name, never literal secret values.
- Persist only redacted request/response summaries in audit logs.

### Effective Decision Composition

Represent final enforcement as a composed decision instead of a single risk result.

Acceptance criteria:

- Separate built-in risk results, external hook responses, user approval state, and host capability state.
- Produce one final `allow`, `ask`, or `deny` decision with machine-readable reasons.
- Ensure the most restrictive applicable decision wins unless an explicit reviewed override exists.
- Include a stable decision id and policy version for later audit correlation.
- Test every precedence combination: built-in allow plus hook deny, hook timeout, host unavailable, user approval, and config downgrade.

### Richer Tool-Call Event Model

Expand policy events so adapters can reason about what is happening without logging sensitive payloads.

Acceptance criteria:

- Normalize shell command events with executable, argv, cwd, shell-wrapper status, and risk tags.
- Normalize file read/write events with path categories, path counts, size hints, and write mode.
- Normalize MCP events with server name, tool/resource name, argument keys, argument shape, and capped previews.
- Omit raw argument values from default audit events unless explicitly safe and capped.
- Include redaction metadata so reviewers can see when payloads were omitted, capped, or scrubbed.

### MCP Governance Surface

Make policy evaluation itself available through MCP so other agents and tools can ask for decisions before acting.

Acceptance criteria:

- Expose read-only MCP resources for current policy config, recent audit decisions, and enforcement capabilities.
- Keep all returned audit data redacted by default.
- Add integration examples for MCP clients that call policy evaluation before tool execution.

### Framework Pre-Tool Guards

Turn framework adapters from advisory helpers into practical pre-tool guard layers where the framework allows it.

Acceptance criteria:

- Add pre-tool guard examples for LangGraph and CrewAI.
- Ensure guard failures stop dangerous tool execution instead of only reporting after the fact.
- Preserve adapter-light installation: no heavyweight runtime dependency in the core package.
- Include tests that prove dangerous tool calls do not reach the underlying tool.

## Hardening Backlog

### Runner Environment Isolation

- Add command-specific environment allowlists for configured custom verification commands.
- Add docs for common CI/provider env keys that users may intentionally allow.
- Keep literal environment values out of config, deploy plans, reports, and audit events.

### Preflight Idempotency And Freshness

- Add a decision cache keyed by normalized action, policy version, config digest, and working tree state.
- Expire cached decisions after a short TTL.
- Reject stale decisions when policy config or relevant project state changes.
- Record cache hits in audit logs without duplicating sensitive payloads.

### Safer Human-Readable Reasons

- Replace raw paths and command fragments in denial reasons with categorized descriptions where possible.
- Keep detailed redacted context in the audit record for local debugging.
- Add tests that denial messages cannot leak secrets through reason strings.

### Policy Schema Versioning

- Publish JSON schemas for policy events, decisions, hook requests, hook responses, and audit records.
- Version schemas independently from package versions when wire formats change.
- Add fixture tests that old event samples still parse or fail with a precise migration error.

### Deploy And Release Guard Integration

- Feed deploy-plan stages into the same policy preflight engine used by tool calls.
- Require explicit reviewed overrides for production-like deploy, rollback, and destructive data commands.
- Record deploy-stage policy decisions in the dedicated policy audit log.
- Block release checks when policy downgrade controls are weakened without an explicit approval path.

## Non-Goals

- Do not describe advisory project instructions as hard sandboxing.
- Do not persist raw tool arguments, raw command output, tokens, headers, or full hook payloads by default.
- Do not require users to send local audit data to a hosted service.
- Do not make optional external scanners appear as passed when they were skipped.
- Do not replace backups, least-privilege credentials, code review, or branch protection.
