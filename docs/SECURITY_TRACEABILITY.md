# Security Traceability

This file maps advanced safety requirements to the current HoldTheGoblin implementation. It is meant to keep review lessons from becoming tribal memory.

## Implemented Controls

| Requirement | Implementation | Tests |
| --- | --- | --- |
| Block literal credentials in command arguments before they can be persisted or audited. | `src/core/risk.ts`, `src/core/config.ts`, `src/core/deploy.ts` | `test/risk.test.ts`, `test/config.test.ts`, `test/deploy.test.ts` |
| Detect credentials in split flags, inline flags, authorization headers, quoted shell fragments, URL credentials, and percent-encoded fragments. | `src/core/risk.ts`, `src/core/redact.ts` | `test/risk.test.ts`, `test/redact.test.ts` |
| Allow environment references without treating them as literal secrets. | `src/core/risk.ts` | `test/risk.test.ts`, `test/deploy.test.ts` |
| Redact command output, reports, event payloads, scanner output, deploy reports, and policy audit records before persistence. | `src/core/redact.ts`, `src/core/report.ts`, `src/core/security.ts`, `src/core/deploy.ts`, `src/core/policy-audit.ts` | `test/redact.test.ts`, `test/security.test.ts`, `test/deploy.test.ts`, `test/hook.test.ts` |
| Normalize tool-call preflight into versioned policy event and decision records. | `src/core/preflight.ts`, `src/core/types.ts` | `test/hook.test.ts`, `test/mcp.test.ts` |
| Write dedicated policy audit logs separate from generic events. | `src/core/policy-audit.ts`, `src/core/preflight.ts` | `test/hook.test.ts` |
| Avoid writing raw generic tool argument values into default policy events. | `src/core/preflight.ts`, `src/core/policy-audit.ts` | `test/hook.test.ts` |
| Cap large policy payloads before audit persistence. | `src/core/preflight.ts` | `test/hook.test.ts` |
| Use private runtime, policy, and audit file permissions on Unix-like systems. | `src/core/config.ts`, `src/core/policy-audit.ts`, `src/core/events.ts` | `test/config.test.ts`, `test/hook.test.ts`, `test/redact.test.ts` |
| Reject symlinked runtime and audit/event paths before append/read. | `src/core/config.ts`, `src/core/events.ts`, `src/core/policy-audit.ts` | `test/config.test.ts`, `test/redact.test.ts`, `test/hook.test.ts` |
| Block sensitive file reads through direct tools and shell commands. | `src/core/risk.ts`, `src/core/hooks.ts` | `test/risk.test.ts`, `test/hook.test.ts` |
| Fail closed on malformed hook input. | `src/core/hooks.ts` | `test/hook.test.ts` |
| Enforce deploy hard-deny rules even when a plan asks for dangerous approval. | `src/core/deploy.ts`, `src/core/risk.ts` | `test/deploy.test.ts` |
| Require both reviewed plan approval and external run approval for human-review deploy rules. | `src/core/deploy.ts` | `test/deploy.test.ts` |
| Block deploy policy downgrades unless explicitly reviewed. | `src/core/deploy.ts`, `src/core/policy.ts` | `test/deploy.test.ts`, `test/security.test.ts` |
| Validate observability endpoints before network send. | `src/core/observability.ts` | `test/observability.test.ts` |
| Reject observability URL credentials, credential-like paths/query/fragment values, unsafe cleartext HTTP, and redirects. | `src/core/observability.ts` | `test/observability.test.ts` |
| Require MCP HTTP auth for non-loopback binding and compare bearer tokens in constant time. | `src/mcp.ts`, `src/cli.ts` | `test/mcp.test.ts`, `test/cli.test.ts` |
| Run MCP risk assessment through the same policy preflight and audit path. | `src/mcp.ts`, `src/core/preflight.ts` | `test/mcp.test.ts` |
| Terminate timed-out command process trees. | `src/core/runner.ts` | `test/redact.test.ts` |
| Do not inherit the full parent environment for spawned commands. | `src/core/runner.ts` | `test/redact.test.ts`, `test/deploy.test.ts` |
| Allow verification and scanner commands to pass reviewed environment variable names from config without persisting values. | `src/core/config.ts`, `src/core/verify.ts`, `src/core/security.ts`, `src/core/runner.ts` | `test/config.test.ts`, `test/redact.test.ts` |
| Allow deploy commands to pass reviewed environment variable names without persisting values. | `src/core/deploy.ts`, `src/core/runner.ts` | `test/deploy.test.ts` |
| Record command environment key names only, never values. | `src/core/runner.ts`, `src/core/types.ts` | `test/redact.test.ts`, `test/deploy.test.ts` |
| Omit raw scanner JSON from command evidence after parsing. | `src/core/security.ts` | `test/security.test.ts` |
| Treat truncated scanner JSON as a skipped warning input, not as a pass. | `src/core/security.ts` | `test/security.test.ts` |

## Tracked Gaps

These are not bug-fix leftovers in the current code. They are larger product and architecture work items that remain intentionally tracked in `docs/ADVANCED_SAFETY_ROADMAP.md`.

| Gap | Why it matters |
| --- | --- |
| External policy hook engine. | Lets HoldTheGoblin call local or remote guard services before tool execution. |
| Effective decision composition. | Separates built-in risk, external hook response, host capability, user approval, and final decision precedence. |
| Richer typed policy event payloads. | Gives adapters better context without logging sensitive argument values. |
| MCP `policy_evaluate` governance tool and policy resources. | Lets other agents ask for a structured policy decision directly. |
| Framework pre-tool guard examples. | Moves LangGraph/CrewAI adapters from post-run/advisory checks toward pre-tool enforcement where possible. |
| Command-specific env allowlists for custom verification commands. | Project-level `execution.env` now exists; command-specific custom verification env config is still a future ergonomics improvement. |
| Preflight freshness and idempotency. | Prevents stale allow decisions from being reused after policy or working-tree changes. |
| Published policy JSON schemas and fixture compatibility tests. | Makes policy events, decisions, and audit records stable for external integrations. |
| Deploy-stage policy audit integration. | Deploy guard currently records deploy reports/events; each deploy phase should also be mirrored into the dedicated policy audit stream. |

## Audit Rule

Before claiming a security lesson is fully implemented, it should have all three:

- A named requirement in this file.
- A code path that enforces or records it.
- A test that fails if the behavior regresses.
