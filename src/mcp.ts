import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';
import { createCheckpoint, listCheckpoints, rollbackCheckpoint } from './core/checkpoint.js';
import { detectProject } from './core/detect.js';
import { runDeployPlan } from './core/deploy.js';
import { readEvents } from './core/events.js';
import { findGitRoot } from './core/git.js';
import { validateHandoffFiles } from './core/handoff.js';
import { loadConfig } from './core/config.js';
import { listModelProviders } from './core/llm.js';
import { exportObservability } from './core/observability.js';
import { renderMarkdownReport, renderTextSummary } from './core/output.js';
import { isInsidePath, resolveInsideProject } from './core/paths.js';
import { generateTests } from './core/testgen.js';
import { verify } from './core/verify.js';

const rootSchema = {
  root: z.string().optional().describe('Project directory. Defaults to the current working directory.'),
};

export interface McpServerOptions {
  root?: string;
}

export async function runMcpServer(options: McpServerOptions = {}): Promise<void> {
  const server = createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export async function runMcpHttpServer(options: { host: string; port: number; allowedHosts?: string[]; authToken?: string; root?: string }): Promise<void> {
  if (!isLoopbackHost(options.host) && !options.authToken) {
    throw new Error('mcp-http requires --auth-token or HOLDTHEGOBLIN_MCP_HTTP_TOKEN when binding outside loopback.');
  }
  if (!isLoopbackHost(options.host) && (!options.allowedHosts || options.allowedHosts.length === 0)) {
    throw new Error('mcp-http requires at least one --allowed-host when binding outside loopback.');
  }
  if (!isLoopbackHost(options.host) && options.authToken && options.authToken.length < 16) {
    throw new Error('mcp-http auth token must be at least 16 characters when binding outside loopback.');
  }
  const app = createMcpExpressApp({
    host: options.host,
    allowedHosts: options.allowedHosts && options.allowedHosts.length > 0 ? options.allowedHosts : undefined,
  });
  app.use('/mcp', (req: any, res: any, next: any) => {
    if (!options.authToken) return next();
    const expected = `Bearer ${options.authToken}`;
    if (req.headers.authorization === expected) return next();
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized.' }, id: null });
  });
  app.post('/mcp', async (req: any, res: any) => {
    const server = createMcpServer({ root: options.root });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const cleanup = () => {
      void transport.close();
      void server.close();
    };
    res.on('close', cleanup);
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: error instanceof Error ? error.message : 'Internal server error' },
          id: null,
        });
      }
      cleanup();
    }
  });
  app.get('/mcp', (_req: any, res: any) => {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  });
  app.delete('/mcp', (_req: any, res: any) => {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  });

  await new Promise<void>((resolve, reject) => {
    const listener = app.listen(options.port, options.host, (error?: Error) => {
      if (error) reject(error);
      else {
        process.stderr.write(`HoldTheGoblin MCP HTTP listening on http://${options.host}:${options.port}/mcp\n`);
        resolve();
      }
    });
    listener.on('error', reject);
  });
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export function createMcpServer(options: McpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: 'holdthegoblin',
    version: '0.1.2',
  });
  const launchRoot = options.root;
  const resolveServerRoot = async (root?: string): Promise<string> => {
    const base = launchRoot ?? process.cwd();
    const projectRoot = await findGitRoot(root ?? base);
    if (launchRoot && !isInsidePath(launchRoot, projectRoot)) {
      throw new Error(`MCP root escapes server root: ${root ?? projectRoot}`);
    }
    return projectRoot;
  };

  server.registerTool(
    'verify',
    {
      title: 'Run HoldTheGoblin verification',
      description: 'Run tests, security checks, edge-case detection, and evidence report generation for a project.',
      inputSchema: {
        ...rootSchema,
        format: z.enum(['text', 'json', 'markdown']).optional().describe('Response format. Defaults to text.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ root, format }) => {
      const projectRoot = await resolveServerRoot(root);
      const result = await verify({ root: projectRoot });
      const text = format === 'json'
        ? JSON.stringify(result, null, 2)
        : format === 'markdown'
          ? renderMarkdownReport(result)
          : renderTextSummary(result);
      return {
        isError: !result.ok,
        content: [{ type: 'text', text }],
      };
    }
  );

  server.registerTool(
    'doctor',
    {
      title: 'Inspect HoldTheGoblin project setup',
      description: 'Detect project type, planned verification commands, and scanner configuration.',
      inputSchema: rootSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ root }) => {
      const projectRoot = await resolveServerRoot(root);
      const config = loadConfig(projectRoot);
      const detection = detectProject(projectRoot, config);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            root: projectRoot,
            mode: config.mode,
            kinds: detection.kinds,
            testCommands: detection.testCommands,
            securityCommands: detection.securityCommands,
            warnings: detection.warnings,
          }, null, 2),
        }],
      };
    }
  );

  server.registerTool(
    'checkpoint_create',
    {
      title: 'Create a local checkpoint',
      description: 'Snapshot project files before risky agent work.',
      inputSchema: {
        ...rootSchema,
        note: z.string().optional().describe('Optional checkpoint note.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ root, note }) => {
      const projectRoot = await resolveServerRoot(root);
      const checkpoint = await createCheckpoint(projectRoot, note);
      return {
        content: [{ type: 'text', text: JSON.stringify(checkpoint, null, 2) }],
      };
    }
  );

  server.registerTool(
    'checkpoint_list',
    {
      title: 'List local checkpoints',
      description: 'List HoldTheGoblin checkpoints for the project.',
      inputSchema: rootSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ root }) => {
      const projectRoot = await resolveServerRoot(root);
      return {
        content: [{ type: 'text', text: JSON.stringify(listCheckpoints(projectRoot), null, 2) }],
      };
    }
  );

  server.registerTool(
    'checkpoint_rollback',
    {
      title: 'Rollback to a checkpoint',
      description: 'Restore files from a HoldTheGoblin checkpoint. This mutates the working tree.',
      inputSchema: {
        ...rootSchema,
        id: z.string().optional().describe('Checkpoint id or latest. Defaults to latest.'),
        deleteNew: z.boolean().optional().describe('Delete files created after the checkpoint. Defaults to false.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({ root, id, deleteNew }) => {
      const projectRoot = await resolveServerRoot(root);
      const checkpoint = rollbackCheckpoint(projectRoot, id ?? 'latest', deleteNew === true);
      return {
        content: [{ type: 'text', text: JSON.stringify(checkpoint, null, 2) }],
      };
    }
  );

  server.registerTool(
    'handoff_validate',
    {
      title: 'Validate a multi-agent handoff payload',
      description: 'Validate a JSON payload against a JSON schema file.',
      inputSchema: {
        ...rootSchema,
        schema: z.string().describe('Path to the JSON schema file.'),
        input: z.string().describe('Path to the JSON payload file.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ root, schema, input }) => {
      const projectRoot = await resolveServerRoot(root);
      const result = validateHandoffFiles(resolveInsideProject(projectRoot, schema), resolveInsideProject(projectRoot, input));
      return {
        isError: !result.ok,
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.registerTool(
    'events',
    {
      title: 'Read HoldTheGoblin event log',
      description: 'Read recent HoldTheGoblin events from the local project.',
      inputSchema: {
        ...rootSchema,
        limit: z.number().int().positive().max(100).optional().describe('Maximum events to return. Defaults to 20.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ root, limit }) => {
      const projectRoot = await resolveServerRoot(root);
      return {
        content: [{ type: 'text', text: JSON.stringify(readEvents(projectRoot, limit ?? 20), null, 2) }],
      };
    }
  );

  server.registerTool(
    'deploy_run',
    {
      title: 'Run a guarded deploy plan',
      description: 'Run verification, shadow/canary commands, health checks, and rollback from a deploy plan.',
      inputSchema: {
        ...rootSchema,
        planPath: z.string().describe('Path to holdthegoblin.deploy.json.'),
        dryRun: z.boolean().optional().describe('When true, list phases without running commands.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({ root, planPath, dryRun }) => {
      const projectRoot = await resolveServerRoot(root);
      const result = await runDeployPlan({ root: projectRoot, planPath, dryRun });
      return {
        isError: !result.ok,
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.registerTool(
    'observability_export',
    {
      title: 'Export verification evidence to observability payloads',
      description: 'Write Langfuse and/or AgentOps-compatible payloads for the latest verification run.',
      inputSchema: {
        ...rootSchema,
        provider: z.enum(['langfuse', 'agentops', 'all']).optional().describe('Provider to export. Defaults to all.'),
        run: z.string().optional().describe('Optional run JSON path, relative to root unless absolute.'),
        send: z.boolean().optional().describe('When true, send to configured provider endpoints. Defaults to false.'),
        sendTimeoutMs: z.number().int().positive().optional().describe('Send timeout in milliseconds.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ root, provider, run, send, sendTimeoutMs }) => {
      const projectRoot = await resolveServerRoot(root);
      const result = await exportObservability({ root: projectRoot, provider: provider ?? 'all', run, send, sendTimeoutMs });
      return {
        isError: !result.every((item) => item.ok),
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.registerTool(
    'tests_generate',
    {
      title: 'Generate a focused test plan',
      description: 'Generate deterministic or LLM-assisted test suggestions from risky changed code paths.',
      inputSchema: {
        ...rootSchema,
        provider: z.enum(['deterministic', 'ollama', 'ollama-cloud', 'openai-compatible', 'openai', 'groq', 'openrouter', 'anthropic', 'minimax', 'zai', 'kimi', 'deepseek']).optional().describe('Generation provider. Defaults to deterministic.'),
        model: z.string().optional().describe('Model id for LLM providers.'),
        baseUrl: z.string().optional().describe('Optional provider base URL override.'),
        timeoutMs: z.number().int().positive().optional().describe('Provider timeout in milliseconds.'),
        output: z.string().optional().describe('Output markdown path.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ root, provider, model, baseUrl, timeoutMs, output }) => {
      const projectRoot = await resolveServerRoot(root);
      const result = await generateTests({ root: projectRoot, provider: provider ?? 'deterministic', model, baseUrl, timeoutMs, output });
      return {
        isError: !result.ok,
        content: [{ type: 'text', text: JSON.stringify({ ...result, content: undefined }, null, 2) }],
      };
    }
  );

  server.registerTool(
    'models_providers',
    {
      title: 'List supported model providers',
      description: 'List external subscription and local model providers supported by HoldTheGoblin test generation.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(listModelProviders(), null, 2) }],
    })
  );

  return server;
}
