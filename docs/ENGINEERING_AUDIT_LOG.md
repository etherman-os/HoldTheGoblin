# Engineering Audit Log

This file is the persistent working record for HoldTheGoblin engineering sessions. Update it whenever a meaningful audit finding, implementation milestone, validation result, or next-step decision changes.

## Session State - 2026-05-05

Current working tree contains an in-progress product hardening patch. It is intentionally not a runtime report and can be committed after review.

The audit scope is the entire project, not only the current patch. Current-patch review is necessary but insufficient because older code can still contain weak enforcement claims, unsafe path handling, missing tests, or confusing product behavior.

Last full validation completed in this session:

- `npm run release:check`: pass
- Full Node test suite: `142 pass`
- `npm run verify:self`: pass
- Semgrep: ran and passed
- Trivy: ran and passed
- Package smoke and `npm pack --dry-run`: pass
- Focused safety regression set: `46 pass` for checkpoint, deploy, observability, and test generation.
- Local evidence report: `.holdthegoblin/latest.md`, run `20260505145155-o049pq`

Do not commit `.holdthegoblin/` runtime reports.

## Implemented In Current Patch

### Release Workflow Hardening

- Split privileged publish work from read-only release checks.
- Keep `release:check` in the low-privilege verify job.
- Publish the exact packed tarball created by `npm pack --json --ignore-scripts`.
- Keep publish credentials away from test execution.
- Added workflow invariant coverage in `test/actions.test.ts`.

### Readiness Scoring

- Added `assessReadiness` core API and SDK export.
- Added CLI command: `holdthegoblin readiness [--format text|json] [--verify]`.
- Added MCP tool: `readiness`.
- Scores latest verification evidence, CI gate presence, hard/advisory agent coverage, scanner availability, policy posture, and runtime evidence hygiene.
- Non-passing readiness checks include remediation text.
- Important product distinction now explicit: the demo proves the hook engine works; `.claude/settings.json` proves this project is wired for automatic Claude Code hard hooks.

### GitHub Actions Pinning Guidance

- GitHub Actions pinning findings now include:
  - `suggestedPinnedUses`
  - per-finding remediation text
  - check-level remediation text
- Markdown, text, and HTML reports surface check remediation.
- The tool does not resolve mutable refs to SHAs automatically; users must review the upstream action commit and then pin to a full 40-character SHA.

### MCP Policy Evaluation

- Added `evaluatePolicyEventPreflight` core API and SDK export.
- Added MCP tool: `policy_evaluate`.
- MCP clients can submit normalized `shell_command`, `file_read`, `file_write`, or `tool_call` policy events.
- The tool returns a redacted `holdthegoblin.policy_event.v1` and `holdthegoblin.policy_decision.v1` pair.
- Decisions are audited through the same local redacted policy audit path.

### Model Provider Endpoint Safety

- Added shared HTTP endpoint validation for opt-in network sends.
- LLM-assisted test generation provider base URLs now reject:
  - URL credentials.
  - Credential-like path, query, or fragment material, including percent-encoded fragments.
  - Cleartext HTTP unless the endpoint is loopback localhost.
  - Redirect following.
- Existing local model workflows remain supported through loopback HTTP endpoints such as local Ollama, LM Studio, vLLM, and local OpenAI-compatible servers.

### Runtime Subdirectory Symlink Hardening

- Added `ensureAppDir` so runtime subdirectories created after startup use the same root/symlink/permission checks as core runtime directories.
- Observability exports now reject symlinked `.holdthegoblin/exports`.
- Deploy reports now reject symlinked `.holdthegoblin/deploy-runs`.
- Checkpoint listing now rejects symlinked checkpoint directories and symlinked checkpoint metadata.
- Checkpoint rollback now rejects symlinked source files and symlinked target parent directories, and replaces target file symlinks instead of writing through them.
- Observability payload and generated test-plan writes now use atomic replacement so existing output file symlinks are replaced rather than followed.
- Custom test-plan output parent directories now fail closed if an existing ancestor is a symlink.

## Current Product Posture

Latest readiness result for this repository:

- Status: `guarded`
- Score: `79/100`
- Passing areas:
  - latest verification evidence
  - CI verification gates
  - built-in secret scan
  - Semgrep availability
  - Trivy availability
  - runtime evidence hygiene
- Remaining warnings:
  - Claude Code hard hook wiring is not installed in this repository; advisory project rules exist.
  - GitHub Actions pinning is report-only in config unless `githubActions.requirePinnedActions` is enabled.

These warnings are expected unless this repository intentionally installs project-local Claude hooks and opts into blocking mutable action refs.

## Audit Invariants

Keep these constraints true while editing:

- Do not read or summarize credential files.
- Do not describe advisory project rules as hard enforcement.
- Do not describe missing Semgrep or Trivy as passed.
- Keep hard hooks, advisory guidance, CI enforcement, and report-only findings separate in code and docs.
- Persist only redacted policy/audit evidence.
- Do not commit `.holdthegoblin/` runtime reports.
- Before finishing coding work, run `npm run release:check`.

## Next Milestone

The whole-project audit pass for this session is complete. The next milestone should start from the MCP policy resources work below unless a new blocker appears.

### Whole-Project Audit Scope

Audit these surfaces, even if the current patch did not touch them:

- CLI commands and exit-code behavior.
- Claude hook handling and hard enforcement boundaries.
- MCP stdio and HTTP server security.
- MCP tools and resources.
- Deploy guard policy downgrade and rollback behavior.
- Checkpoint snapshot/rollback path safety.
- Runner process isolation, timeouts, and environment allowlists.
- Scanner execution, parsing, skipped semantics, and evidence redaction.
- Report writers, HTML/Markdown/text output, and GitHub Actions annotations.
- Config schema validation and unsafe config paths.
- Observability export/send behavior.
- Test generation provider behavior and secret handling.
- Package/release workflow and npm tarball contents.
- README/docs claims about hard enforcement, advisory guidance, report-only findings, and scanner behavior.

For each finding, record:

- Severity: blocker, high, medium, low, or informational.
- Evidence: file path and behavior.
- Why it matters.
- Fix recommendation.
- Test expectation.

### Whole-Project Audit Findings

#### MEDIUM - LLM-assisted test generation provider URLs were less strict than observability endpoints

Status: fixed in current patch.

Evidence:

- `src/core/observability.ts` already validated opt-in network-send endpoints for URL credentials, unsafe HTTP, credential-like URL material, and redirects.
- `src/core/llm.ts` accepted user/env provider `baseUrl` values for Ollama, OpenAI-compatible providers, Anthropic, MiniMax, z.ai, Kimi, and DeepSeek without the same endpoint policy.

Why it matters:

- Test generation prompts and edge-case suggestions can include project structure and code risk context.
- A credential-bearing, non-loopback cleartext, or redirecting provider endpoint can leak that context or API authorization headers to an unintended destination.

Fix:

- Added `src/core/url-safety.ts` as a shared endpoint validator.
- Wired `src/core/llm.ts` through the same endpoint class used by observability.
- Set model provider fetch calls to `redirect: "manual"`.

Test expectation:

- `test/testgen.test.ts` rejects URL credentials, non-loopback HTTP, credential-like encoded URL material, and verifies redirects are not followed.

#### MEDIUM - Later-created runtime subdirectories did not all share the core symlink guard

Status: fixed in current patch.

Evidence:

- `src/core/config.ts` protected `.holdthegoblin`, `runs`, `checkpoints`, and `tmp`.
- `src/core/observability.ts` created `.holdthegoblin/exports` directly with `mkdirSync`.
- `src/core/deploy.ts` created `.holdthegoblin/deploy-runs` directly before writing deploy run reports.
- `src/core/checkpoint.ts` read checkpoint `meta.json` files without rejecting symlinked checkpoint entries or symlinked metadata.

Why it matters:

- Runtime reports are redacted, but they are still evidence artifacts and should not be writable outside the project through a symlinked runtime subdirectory.
- Checkpoint metadata controls rollback file selection, so listing and resolving it should fail closed on symlink tampering.

Fix:

- Added `ensureAppDir` in `src/core/config.ts`.
- Routed deploy run reports and observability exports through the shared runtime directory safety check.
- Added checkpoint entry and metadata symlink/root checks before reading metadata.

Test expectation:

- `test/deploy.test.ts` rejects a symlinked deploy report directory.
- `test/observability.test.ts` rejects a symlinked exports directory.
- `test/checkpoint.test.ts` rejects a symlinked checkpoint directory.

#### HIGH - Checkpoint rollback could write through target symlinks

Status: fixed in current patch.

Evidence:

- `src/core/checkpoint.ts` validated rollback file names as safe relative paths.
- Before this fix, rollback copied checkpoint files to the target path without checking whether the target file or an existing target parent directory had been replaced with a symlink after checkpoint creation.

Why it matters:

- Checkpoint rollback is a recovery boundary. If rollback writes through a symlink, a local tamper can redirect restored content outside the project root.
- Deploy rollback depends on checkpoint rollback, so this affects deploy failure recovery too.

Fix:

- Checkpoint source files must be regular files inside the checkpoint `files` directory.
- Existing rollback target parent directories must not be symlinks and must resolve inside the project root.
- Existing rollback target file symlinks are removed and replaced with restored regular files rather than followed.

Test expectation:

- `test/checkpoint.test.ts` verifies target symlinks are replaced without changing the outside target.
- `test/checkpoint.test.ts` verifies symlinked target parent directories fail closed before writing outside the project.

#### MEDIUM - Generated artifact writes could follow output symlinks

Status: fixed in current patch.

Evidence:

- `src/core/observability.ts` wrote provider payload files with direct `writeFileSync`.
- `src/core/testgen.ts` wrote generated test plans with direct `writeFileSync` after lexical root checks.

Why it matters:

- These artifacts are redacted/generated, not raw secrets, but runtime evidence should not be writeable outside the project via symlinked output files or custom output parent directories.

Fix:

- Observability payload writes now use atomic temp-file replacement.
- Test generation validates existing output ancestors against project realpath, rejects symlinked output parent directories, and uses atomic temp-file replacement for the output file.

Test expectation:

- `test/observability.test.ts` verifies output file symlinks are replaced without changing the outside target.
- `test/testgen.test.ts` verifies symlinked output parent directories are rejected and output file symlinks are replaced.

### MCP Policy Resources

Goal: complete the MCP governance surface by exposing read-only resources for policy state without requiring shell commands.

Acceptance criteria:

- Expose a read-only resource for current effective HoldTheGoblin config.
- Expose a read-only resource for enforcement capabilities:
  - Claude Code hard hook wiring detected or not detected.
  - Advisory agent assets detected or not detected.
  - CI verification gate detected or not detected.
  - Semgrep and Trivy configured/found/missing semantics.
  - MCP HTTP auth posture at server startup level where available.
- Expose a read-only resource for recent redacted policy audit decisions.
- Keep returned audit data redacted and capped.
- Do not expose raw command output, raw tool payloads, credential-like values, or `.env` contents.
- Add tests for resource registration, root scoping, redaction, and cap behavior.
- Document resources in README, `examples/mcp/README.md`, architecture, and traceability docs.

## Larger Follow-Up

### Effective Decision Composition

Goal: move from a single built-in risk result to composed enforcement that can combine built-in risk, external policy hook responses, host capability, user approval state, and config downgrade state into one final decision.

This is larger than MCP policy resources and should follow after the resource surface is stable.
