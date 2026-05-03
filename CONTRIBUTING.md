# Contributing

HoldTheGoblin is a safety tool, so changes should be small, testable, and honest about enforcement boundaries.

## Development Setup

```bash
npm ci
npm run typecheck
npm test
npm run smoke
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
3. Confirm the package dry-run includes `dist/src`, `examples`, `README.md`, and `LICENSE`.
4. Publish only from a clean working tree.
