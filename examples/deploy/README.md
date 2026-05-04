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

Use `argv` arrays in deploy plans so commands run without a shell. Use `--dry-run` to inspect phase order and command risk without running commands.

Deploy commands inherit only a minimal safe environment by default. Add `env` key names to a command only when a reviewed deploy step needs those variables from the current process.

Human-review `ask` rules require both `allowDangerous: true` in the reviewed plan and an explicit `--allow-dangerous` run flag. Hard-deny rules cannot be bypassed.

Disabling verification, checkpointing, checkpoint rollback, or promotion health gates is treated as a policy downgrade and also needs both `allowPolicyDowngrade: true` and `--allow-dangerous`.
