import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { chromium } from 'playwright';
import type { HandleUserRequestUseCase } from '../../core/use-cases/handle-user-request.use-case.js';
import {
  AgentHttpRequestSchema,
  AgentHttpResponseSchema
} from '../contracts/agent-http.contract.js';
import type { AppEnv } from '../../infrastructure/config/env.js';
import type { McpToolConnector } from '../../core/ports/tools.js';

const OLLAMA_API_URL = 'http://localhost:11434';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_FREE_MODELS_LIMIT = 30;
const MODEL_CACHE_TTL_MS = 1000 * 60 * 10;

interface CachedModels<T> {
  data: T;
  fetchedAt: number;
}

export async function createHttpServer(
  useCase: HandleUserRequestUseCase,
  env: AppEnv,
  mcpConnector?: McpToolConnector,
  forkForModel?: (modelId: string) => HandleUserRequestUseCase
): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({ logger: true });
  const langgraphStudioTarget = env.LANGGRAPH_STUDIO_URL ?? 'http://localhost:2025';

  let ollamaModelsCache: CachedModels<Array<{ id: string; name: string; details?: Record<string, unknown> }>> | null = null;
  let openrouterModelsCache: CachedModels<Array<{
    id: string;
    name: string;
    contextLength: number;
    description?: string;
    architecture?: string;
    pricing?: { prompt: string; completion: string };
    topProvider?: { maxCompletionTokens?: number };
  }>> | null = null;

  const progressByRequestId = new Map<
    string,
    {
      events: Array<{
        time: string;
        stage: string;
        message: string;
        tokensTotal?: number;
        inputTokens?: number;
        outputTokens?: number;
        contextWindowTokens?: number;
        contextUsedTokens?: number;
        contextUsedPercent?: number;
        configuredModel?: string;
        resolvedModel?: string;
      }>;
      done: boolean;
      updatedAt: number;
    }
  >();

  await app.register(cors, {
    origin: env.HTTP_CORS_ORIGIN === '*' ? true : env.HTTP_CORS_ORIGIN.split(',').map((item) => item.trim())
  });

  await app.register(rateLimit, {
    max: env.HTTP_RATE_LIMIT_MAX,
    timeWindow: env.HTTP_RATE_LIMIT_WINDOW
  });

  await app.register(fastifyStatic, {
    root: path.resolve('public'),
    prefix: '/'
  });

  app.get('/health', async () => ({ ok: true }));

  app.get('/v1/langgraph/url', async () => ({ url: langgraphStudioTarget }));

  app.get('/v1/langgraph/open', async (_request, reply) => {
    return reply.redirect(langgraphStudioTarget);
  });

  app.get('/v1/models/ollama', async (_request, reply) => {
    const now = Date.now();
    if (ollamaModelsCache && now - ollamaModelsCache.fetchedAt < MODEL_CACHE_TTL_MS) {
      return { models: ollamaModelsCache.data };
    }

    try {
      const response = await fetch(`${OLLAMA_API_URL}/api/tags`, {
        signal: AbortSignal.timeout(2500)
      });
      if (!response.ok) {
        return reply.code(200).send({ models: [], unavailable: true });
      }
      const payload = (await response.json()) as {
        models?: Array<{ name?: string; model?: string; details?: Record<string, unknown> }>;
      };
      const models = (payload.models ?? []).map((m) => ({
        id: `ollama:${m.model ?? m.name ?? ''}`,
        name: m.name ?? m.model ?? '',
        ...(m.details !== undefined ? { details: m.details } : {})
      }));
      ollamaModelsCache = { data: models, fetchedAt: now };
      return { models };
    } catch {
      return reply.code(200).send({ models: [], unavailable: true });
    }
  });

  app.get('/v1/models/openrouter', async (_request, reply) => {
    const now = Date.now();
    if (openrouterModelsCache && now - openrouterModelsCache.fetchedAt < MODEL_CACHE_TTL_MS) {
      return { models: openrouterModelsCache.data };
    }

    try {
      const response = await fetch(OPENROUTER_MODELS_URL, {
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          Accept: 'application/json'
        },
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) {
        return reply.code(200).send({ models: [] });
      }
      const payload = (await response.json()) as {
        data?: Array<{
          id?: string;
          name?: string;
          description?: string;
          context_length?: number;
          architecture?: { tokenizer?: string; modality?: string };
          pricing?: { prompt?: string; completion?: string };
          top_provider?: { context_length?: number | null; max_completion_tokens?: number | null };
        }>;
      };

      const freeModels = (payload.data ?? [])
        .filter(
          (m) =>
            typeof m.id === 'string' &&
            m.id.trim() !== '' &&
            m.pricing?.prompt === '0' &&
            m.pricing?.completion === '0'
        )
        .sort((a, b) => {
          const ctxA =
            typeof a.context_length === 'number'
              ? a.context_length
              : typeof a.top_provider?.context_length === 'number'
                ? a.top_provider.context_length
                : 0;
          const ctxB =
            typeof b.context_length === 'number'
              ? b.context_length
              : typeof b.top_provider?.context_length === 'number'
                ? b.top_provider.context_length
                : 0;
          return ctxB - ctxA;
        })
        .slice(0, OPENROUTER_FREE_MODELS_LIMIT)
        .map((m) => ({
          id: m.id!,
          name: m.name ?? m.id!,
          contextLength:
            typeof m.context_length === 'number'
              ? m.context_length
              : typeof m.top_provider?.context_length === 'number'
                ? m.top_provider.context_length
                : 0,
          ...(m.description !== undefined ? { description: m.description } : {}),
          ...(m.architecture?.modality !== undefined ? { architecture: m.architecture.modality } : {}),
          ...(m.pricing
            ? { pricing: { prompt: m.pricing.prompt ?? '0', completion: m.pricing.completion ?? '0' } }
            : {}),
          ...(m.top_provider?.max_completion_tokens != null
            ? { topProvider: { maxCompletionTokens: m.top_provider.max_completion_tokens } }
            : {})
        }));

      openrouterModelsCache = { data: freeModels, fetchedAt: now };
      return { models: freeModels };
    } catch {
      return reply.code(200).send({ models: [] });
    }
  });

  app.get('/v1/agent/progress/:requestId', async (request) => {
    const params = request.params as { requestId?: string };
    const requestId = params.requestId?.trim();
    const cursorRaw = (request.query as { cursor?: string })?.cursor;
    const cursor = Number.isFinite(Number(cursorRaw)) ? Number(cursorRaw) : 0;

    if (!requestId) {
      return { requestId: '', events: [], done: false, cursor: 0 };
    }

    const state = progressByRequestId.get(requestId);
    if (!state) {
      return { requestId, events: [], done: false, cursor };
    }

    const safeCursor = Math.max(0, Math.min(cursor, state.events.length));
    return {
      requestId,
      events: state.events.slice(safeCursor),
      done: state.done,
      cursor: state.events.length
    };
  });

  app.get('/v1/tools/catalog', async () => {
    const executablePath = chromium.executablePath();
    let playwrightInstalled = true;

    try {
      await access(executablePath);
    } catch {
      playwrightInstalled = false;
    }

    return {
      tools: [
        {
          id: 'file.read',
          tool: 'LocalFileSystemTool.read',
          category: 'filesystem',
          status: 'available'
        },
        {
          id: 'fs.list',
          tool: 'LocalFileSystemTool.list',
          category: 'filesystem',
          status: 'available'
        },
        {
          id: 'web.extract',
          tool: 'PlaywrightWebTool.extract',
          category: 'web',
          status: playwrightInstalled ? 'available' : 'setup_required'
        },
        {
          id: 'doc.create',
          tool: 'OfficeDocumentTool.createWord',
          category: 'office',
          status: 'available'
        },
        {
          id: 'slide.create',
          tool: 'OfficeDocumentTool.createSlides',
          category: 'office',
          status: 'available'
        },
        {
          id: 'sheet.create',
          tool: 'OfficeDocumentTool.createSpreadsheet',
          category: 'office',
          status: 'available'
        },
        {
          id: 'mcp.connect',
          tool: 'McpToolConnector.connect',
          category: 'mcp',
          status: mcpConnector ? 'available' : 'disabled'
        },
        {
          id: 'image.generate',
          tool: 'MediaTool.generateImage',
          category: 'media',
          status: 'available'
        },
        {
          id: 'video.generate',
          tool: 'MediaTool.generateVideo',
          category: 'media',
          status: 'available'
        },
        {
          id: 'model3d.generate',
          tool: 'MediaTool.generate3D',
          category: 'media',
          status: 'available'
        }
      ],
      playwright: {
        installed: playwrightInstalled,
        executablePath,
        headless: env.PLAYWRIGHT_HEADLESS === 'true',
        setupCommand: 'npx playwright install chromium',
        message: playwrightInstalled
          ? 'Playwright Chromium pronto para uso.'
          : 'Playwright está instalado, mas o binário do Chromium não foi encontrado. Rode: npx playwright install chromium'
      },
      mcp: {
        transports: ['sse'],
        quickAddFields: ['serverName', 'transport', 'endpoint']
      }
    };
  });

  app.post('/v1/mcp/connect', async (request, reply) => {
    if (!mcpConnector) {
      return reply.code(503).send({
        error: 'mcp_connector_unavailable',
        message: 'Conector MCP não está disponível neste ambiente.'
      });
    }

    const payload = request.body as {
      serverName?: string;
      transport?: 'stdio' | 'sse';
      endpoint?: string;
    };

    const serverName = payload?.serverName?.trim();
    const transport = payload?.transport ?? 'sse';
    const endpoint = payload?.endpoint?.trim();

    if (!serverName) {
      return reply.code(400).send({ error: 'invalid_server_name' });
    }

    if (transport === 'sse' && !endpoint) {
      return reply.code(400).send({ error: 'invalid_endpoint' });
    }

    try {
      const result = await mcpConnector.connect(serverName, transport, endpoint);
      return reply.code(200).send({ ok: true, message: result });
    } catch (error) {
      request.log.error(error);
      return reply.code(400).send({
        ok: false,
        error: 'mcp_connection_failed',
        message: error instanceof Error ? error.message : 'Falha ao conectar MCP.'
      });
    }
  });

  app.post('/v1/agent/execute', async (request, reply) => {
    const parsed = AgentHttpRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        details: parsed.error.flatten()
      });
    }

    try {
      const requestId = parsed.data.clientRequestId ?? `req-${randomUUID().slice(0, 12)}`;
      const selectedModel = parsed.data.selectedModel?.trim();
      const activeUseCase =
        selectedModel && selectedModel !== 'auto' && forkForModel
          ? forkForModel(selectedModel)
          : useCase;
      const normalizedRequest = {
        text: parsed.data.text,
        userId: parsed.data.userId ?? `web-user-${randomUUID().slice(0, 8)}`,
        sessionId: parsed.data.sessionId ?? `web-session-${Date.now()}`,
        requestId,
        ...(selectedModel ? { selectedModel } : {}),
        ...(parsed.data.workspaceRoot ? { workspaceRoot: parsed.data.workspaceRoot } : {}),
        ...(parsed.data.activeFilePath ? { activeFilePath: parsed.data.activeFilePath } : {}),
        onProgress: (event: {
          stage: string;
          message: string;
          timestamp?: string;
          tokensTotal?: number;
          inputTokens?: number;
          outputTokens?: number;
          contextWindowTokens?: number;
          contextUsedTokens?: number;
          contextUsedPercent?: number;
          configuredModel?: string;
          resolvedModel?: string;
        }) => {
          const current = progressByRequestId.get(requestId) ?? {
            events: [],
            done: false,
            updatedAt: Date.now()
          };

          current.events.push({
            time: event.timestamp ?? new Date().toISOString(),
            stage: event.stage,
            message: event.message,
            ...(typeof event.tokensTotal === 'number' ? { tokensTotal: event.tokensTotal } : {}),
            ...(typeof event.inputTokens === 'number' ? { inputTokens: event.inputTokens } : {}),
            ...(typeof event.outputTokens === 'number' ? { outputTokens: event.outputTokens } : {}),
            ...(typeof event.contextWindowTokens === 'number'
              ? { contextWindowTokens: event.contextWindowTokens }
              : {}),
            ...(typeof event.contextUsedTokens === 'number'
              ? { contextUsedTokens: event.contextUsedTokens }
              : {}),
            ...(typeof event.contextUsedPercent === 'number'
              ? { contextUsedPercent: event.contextUsedPercent }
              : {}),
            ...(event.configuredModel ? { configuredModel: event.configuredModel } : {}),
            ...(event.resolvedModel ? { resolvedModel: event.resolvedModel } : {})
          });
          current.updatedAt = Date.now();
          progressByRequestId.set(requestId, current);
        }
      };

      progressByRequestId.set(requestId, {
        events: [
          {
            time: new Date().toISOString(),
            stage: 'request_start',
            message: 'Requisição recebida pelo backend.'
          }
        ],
        done: false,
        updatedAt: Date.now()
      });

      const result = await activeUseCase.execute(normalizedRequest);
      const state = progressByRequestId.get(requestId);
      if (state) {
        state.done = true;
        state.updatedAt = Date.now();
        progressByRequestId.set(requestId, state);

        setTimeout(() => {
          progressByRequestId.delete(requestId);
        }, 1000 * 60 * 10);
      }

      const response = AgentHttpResponseSchema.parse(result);
      return reply.code(200).send(response);
    } catch (error) {
      request.log.error(error);

      const requestId = parsed.data.clientRequestId?.trim();
      if (requestId) {
        const state = progressByRequestId.get(requestId) ?? {
          events: [],
          done: false,
          updatedAt: Date.now()
        };
        state.events.push({
          time: new Date().toISOString(),
          stage: 'request_failed',
          message: error instanceof Error ? error.message : 'Falha inesperada na execução.'
        });
        state.done = true;
        state.updatedAt = Date.now();
        progressByRequestId.set(requestId, state);
      }

      const errorMessage = error instanceof Error ? error.message : 'Falha inesperada na execução.';
      const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';

      const fallback = AgentHttpResponseSchema.parse({
        language: 'pt-BR',
        status: 'rejected',
        summary: errorMessage,
        steps: [
          `Tipo: ${errorType}`,
          'Verifique os logs do servidor para o stack trace completo.',
          'Se for um caminho de arquivo inválido, tente especificar o caminho absoluto correto.'
        ],
        executionReport: {
          error: errorMessage,
          errorType,
          requestId: parsed.data.clientRequestId ?? null
        }
      });

      return reply.code(200).send(fallback);
    }
  });

  app.get('/', async (_request, reply) => reply.sendFile('index.html'));

  return app;
}
