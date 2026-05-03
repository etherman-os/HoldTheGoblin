# Privacy And Data Egress

HoldTheGoblin is local-first. The default `verify`, `checkpoint`, `hook`, `doctor`, `events`, `deploy`, and deterministic `tests generate` flows do not send source code or reports to a third-party service.

## Local Reads

HoldTheGoblin may read:

- Project manifests such as `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, Maven and Gradle files.
- Source files for built-in secret scanning and edge-case test suggestions.
- Git metadata for changed-file detection and checkpoint candidate selection.
- `.holdthegoblin/config.json` when present.

Credential-like stores such as `.env*`, `.npmrc`, `.netrc`, SSH keys, cloud credential folders, Kubernetes config, Docker auth config, and private key files are treated as sensitive paths. Hooks deny direct access to them where hard hooks are available, and checkpoints skip them.

## Local Writes

Runtime artifacts are written under `.holdthegoblin/`:

- `latest.md` and `runs/*` verification evidence.
- `events.jsonl` event history.
- `checkpoints/*` local rollback snapshots.
- `deploy-latest.json` guarded deploy evidence.
- `generated-tests.md` deterministic or provider-assisted test plans.
- `exports/*` observability payloads.

These runtime artifacts should normally stay uncommitted.

## Network Egress

Network egress is opt-in:

- `tests generate --provider <llm-provider>` sends a compact test-planning prompt built from edge-case suggestions to the selected provider.
- `observability export --send` sends provider-shaped verification metadata to configured Langfuse or AgentOps-compatible endpoints.
- Optional Semgrep and Trivy commands may use their own network behavior depending on how those tools are installed and configured.

Without those explicit choices, HoldTheGoblin keeps evidence local.

## Redaction

HoldTheGoblin redacts common credential-like forms from command output, reports, events, deploy evidence, observability payloads, and model-provider errors. This includes common API keys, GitHub/GitLab/npm/Slack tokens, AWS access keys, private-key blocks, bearer headers, JWTs, URL credentials, and sensitive object keys.

Redaction is defense-in-depth, not a guarantee that every possible secret format is recognized. Do not intentionally feed production secrets to agents or reports.
