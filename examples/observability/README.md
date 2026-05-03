# Observability Export Example

Run verification first:

```bash
holdthegoblin verify
```

Write local Langfuse and AgentOps-compatible payloads:

```bash
holdthegoblin observability export --provider all
```

Send to Langfuse legacy ingestion only when credentials are configured:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-... \
LANGFUSE_SECRET_KEY=sk-lf-... \
LANGFUSE_BASE_URL=https://cloud.langfuse.com \
holdthegoblin observability export --provider langfuse --send
```

AgentOps v2 is OpenTelemetry-based. HoldTheGoblin writes an OTLP-style JSON payload locally and can POST it to a relay you control with:

```bash
AGENTOPS_API_KEY=... \
AGENTOPS_INGEST_URL=https://your-otel-relay.example/holdthegoblin \
holdthegoblin observability export --provider agentops --send
```
