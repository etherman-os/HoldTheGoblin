# MCP Server Example

Run the local stdio MCP server:

```bash
holdthegoblin mcp
holdthegoblin mcp-http --host 127.0.0.1 --port 3333
```

When binding `mcp-http` outside loopback, set `HOLDTHEGOBLIN_MCP_HTTP_TOKEN` or `--auth-token` and pass at least one `--allowed-host`.

Use this shape in MCP-capable clients:

```json
{
  "mcpServers": {
    "holdthegoblin": {
      "command": "holdthegoblin",
      "args": ["mcp"]
    }
  }
}
```

The server exposes:

- `verify`
- `doctor`
- `checkpoint_create`
- `checkpoint_list`
- `checkpoint_rollback`
- `handoff_validate`
- `events`
- `deploy_run`
- `observability_export`
- `tests_generate`
- `models_providers`

Use `verify` as the completion gate, `checkpoint_create` before risky edits, `handoff_validate` when one agent passes structured output to another, and `deploy_run` for guarded shadow/canary deploy plans.
