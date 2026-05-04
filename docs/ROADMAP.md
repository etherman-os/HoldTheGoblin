# Roadmap

HoldTheGoblin is a safety tool, so roadmap items need measurable enforcement or evidence value.

## Now

- Harden command execution and scanner evidence handling.
  Acceptance: timed-out commands terminate process trees, structured scanner output cannot be silently truncated into a skipped pass, and tests cover both cases.
- Broaden sensitive-path and redaction coverage.
  Acceptance: hooks/checkpoints/reports cover common local credential stores and token formats.
- Improve OSS trust basics.
  Acceptance: CI permissions are explicit, publish provenance workflow exists, package smoke tests run from an installed tarball, privacy/config docs are present, and release checks remain green.
- Policy downgrade detection.
  Acceptance: disabling verification, checkpointing, secret scanning, or test failure blocking is surfaced as a blocking finding in strict/release workflows unless explicitly approved outside repo-controlled files.
- Config validation and schema.
  Acceptance: `.holdthegoblin/config.json` has a documented JSON schema and `config validate` reports precise errors.
- First-class downstream GitHub Action template.
  Acceptance: users can add a copy-paste workflow that runs `holdthegoblin verify` on pull requests.
- HTML evidence report.
  Acceptance: local report renders checks, findings, edge-case suggestions, and command summaries, redacts known secret patterns before rendering, and escapes report values.
- CI annotation summary.
  Acceptance: GitHub Actions can publish a concise Markdown step summary that points to the local evidence artifact.
- CI annotation diagnostics.
  Acceptance: optional GitHub workflow commands can annotate failed checks, failed commands, warnings/skips, and scanner findings without including raw command stdout/stderr or changing verification exit semantics.
- Scanner installation recipes.
  Acceptance: docs and the downstream workflow show optional Semgrep/Trivy setup paths while keeping missing scanners reported as skipped, not passed.
- Workflow action pinning audit.
  Acceptance: verification reports external GitHub Actions refs that are not pinned to full commit SHAs without changing verification exit semantics.
- Workflow action pinning policy controls.
  Acceptance: repos can opt into blocking unpinned external action refs in strict/release workflows with documented allowlists.

## Next

- Workflow action pinning autofix guidance.
  Acceptance: evidence reports include actionable guidance for replacing mutable GitHub Action refs with reviewed commit SHAs.

## Later

- Organization policy management.
- Signed release provenance beyond npm provenance where useful.
- Native package split for framework adapters if demand justifies separate installs.
- Deeper OpenAI Agents SDK adapter once its stable hook surface is settled for this use case.

## Non-Goals

- Claiming advisory rules are hard sandboxing.
- Claiming skipped external scanners passed.
- Replacing production backups, least-privilege credentials, code review, or CI branch protection.
