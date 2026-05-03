# Deploy Guard Example

Create a deploy plan:

```bash
holdthegoblin deploy init --output holdthegoblin.deploy.json
```

Run it:

```bash
holdthegoblin deploy run --plan examples/deploy/holdthegoblin.deploy.json
```

The deploy guard runs verification first, creates a local checkpoint, runs shadow and canary commands, checks health commands, and runs rollback commands plus checkpoint restore if a deploy phase fails.

Use `--dry-run` to inspect the phase order without running commands.

Human-review `ask` rules require both `allowDangerous: true` in the reviewed plan and an explicit `--allow-dangerous` run flag. Hard-deny rules cannot be bypassed.
