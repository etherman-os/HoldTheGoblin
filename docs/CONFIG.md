# Configuration

HoldTheGoblin reads optional project configuration from `.holdthegoblin/config.json`.

Create it with:

```bash
holdthegoblin init --mode balanced
```

Default shape:

```json
{
  "version": 1,
  "mode": "balanced",
  "failPolicy": {
    "failOnMissingTests": false,
    "failOnTestFailure": true,
    "failOnSecrets": true,
    "semgrepSeverities": ["ERROR"],
    "trivySeverities": ["HIGH", "CRITICAL"]
  },
  "execution": {
    "timeoutMs": 120000,
    "retries": 1
  },
  "security": {
    "secretScan": true,
    "semgrep": true,
    "trivy": true
  },
  "observability": {
    "exportCommands": true,
    "exportFindings": true
  },
  "commands": {}
}
```

## Modes

- `relaxed`: warnings remain warnings unless command failures or configured policies fail.
- `balanced`: default; test failures and secret findings fail, missing tests warn.
- `strict`: missing tests and project-detection warnings fail.

## Custom Commands

Add required verification commands when auto-detection is not enough:

```json
{
  "commands": {
    "javascript": [
      "npm run test:unit",
      "npm run typecheck"
    ]
  }
}
```

Configured commands are treated as required test commands. Their stdout and stderr are redacted before being written to reports.

## Scanner Policy

Semgrep and Trivy are optional external CLIs. If they are missing, HoldTheGoblin reports them as skipped, not passed.

To make Semgrep warnings block:

```json
{
  "failPolicy": {
    "semgrepSeverities": ["WARNING", "ERROR"]
  }
}
```

To disable an external scanner for a repo that cannot run it:

```json
{
  "security": {
    "trivy": false
  }
}
```

Use scanner disablement carefully. In strict release workflows, treat disabled secret or scanner policy as a review item.

## Execution

`timeoutMs` applies per command attempt. HoldTheGoblin terminates the process tree when a command times out. `retries` applies to retryable command failures such as timeouts and transient network errors.

## Observability

Set `exportCommands` or `exportFindings` to `false` if exported payloads should contain less metadata:

```json
{
  "observability": {
    "exportCommands": false,
    "exportFindings": false
  }
}
```

Local verification reports still remain under `.holdthegoblin/`.
