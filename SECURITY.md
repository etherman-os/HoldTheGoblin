# Security Policy

## Supported Versions

Security fixes target the latest released version.

## Reporting A Vulnerability

Please report vulnerabilities privately through GitHub Security Advisories. Do not open public issues containing exploit details, secrets, hostnames, production identifiers, or bypass techniques.

Include:

- Affected version or commit.
- Reproduction steps using a disposable project.
- Expected and actual guard behavior.
- Whether secrets, destructive commands, or rollback behavior are involved.

## Guardrail Scope

HoldTheGoblin reduces risk; it does not replace code review, CI, least-privilege credentials, backups, or production deployment controls.

Hard blocking currently depends on host support. Claude Code hooks can block tool calls. Cursor, Codex, and Warp project rules are advisory unless paired with CI, hooks, or another enforcement layer.
