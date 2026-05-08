import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

export interface AgentExecuteRequest {
  text: string;
  userId?: string;
  sessionId?: string;
  clientRequestId?: string;
  workspaceRoot?: string;
  activeFilePath?: string;
  configuredModel?: string;
}

export interface AgentExecuteResponse {
  language: string;
  summary: string;
  steps: string[];
  status?: 'completed' | 'pending_confirmation' | 'rejected';
  confirmationToken?: string;
  approvalDescription?: string;
  executionReport?: Record<string, unknown>;
}

export interface ProgressEvent {
  time: string;
  stage: string;
  message: string;
  tokensTotal?: number;
}

export interface ProgressState {
  requestId: string;
  events: ProgressEvent[];
  done: boolean;
  cursor: number;
}

export class AgentClient {
  constructor(private readonly serverUrl: string) {}

  async execute(request: AgentExecuteRequest, signal?: AbortSignal): Promise<AgentExecuteResponse> {
    const body = JSON.stringify(request);
    const url = new URL('/v1/agent/execute', this.serverUrl);
    const data = await this.post(url, body, signal);
    return data as AgentExecuteResponse;
  }

  async pollProgress(
    requestId: string,
    cursor: number,
    signal?: AbortSignal
  ): Promise<ProgressState> {
    const url = new URL(`/v1/agent/progress/${encodeURIComponent(requestId)}`, this.serverUrl);
    url.searchParams.set('cursor', String(cursor));
    const data = await this.get(url, signal);
    return data as ProgressState;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const url = new URL('/health', this.serverUrl);
      const data = await this.get(url);
      return (data as { ok?: boolean }).ok === true;
    } catch {
      return false;
    }
  }

  async pingStatus(): Promise<{ ok: boolean; error?: string }> {
    try {
      const url = new URL('/health', this.serverUrl);
      const data = await this.get(url);
      const ok = (data as { ok?: boolean }).ok === true;
      return { ok };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  private get(url: URL, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('Request aborted'));
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.get(url.toString(), { timeout: 10000 }, (res) => {
        let raw = '';
        res.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error(`JSON parse error: ${raw.slice(0, 200)}`)); }
        });
      });
      const onAbort = () => { req.destroy(new Error('Request aborted')); };
      signal?.addEventListener('abort', onAbort);
      req.on('error', (err) => { signal?.removeEventListener('abort', onAbort); reject(err); });
      req.on('timeout', () => { signal?.removeEventListener('abort', onAbort); req.destroy(); reject(new Error('Request timed out')); });
    });
  }

  private post(url: URL, body: string, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('Request aborted'));
      const lib = url.protocol === 'https:' ? https : http;
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 120000
      };

      const req = lib.request(url.toString(), options, (res) => {
        let raw = '';
        res.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error(`JSON parse error: ${raw.slice(0, 200)}`)); }
        });
      });

      const onAbort = () => { req.destroy(new Error('Request aborted')); };
      signal?.addEventListener('abort', onAbort);
      req.on('error', (err) => { signal?.removeEventListener('abort', onAbort); reject(err); });
      req.on('timeout', () => { signal?.removeEventListener('abort', onAbort); req.destroy(); reject(new Error('Request timed out')); });
      req.write(body);
      req.end();
    });
  }

  async getModels(): Promise<{ openrouter?: unknown; ollama?: unknown }> {
    const results: { openrouter?: unknown; ollama?: unknown } = {};
    try {
      const url = new URL('/v1/models/openrouter', this.serverUrl);
      results.openrouter = await this.get(url);
    } catch {
      results.openrouter = undefined;
    }

    try {
      const url2 = new URL('/v1/models/ollama', this.serverUrl);
      results.ollama = await this.get(url2);
    } catch {
      results.ollama = undefined;
    }

    return results;
  }

  async cancel(requestId: string): Promise<boolean> {
    try {
      const url = new URL('/v1/agent/cancel', this.serverUrl);
      await this.post(url, JSON.stringify({ requestId }));
      return true;
    } catch {
      return false;
    }
  }
}
