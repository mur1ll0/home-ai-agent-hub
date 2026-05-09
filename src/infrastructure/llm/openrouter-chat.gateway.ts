import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { LlmInteraction } from '../../core/domain/agent-types.js';
import type { LlmTraceContext } from '../../core/ports/agent-services.js';
import type { AppEnv } from '../config/env.js';

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface LlmResponse {
  text: string;
  model: string;
  resolvedModel?: string;
  provider: 'openrouter';
  contextWindowTokens: number;
  usage?: LlmUsage;
}

export interface LlmGateway {
  ask(prompt: string, options?: { operation?: string; systemPrompt?: string }): Promise<string>;
  askWithMeta(prompt: string, options?: { operation?: string; systemPrompt?: string }): Promise<LlmResponse>;
  getModelInfo(): Promise<Pick<LlmResponse, 'model' | 'provider' | 'contextWindowTokens'>>;
}

export class OpenRouterChatGateway implements LlmGateway, LlmTraceContext {
  private readonly model: ChatOpenAI;
  private readonly configuredModel: string;
  private readonly contextWindowTokens: number;
  private readonly openRouterModelsEndpoint: string;
  private readonly openRouterHeaders: Record<string, string>;
  private readonly traceContext = new AsyncLocalStorage<{ traceId: string }>();
  private readonly traceStore = new Map<string, LlmInteraction[]>();
  private readonly traceListeners = new Map<string, (interaction: LlmInteraction) => void>();
  private readonly modelContextById = new Map<string, number>();
  private modelCatalogFetchedAt = 0;
  private modelCatalogFetchPromise: Promise<void> | null = null;

  private readonly savedEnv: AppEnv;

  constructor(env: AppEnv) {
    this.savedEnv = env;
    this.configuredModel = env.OPENROUTER_DEFAULT_MODEL;
    this.contextWindowTokens = env.OPENROUTER_CONTEXT_WINDOW_TOKENS;
    const baseUrl = new URL(env.OPENROUTER_BASE_URL);
    this.openRouterModelsEndpoint = new URL('models', `${baseUrl.origin}/api/v1/`).toString();
    this.openRouterHeaders = {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': env.OPENROUTER_HTTP_REFERER,
      'X-Title': env.OPENROUTER_APP_NAME,
      Accept: 'application/json'
    };
    this.modelContextById.set(this.normalizeModelId(this.configuredModel), this.contextWindowTokens);
    this.model = new ChatOpenAI({
      apiKey: env.OPENROUTER_API_KEY,
      model: this.configuredModel,
      configuration: {
        baseURL: env.OPENROUTER_BASE_URL,
        defaultHeaders: {
          'HTTP-Referer': env.OPENROUTER_HTTP_REFERER,
          'X-Title': env.OPENROUTER_APP_NAME
        }
      }
    });
  }

  forkWithModel(modelId: string): OpenRouterChatGateway {
    return new OpenRouterChatGateway({
      ...this.savedEnv,
      OPENROUTER_DEFAULT_MODEL: modelId
    });
  }

  async ask(prompt: string, options?: { operation?: string; systemPrompt?: string }): Promise<string> {
    const result = await this.askWithMeta(prompt, options);
    return result.text;
  }

  async askWithMeta(prompt: string, options?: { operation?: string; systemPrompt?: string }): Promise<LlmResponse> {
    const startedAt = new Date();

    try {
      const messages = options?.systemPrompt
        ? [new SystemMessage(options.systemPrompt), new HumanMessage(prompt)]
        : prompt;
      const response = await this.model.invoke(messages);
      const finishedAt = new Date();
      const text = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content, null, 2);

      const usageFromMetadata = response.response_metadata as { tokenUsage?: LlmUsage } | undefined;
      const usageFromMessage = response.usage_metadata as
        | { input_tokens?: number; output_tokens?: number; total_tokens?: number }
        | undefined;

      const usageSource = usageFromMetadata?.tokenUsage
        ? {
            inputTokens: usageFromMetadata.tokenUsage.inputTokens,
            outputTokens: usageFromMetadata.tokenUsage.outputTokens,
            totalTokens: usageFromMetadata.tokenUsage.totalTokens
          }
        : usageFromMessage
          ? {
              inputTokens: usageFromMessage.input_tokens,
              outputTokens: usageFromMessage.output_tokens,
              totalTokens: usageFromMessage.total_tokens
            }
          : null;

      const usage: LlmUsage | undefined = usageSource
        ? {
            ...(typeof usageSource.inputTokens === 'number'
              ? { inputTokens: usageSource.inputTokens }
              : {}),
            ...(typeof usageSource.outputTokens === 'number'
              ? { outputTokens: usageSource.outputTokens }
              : {}),
            ...(typeof usageSource.totalTokens === 'number'
              ? { totalTokens: usageSource.totalTokens }
              : {})
          }
        : undefined;

      const metadata = response.response_metadata as
        | {
            model?: string;
            model_name?: string;
            modelName?: string;
          }
        | undefined;
      const resolvedModel = metadata?.model_name ?? metadata?.modelName ?? metadata?.model;
      const usageModel = resolvedModel ?? this.configuredModel;
      const usageContextWindowTokens = await this.resolveContextWindowTokens(usageModel);

      this.recordLlmInteraction({
        provider: 'openrouter',
        configuredModel: this.configuredModel,
        ...(resolvedModel ? { resolvedModel } : {}),
        operation: options?.operation ?? 'llm_request',
        requestPrompt: prompt.slice(0, 8000),
        responseText: text.slice(0, 8000),
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        ...(usage
          ? {
              usage: {
                provider: 'openrouter',
                model: usageModel,
                contextWindowTokens: usageContextWindowTokens,
                ...(typeof usage.inputTokens === 'number' ? { inputTokens: usage.inputTokens } : {}),
                ...(typeof usage.outputTokens === 'number' ? { outputTokens: usage.outputTokens } : {}),
                ...(typeof usage.totalTokens === 'number' ? { totalTokens: usage.totalTokens } : {})
              }
            }
          : {})
      });

      return {
        text,
        model: this.configuredModel,
        ...(resolvedModel ? { resolvedModel } : {}),
        provider: 'openrouter',
        contextWindowTokens: usageContextWindowTokens,
        ...(usage ? { usage } : {})
      };
    } catch (error) {
      const finishedAt = new Date();
      this.recordLlmInteraction({
        provider: 'openrouter',
        configuredModel: this.configuredModel,
        operation: options?.operation ?? 'llm_request',
        requestPrompt: prompt.slice(0, 8000),
        responseText: '',
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async getModelInfo(): Promise<Pick<LlmResponse, 'model' | 'provider' | 'contextWindowTokens'>> {
    // Try to resolve the actual model the OpenRouter 'auto' selector will use.
    const normalized = this.normalizeModelId(this.configuredModel);
    let resolvedModelId: string | undefined;

    // If we don't have a cached context for this model id, or the configured model
    // appears to be an 'auto' selector, perform a lightweight probe to learn the
    // resolved model id that the router will pick for requests.
    const shouldProbe = normalized.includes('auto') || !this.modelContextById.has(normalized);

    if (shouldProbe) {
      try {
        const probeMessages = [new HumanMessage('Please respond only with the model id you are running (one short token), no extra text.')];
        const probeResp = await this.model.invoke(probeMessages);

        const metadata = probeResp.response_metadata as
          | { model?: string; model_name?: string; modelName?: string }
          | undefined;

        resolvedModelId = metadata?.model_name ?? metadata?.modelName ?? metadata?.model;

        if (!resolvedModelId) {
          const rawContent = probeResp.content;
          const contentStr = typeof rawContent === 'string' ? rawContent.trim() : '';
          if (contentStr && contentStr.length < 200) {
            // fallback: use response content if it looks like an id
            const parts = contentStr.split(/\s+/);
            if (parts && parts[0]) {
              resolvedModelId = parts[0].trim();
            }
          }
        }
      } catch {
        // ignore probe failures and fallback to configured model
      }
    }

    const modelToUse = resolvedModelId ?? this.configuredModel;
    const usageContextWindowTokens = await this.resolveContextWindowTokens(modelToUse);

    return {
      model: modelToUse,
      provider: 'openrouter',
      contextWindowTokens: usageContextWindowTokens
    };
  }

  async runWithTrace<T>(traceId: string, operation: () => Promise<T>): Promise<T> {
    this.traceStore.set(traceId, []);
    return this.traceContext.run({ traceId }, operation);
  }

  consumeTrace(traceId: string): LlmInteraction[] {
    const interactions = this.traceStore.get(traceId) ?? [];
    this.traceStore.delete(traceId);
    return interactions;
  }

  peekTrace(traceId: string): LlmInteraction[] {
    return [...(this.traceStore.get(traceId) ?? [])];
  }

  attachTraceListener(traceId: string, listener: (interaction: LlmInteraction) => void): void {
    this.traceListeners.set(traceId, listener);
  }

  detachTraceListener(traceId: string): void {
    this.traceListeners.delete(traceId);
  }

  private recordLlmInteraction(interaction: LlmInteraction): void {
    const trace = this.traceContext.getStore();
    if (!trace?.traceId) {
      return;
    }

    const current = this.traceStore.get(trace.traceId) ?? [];
    current.push(interaction);
    this.traceStore.set(trace.traceId, current);
    this.traceListeners.get(trace.traceId)?.(interaction);
  }

  private normalizeModelId(model: string): string {
    return model.trim().toLowerCase();
  }

  private async resolveContextWindowTokens(model: string): Promise<number> {
    const normalized = this.normalizeModelId(model);
    const cached = this.modelContextById.get(normalized);
    if (typeof cached === 'number' && cached > 0) {
      return cached;
    }

    await this.refreshModelCatalogIfNeeded();
    return this.modelContextById.get(normalized) ?? this.contextWindowTokens;
  }

  private async refreshModelCatalogIfNeeded(): Promise<void> {
    const now = Date.now();
    const ttlMs = 1000 * 60 * 30;
    if (now - this.modelCatalogFetchedAt < ttlMs) {
      return;
    }

    if (this.modelCatalogFetchPromise) {
      await this.modelCatalogFetchPromise;
      return;
    }

    this.modelCatalogFetchPromise = this.fetchAndCacheModelCatalog();
    try {
      await this.modelCatalogFetchPromise;
    } finally {
      this.modelCatalogFetchPromise = null;
    }
  }

  private async fetchAndCacheModelCatalog(): Promise<void> {
    try {
      const response = await fetch(this.openRouterModelsEndpoint, {
        headers: this.openRouterHeaders
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as {
        data?: Array<{ id?: string; context_length?: number; top_provider?: { context_length?: number | null } }>;
      };

      for (const item of payload.data ?? []) {
        const id = item.id?.trim();
        if (!id) {
          continue;
        }

        const contextLength =
          typeof item.context_length === 'number'
            ? item.context_length
            : typeof item.top_provider?.context_length === 'number'
              ? item.top_provider.context_length
              : undefined;

        if (typeof contextLength === 'number' && contextLength > 0) {
          this.modelContextById.set(this.normalizeModelId(id), contextLength);
        }
      }

      this.modelCatalogFetchedAt = Date.now();
    } catch {
      // Mantém fallback local sem interromper execução.
    }
  }
}
