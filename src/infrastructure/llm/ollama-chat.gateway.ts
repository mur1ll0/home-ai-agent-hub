import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { LlmInteraction } from '../../core/domain/agent-types.js';
import type { LlmTraceContext } from '../../core/ports/agent-services.js';
import type { LlmGateway, LlmResponse, LlmUsage } from './openrouter-chat.gateway.js';

const OLLAMA_BASE_URL = 'http://localhost:11434/v1';
const OLLAMA_DEFAULT_CONTEXT_WINDOW = 8192;

export class OllamaChatGateway implements LlmGateway, LlmTraceContext {
  private readonly llm: ChatOpenAI;
  private readonly modelId: string;
  private readonly traceContext = new AsyncLocalStorage<{ traceId: string }>();
  private readonly traceStore = new Map<string, LlmInteraction[]>();
  private readonly traceListeners = new Map<string, (interaction: LlmInteraction) => void>();

  constructor(modelId: string) {
    this.modelId = modelId;
    this.llm = new ChatOpenAI({
      apiKey: 'ollama',
      model: modelId,
      configuration: {
        baseURL: OLLAMA_BASE_URL
      }
    });
  }

  async ask(prompt: string, options?: { operation?: string; systemPrompt?: string }): Promise<string> {
    return (await this.askWithMeta(prompt, options)).text;
  }

  async askWithMeta(prompt: string, options?: { operation?: string; systemPrompt?: string }): Promise<LlmResponse> {
    const startedAt = new Date();
    try {
      const messages = options?.systemPrompt
        ? [new SystemMessage(options.systemPrompt), new HumanMessage(prompt)]
        : prompt;
      const response = await this.llm.invoke(messages);
      const finishedAt = new Date();
      const text =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content, null, 2);

      const usageFromMessage = response.usage_metadata as
        | { input_tokens?: number; output_tokens?: number; total_tokens?: number }
        | undefined;

      const usage: LlmUsage | undefined = usageFromMessage
        ? {
            ...(typeof usageFromMessage.input_tokens === 'number'
              ? { inputTokens: usageFromMessage.input_tokens }
              : {}),
            ...(typeof usageFromMessage.output_tokens === 'number'
              ? { outputTokens: usageFromMessage.output_tokens }
              : {}),
            ...(typeof usageFromMessage.total_tokens === 'number'
              ? { totalTokens: usageFromMessage.total_tokens }
              : {})
          }
        : undefined;

      this.recordLlmInteraction({
        provider: 'ollama',
        configuredModel: this.modelId,
        operation: options?.operation ?? 'llm_request',
        requestPrompt: prompt.slice(0, 8000),
        responseText: text.slice(0, 8000),
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        ...(usage
          ? {
              usage: {
                provider: 'ollama',
                model: this.modelId,
                contextWindowTokens: OLLAMA_DEFAULT_CONTEXT_WINDOW,
                ...usage
              }
            }
          : {})
      });

      return {
        text,
        model: this.modelId,
        provider: 'openrouter',
        contextWindowTokens: OLLAMA_DEFAULT_CONTEXT_WINDOW,
        ...(usage ? { usage } : {})
      };
    } catch (error) {
      const finishedAt = new Date();
      this.recordLlmInteraction({
        provider: 'ollama',
        configuredModel: this.modelId,
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
    return {
      model: this.modelId,
      provider: 'openrouter',
      contextWindowTokens: OLLAMA_DEFAULT_CONTEXT_WINDOW
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
}
