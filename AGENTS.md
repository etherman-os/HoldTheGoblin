## HoldTheGoblin Project Rules

This repository is a safety tool. Keep enforcement claims precise and evidence-backed.

Before finishing coding work:

1. Run `npm run release:check`.
2. If only a narrow edit was made, at minimum run the relevant focused test plus `npm run verify:self`.
3. Treat failed tests, failed self-verification, leaked credential-like output, and package dry-run failures as blocking.
4. Do not read, print, summarize, or commit credential files such as `.env`, private keys, SSH keys, cloud credential stores, or production secrets.
5. If Semgrep or Trivy are missing, report them as skipped rather than passed.
6. Keep hard enforcement, advisory agent guidance, and report-only behavior clearly separated in code and docs.
7. Add or update tests for guard behavior, risk policy, deploy/checkpoint rollback, scanner parsing, MCP tools, and evidence redaction.
8. When reporting completion, cite `.holdthegoblin/latest.md` only as local evidence; do not commit runtime reports.


<claude-mem-context>
# Memory Context

# [HoldTheGoblin] recent context, 2026-05-09 3:21am GMT+3

No previous sessions found.
</claude-mem-context>