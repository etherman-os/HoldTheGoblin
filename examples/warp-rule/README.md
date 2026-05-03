# Warp Project Rules Example

`holdthegoblin wrap --agent warp .` writes:

```text
AGENTS.md
WARP.md
.agents/skills/holdthegoblin/SKILL.md
.warp/skills/holdthegoblin/SKILL.md
```

Warp uses `AGENTS.md` as the default project rules file and still supports `WARP.md` for compatibility. These rules steer Warp agents to run HoldTheGoblin verification before completion.

In Warp cloud environments where the global CLI is not installed, the generated rules tell the agent to try a project-local install:

```bash
npm exec -- holdthegoblin verify
```
