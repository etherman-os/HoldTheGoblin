# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | Best effort only |

## Reporting A Vulnerability

Please report vulnerabilities privately through GitHub Security Advisories. Do not open public issues containing exploit details, secrets, hostnames, production identifiers, or bypass techniques.

If GitHub Security Advisories are unavailable for your account, open a public issue that only says a private security report is needed. Do not include the reproduction or bypass details in that issue.

Include:

- Affected version or commit.
- Reproduction steps using a disposable project.
- Expected and actual guard behavior.
- Whether secrets, destructive commands, or rollback behavior are involved.

For guard bypasses, use a disposable project and fake credentials only.

## Guardrail Scope

HoldTheGoblin reduces risk; it does not replace code review, CI, least-privilege credentials, backups, or production deployment controls.

Hard blocking currently depends on host support. Claude Code hooks can block tool calls. Cursor, Codex, and Warp project rules are advisory unless paired with CI, hooks, or another enforcement layer.
