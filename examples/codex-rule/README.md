# Codex Project Rules Example

`holdthegoblin wrap --agent codex .` updates `AGENTS.md` and installs HoldTheGoblin skills in `.agents/skills/` and `.codex/skills/` with a guarded completion workflow:

```bash
holdthegoblin verify
npm exec -- holdthegoblin verify
holdthegoblin checkpoint create --note "<task>"
holdthegoblin handoff validate --schema <schema> --input <payload>
holdthegoblin risk assess --command "<command>"
```

This is soft guidance for Codex, not a hard sandbox. Use `holdthegoblin verify` in CI when you need enforcement outside an agent runtime.
