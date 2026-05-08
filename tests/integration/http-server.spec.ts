import { describe, expect, it } from 'vitest';
import { createHttpServer } from '../../src/interfaces/http/create-http-server.js';

describe('HTTP server', () => {
  it('executes /v1/agent/execute route', async () => {
    const useCase = {
      execute: async () => ({
        language: 'pt-BR',
        summary: 'ok',
        steps: ['a'],
        status: 'completed' as const
      })
    };

    const env = {
      APP_MODE: 'http',
      HTTP_HOST: '127.0.0.1',
      HTTP_PORT: 3000,
      HTTP_CORS_ORIGIN: '*',
      HTTP_RATE_LIMIT_MAX: 60,
      HTTP_RATE_LIMIT_WINDOW: '1 minute',
      LANGGRAPH_STUDIO_URL: 'http://localhost:2025'
    } as const;

    const app = await createHttpServer(useCase as never, env as never);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/execute',
      payload: {
        text: 'hello',
        userId: 'u',
        sessionId: 's'
      }
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.summary).toBe('ok');

    await app.close();
  });

  it('serves UI from /', async () => {
    const useCase = {
      execute: async () => ({
        language: 'pt-BR',
        summary: 'ok',
        steps: ['a'],
        status: 'completed' as const
      })
    };

    const env = {
      APP_MODE: 'http',
      HTTP_HOST: '127.0.0.1',
      HTTP_PORT: 3000,
      HTTP_CORS_ORIGIN: '*',
      HTTP_RATE_LIMIT_MAX: 60,
      HTTP_RATE_LIMIT_WINDOW: '1 minute',
      LANGGRAPH_STUDIO_URL: 'http://localhost:2025'
    } as const;

    const app = await createHttpServer(useCase as never, env as never);
    const response = await app.inject({
      method: 'GET',
      url: '/'
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Home AI Agent Hub');

    await app.close();
  });

  it('propagates workspaceRoot and activeFilePath to use case execution', async () => {
    const received: Array<Record<string, unknown>> = [];
    const useCase = {
      execute: async (request: Record<string, unknown>) => {
        received.push(request);
        return {
          language: 'pt-BR',
          summary: 'ok',
          steps: ['a'],
          status: 'completed' as const
        };
      }
    };

    const env = {
      APP_MODE: 'http',
      HTTP_HOST: '127.0.0.1',
      HTTP_PORT: 3000,
      HTTP_CORS_ORIGIN: '*',
      HTTP_RATE_LIMIT_MAX: 60,
      HTTP_RATE_LIMIT_WINDOW: '1 minute',
      LANGGRAPH_STUDIO_URL: 'http://localhost:2025'
    } as const;

    const app = await createHttpServer(useCase as never, env as never);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/execute',
      payload: {
        text: 'leia este arquivo',
        userId: 'u',
        sessionId: 's',
        workspaceRoot: 'F:/repo',
        activeFilePath: 'F:/repo/src/main.ts'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(received[0]?.workspaceRoot).toBe('F:/repo');
    expect(received[0]?.activeFilePath).toBe('F:/repo/src/main.ts');

    await app.close();
  });

  it('redirects to local LangGraph Studio URL', async () => {
    const useCase = {
      execute: async () => ({
        language: 'pt-BR',
        summary: 'ok',
        steps: ['a'],
        status: 'completed' as const
      })
    };

    const env = {
      APP_MODE: 'http',
      HTTP_HOST: '127.0.0.1',
      HTTP_PORT: 3000,
      HTTP_CORS_ORIGIN: '*',
      HTTP_RATE_LIMIT_MAX: 60,
      HTTP_RATE_LIMIT_WINDOW: '1 minute',
      LANGGRAPH_STUDIO_URL: 'http://localhost:2025'
    } as const;

    const app = await createHttpServer(useCase as never, env as never);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/langgraph/open'
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('http://localhost:2025');

    await app.close();
  });
});
