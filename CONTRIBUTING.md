# Contributing

HoldTheGoblin is a safety tool, so changes should be small, testable, and honest about enforcement boundaries.

## Development Setup

```bash
npm ci
npm run typecheck
npm test
npm run smoke
npm run package:smoke
npm run demo:db-delete
```

Before opening a pull request, run:

```bash
npm run release:check
```

## Change Standards

- Keep hard enforcement and advisory guidance clearly separated in docs and code.
- Add or update tests for verifier behavior, hook decisions, risk policy, handoff validation, and scanner parsing.
- Do not add network calls to verification without a local-first fallback and clear documentation.
- Do not print secrets in errors, reports, events, or test fixtures.
- Prefer deterministic checks over LLM-generated claims unless the result is verified by commands.

## Release Checklist

1. `npm run release:check`
2. Confirm `README.md`, `CHANGELOG.md`, and examples match the shipped behavior.
3. Confirm the installed-package smoke test and package dry-run include `dist/src`, `examples`, `README.md`, and `LICENSE`.
4. Confirm `PRIVACY.md` and `docs/CONFIG.md` still match data egress and config behavior.
5. Publish only from a clean working tree and an annotated tag named `v<package.json version>`. Pushing the tag runs release checks in a read-only job, then a separate publish job creates or updates the GitHub Release from the packed tarball. npm publishing uses that same tarball and stays disabled unless repository variable `NPM_PUBLISH_ENABLED=true` and secret `NPM_TOKEN` are configured.
