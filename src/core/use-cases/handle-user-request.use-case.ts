import {
  type ActionPlan,
  isDestructiveAction,
  type AgentRequest,
  type AgentResponse,
  type ExecutionReport,
  type ExecutionStage,
  type MemoryOperation,
  type MemoryReport,
  type ModelUsage,
  type RuntimeResources
} from '../domain/agent-types.js';
import { SafetyApprovalRequiredError } from '../domain/safety-errors.js';
import type {
  ActionExecutor,
  AuditLogger,
  ConfirmationManager,
  InstructionComposer,
  IntentClassifier,
  LanguageDetector,
  LlmTraceContext,
  MemoryGateway,
  SafetyGuard,
  SkillRegistry
} from '../ports/agent-services.js';

export class HandleUserRequestUseCase {
  constructor(
    private readonly intentClassifier: IntentClassifier,
    private readonly safetyGuard: SafetyGuard,
    private readonly languageDetector: LanguageDetector,
    private readonly actionExecutor: ActionExecutor,
    private readonly confirmationManager: ConfirmationManager,
    private readonly auditLogger: AuditLogger,
    private readonly memoryGateway?: MemoryGateway,
    private readonly llmTraceContext?: LlmTraceContext,
    private readonly skillRegistry?: SkillRegistry,
    private readonly instructionComposer?: InstructionComposer
  ) {}

  async execute(request: AgentRequest): Promise<AgentResponse> {
    const startedAt = new Date();
    const startedAtMs = Date.now();
    const requestId = request.requestId ?? `${request.sessionId}-${startedAtMs}`;

    if (this.llmTraceContext) {
      this.llmTraceContext.attachTraceListener(requestId, (interaction) => {
        const usage = interaction.usage;
        const tokensTotal = this.sumTraceTokens(requestId);
        const contextWindowTokens = usage?.contextWindowTokens;
        const contextUsedTokens = typeof tokensTotal === 'number' ? tokensTotal : undefined;
        const contextUsedPercent =
          typeof contextWindowTokens === 'number' && typeof contextUsedTokens === 'number' && contextWindowTokens > 0
            ? Number(((contextUsedTokens / contextWindowTokens) * 100).toFixed(2))
            : undefined;

        request.onProgress?.({
          stage: 'llm_interaction',
          message: `OpenRouter chamou ${interaction.resolvedModel ?? interaction.configuredModel}.`,
          timestamp: interaction.finishedAt,
          ...(typeof tokensTotal === 'number' ? { tokensTotal } : {}),
          ...(typeof usage?.inputTokens === 'number' ? { inputTokens: usage.inputTokens } : {}),
          ...(typeof usage?.outputTokens === 'number' ? { outputTokens: usage.outputTokens } : {}),
          ...(typeof contextWindowTokens === 'number' ? { contextWindowTokens } : {}),
          ...(typeof contextUsedTokens === 'number' ? { contextUsedTokens } : {}),
          ...(typeof contextUsedPercent === 'number' ? { contextUsedPercent } : {}),
          configuredModel: interaction.configuredModel,
          ...(interaction.resolvedModel ? { resolvedModel: interaction.resolvedModel } : {})
        });
      });
    }

    const processRequest = async (): Promise<AgentResponse> => {
    const stages: ExecutionStage[] = [];
    const memoryReads: MemoryOperation[] = [];
    const memoryWrites: MemoryOperation[] = [];

    const emitProgress = (stage: string, message: string): void => {
      const tokensTotal = this.sumTraceTokens(requestId);
      request.onProgress?.({
        stage,
        message,
        timestamp: new Date().toISOString(),
        ...(typeof tokensTotal === 'number' ? { tokensTotal } : {})
      });
    };

    await this.safeRecallMemory(request.userId, 'last_summary', memoryReads);
    emitProgress('memory_recall', 'Memória de execução anterior consultada.');

    await this.auditLogger.log({
      timestamp: new Date().toISOString(),
      userId: request.userId,
      sessionId: request.sessionId,
      eventType: 'request_received',
      details: request.text.slice(0, 200)
    });
    emitProgress('request_received', 'Requisição auditada e aceita para processamento.');

    const confirmationToken = this.confirmationManager.extractConfirmationToken(request.text);
    if (confirmationToken) {
      const confirmationStart = Date.now();
      const ticket = await this.confirmationManager.consumeTicket(
        confirmationToken,
        request.userId,
        request.sessionId
      );

      stages.push({
        stage: 'confirmation_token_validation',
        status: ticket ? 'completed' : 'failed',
        durationMs: Date.now() - confirmationStart,
        details: ticket ? 'Token válido e consumido.' : 'Token inválido ou expirado.'
      });
      emitProgress('confirmation_token_validation', ticket ? 'Token de confirmação validado.' : 'Token de confirmação inválido.');

      if (!ticket) {
        await this.auditLogger.log({
          timestamp: new Date().toISOString(),
          userId: request.userId,
          sessionId: request.sessionId,
          eventType: 'confirmation_invalid',
          details: `Token inválido: ${confirmationToken}`
        });

        await this.safeRememberMemory(
          request.userId,
          'last_status',
          'rejected:confirmation_invalid',
          memoryWrites
        );

        return {
          language: 'pt-BR',
          status: 'rejected',
          summary: 'Token de confirmação inválido ou expirado.',
          steps: ['Solicite novamente a ação e confirme com o novo token.'],
          executionReport: this.buildExecutionReport({
            request,
            requestId,
            startedAt,
            startedAtMs,
            stages,
            memoryReads,
            memoryWrites,
            status: 'rejected',
            summary: 'Token de confirmação inválido ou expirado.',
            notes: ['Não foi possível executar a ação porque o token não era mais válido.']
          })
        };
      }

      const actionStart = Date.now();
      emitProgress('action_execution', `Executando ação confirmada: ${ticket.plan.action}.`);
      try {
        const actionResult = await this.actionExecutor.execute(ticket.plan, ticket.request);

        stages.push({
          stage: 'action_execution',
          status: 'completed',
          durationMs: Date.now() - actionStart,
          details: `Ação confirmada: ${ticket.plan.action}`
        });
        emitProgress('action_execution', `Ação confirmada concluída: ${ticket.plan.action}.`);

        await this.auditLogger.log({
          timestamp: new Date().toISOString(),
          userId: request.userId,
          sessionId: request.sessionId,
          eventType: 'confirmation_completed',
          action: ticket.plan.action,
          details: `Token confirmado: ${ticket.token}`
        });

        const report = this.buildExecutionReport({
          request,
          requestId,
          startedAt,
          startedAtMs,
          stages,
          memoryReads,
          memoryWrites,
          status: 'completed',
          summary: actionResult.summary,
          intent: ticket.plan,
          ...(actionResult.executionReport?.model ? { model: actionResult.executionReport.model } : {}),
          ...(actionResult.executionReport?.resolvedModel
            ? { resolvedModel: actionResult.executionReport.resolvedModel }
            : {}),
          ...(actionResult.executionReport?.tools ? { tools: actionResult.executionReport.tools } : {}),
          notes: ['Fluxo executado via confirmação explícita do usuário.']
        });

        await this.safeRememberMemory(request.userId, 'last_summary', actionResult.summary, memoryWrites);
        await this.safeRememberMemory(request.userId, 'last_status', 'completed', memoryWrites);

        return {
          ...actionResult,
          status: 'completed',
          executionReport: report
        };
      } catch (error) {
        const failureMessage = error instanceof Error ? error.message : String(error);
        const failureDuration = Date.now() - actionStart;
        stages.push({
          stage: 'action_execution',
          status: 'failed',
          durationMs: failureDuration,
          details: failureMessage
        });
        emitProgress('action_execution', `Falha na execução confirmada: ${failureMessage}`);

        await this.auditLogger.log({
          timestamp: new Date().toISOString(),
          userId: request.userId,
          sessionId: request.sessionId,
          eventType: 'action_blocked',
          action: ticket.plan.action,
          details: `Falha após confirmação: ${failureMessage}`
        });

        await this.safeRememberMemory(request.userId, 'last_status', 'rejected:action_failed', memoryWrites);

        return {
          language: 'pt-BR',
          status: 'rejected',
          summary: `Falha ao executar a ação confirmada: ${failureMessage}`,
          steps: [
            `Ação: ${ticket.plan.action}`,
            `Erro: ${failureMessage}`,
            'Revise o caminho/parâmetros e tente novamente.'
          ],
          executionReport: this.buildExecutionReport({
            request,
            requestId,
            startedAt,
            startedAtMs,
            stages,
            memoryReads,
            memoryWrites,
            status: 'rejected',
            summary: `Falha ao executar ação confirmada: ${failureMessage}`,
            intent: ticket.plan,
            tools: [
              {
                tool: 'ActionExecutor.execute',
                action: ticket.plan.action,
                status: 'failed',
                durationMs: failureDuration,
                details: failureMessage
              }
            ],
            notes: ['Falha durante execução após confirmação explícita.']
          })
        };
      }
    }

    const intentStart = Date.now();
    const basePlan = await this.intentClassifier.classify(request);
    stages.push({
      stage: 'intent_classification',
      status: 'completed',
      durationMs: Date.now() - intentStart,
      details: `${basePlan.action} (confidence: ${basePlan.confidence.toFixed(2)})`
    });
    emitProgress('intent_classification', `Intenção classificada como ${basePlan.action}.`);

    // Skill selection + instruction composition
    const skillStart = Date.now();
    let plan = basePlan;
    let appliedSkill: string | undefined;
    let instructionVersion: string | undefined;
    if (this.skillRegistry && this.instructionComposer) {
      const skill = this.skillRegistry.selectSkill(request, basePlan);
      const recentMemory = this.memoryGateway
        ? await this.memoryGateway.recallRecent(request.userId, 5).catch(() => [])
        : [];
      const memoryContext = recentMemory.length > 0
        ? recentMemory.map((m) => `[${m.timestamp.slice(0, 10)}] ${m.key}: ${m.value}`).join('\n')
        : undefined;
      const composed = this.instructionComposer.compose(
        skill,
        request,
        memoryContext ? { memoryContext } : undefined
      );
      plan = { ...basePlan, composedInstruction: composed };
      appliedSkill = skill.id;
      instructionVersion = composed.instructionVersion;
      emitProgress('skill_selection', `Skill selecionada: ${skill.name} (${skill.id}).`);
    }
    stages.push({
      stage: 'skill_selection',
      status: 'completed',
      durationMs: Date.now() - skillStart,
      details: appliedSkill ? `skill=${appliedSkill}` : 'skill_registry_not_available'
    });

    const languageStart = Date.now();
    const language = await this.languageDetector.detectLanguage(request.text);
    stages.push({
      stage: 'language_detection',
      status: 'completed',
      durationMs: Date.now() - languageStart,
      details: language
    });
    emitProgress('language_detection', `Idioma detectado: ${language}.`);

    try {
      const safetyStart = Date.now();
      emitProgress('safety_validation', 'Executando validação de segurança.');
      await this.safetyGuard.validate(request, plan);
      stages.push({
        stage: 'safety_validation',
        status: 'completed',
        durationMs: Date.now() - safetyStart,
        details: 'Solicitação aprovada pela camada de segurança.'
      });
      emitProgress('safety_validation', 'Solicitação aprovada pela camada de segurança.');
    } catch (error) {
      stages.push({
        stage: 'safety_validation',
        status: error instanceof SafetyApprovalRequiredError ? 'completed' : 'failed',
        durationMs: 0,
        details: error instanceof Error ? error.message : 'erro de validação'
      });

      if (error instanceof SafetyApprovalRequiredError) {
        const confirmationStart = Date.now();
        const ticket = await this.confirmationManager.createTicket(request, plan);
        const approvalDescription = this.buildApprovalDescription(plan.action, request.text);
        stages.push({
          stage: 'confirmation_ticket_creation',
          status: 'completed',
          durationMs: Date.now() - confirmationStart,
          details: `Token criado com expiração em ${ticket.expiresAt}`
        });
        emitProgress('confirmation_ticket_creation', 'Ação requer confirmação explícita do usuário.');

        await this.auditLogger.log({
          timestamp: new Date().toISOString(),
          userId: request.userId,
          sessionId: request.sessionId,
          eventType: 'confirmation_requested',
          action: plan.action,
          details: `Aprovacao requerida. Token emitido: ${ticket.token}`
        });

        await this.safeRememberMemory(
          request.userId,
          'last_status',
          'pending_confirmation',
          memoryWrites
        );

        return {
          language,
          status: 'pending_confirmation',
          summary: 'Esta acao precisa da sua aprovacao antes de continuar.',
          approvalDescription,
          steps: [
            `Descricao da acao: ${approvalDescription}`,
            `Para aprovar e executar, clique no botao de aprovacao ou use: confirmar ${ticket.token}`,
            `Esse token expira em: ${ticket.expiresAt}`
          ],
          confirmationToken: ticket.token,
          executionReport: this.buildExecutionReport({
            request,
            requestId,
            startedAt,
            startedAtMs,
            stages,
            memoryReads,
            memoryWrites,
            status: 'pending_confirmation',
            summary: 'Aguardando confirmação explícita do usuário.',
            intent: plan,
            notes: [
              error.approvalReason ?? error.message,
              'Após confirmação, a ação pendente será executada automaticamente.'
            ]
          })
        };
      }

      await this.auditLogger.log({
        timestamp: new Date().toISOString(),
        userId: request.userId,
        sessionId: request.sessionId,
        eventType: 'action_blocked',
        action: plan.action,
        details: error instanceof Error ? error.message : String(error)
      });

      await this.safeRememberMemory(request.userId, 'last_status', 'rejected:safety', memoryWrites);

      return {
        language,
        status: 'rejected',
        summary: 'Solicitacao bloqueada por politica de seguranca.',
        steps: [
          `Motivo: ${error instanceof Error ? error.message : 'erro de validacao'}`,
          'Revise a solicitacao e tente novamente em um caminho permitido.'
        ],
        executionReport: this.buildExecutionReport({
          request,
          requestId,
          startedAt,
          startedAtMs,
          stages,
          memoryReads,
          memoryWrites,
          status: 'rejected',
          summary: 'Solicitação rejeitada pela política de segurança.',
          intent: plan,
          notes: [error instanceof Error ? error.message : 'erro de validação']
        })
      };
    }

    if (isDestructiveAction(plan.action)) {
      const confirmationStart = Date.now();
      const ticket = await this.confirmationManager.createTicket(request, plan);
      stages.push({
        stage: 'confirmation_ticket_creation',
        status: 'completed',
        durationMs: Date.now() - confirmationStart,
        details: `Ação destrutiva requer confirmação: ${plan.action}`
      });

      await this.auditLogger.log({
        timestamp: new Date().toISOString(),
        userId: request.userId,
        sessionId: request.sessionId,
        eventType: 'confirmation_requested',
        action: plan.action,
        details: `Token emitido: ${ticket.token}`
      });

      await this.safeRememberMemory(
        request.userId,
        'last_status',
        'pending_confirmation',
        memoryWrites
      );

      return {
        language,
        status: 'pending_confirmation',
        summary: `A ação ${plan.action} exige confirmação explícita.`,
        approvalDescription: this.buildApprovalDescription(plan.action, request.text),
        steps: [
          `Para confirmar, execute: confirmar ${ticket.token}`,
          `Esse token expira em: ${ticket.expiresAt}`
        ],
        confirmationToken: ticket.token,
        executionReport: this.buildExecutionReport({
          request,
          requestId,
          startedAt,
          startedAtMs,
          stages,
          memoryReads,
          memoryWrites,
          status: 'pending_confirmation',
          summary: 'Ação destrutiva aguardando confirmação.',
          intent: plan,
          notes: ['A execução será liberada após confirmação explícita.']
        })
      };
    }

    const actionStart = Date.now();
    emitProgress('action_execution', `Executando ação principal: ${plan.action}.`);
    try {
      const actionResult = await this.actionExecutor.execute(plan, request);
      stages.push({
        stage: 'action_execution',
        status: 'completed',
        durationMs: Date.now() - actionStart,
        details: `Ação executada: ${plan.action}`
      });
      emitProgress('action_execution', `Ação principal concluída: ${plan.action}.`);

      await this.auditLogger.log({
        timestamp: new Date().toISOString(),
        userId: request.userId,
        sessionId: request.sessionId,
        eventType: 'action_executed',
        action: plan.action,
        details: plan.reason
      });

      const report = this.buildExecutionReport({
        request,
        requestId,
        startedAt,
        startedAtMs,
        stages,
        memoryReads,
        memoryWrites,
        status: 'completed',
        summary: actionResult.summary,
        intent: plan,
        ...(actionResult.executionReport?.model ? { model: actionResult.executionReport.model } : {}),
        ...(actionResult.executionReport?.resolvedModel
          ? { resolvedModel: actionResult.executionReport.resolvedModel }
          : {}),
        ...(actionResult.executionReport?.tools ? { tools: actionResult.executionReport.tools } : {}),
        notes: [],
        ...(appliedSkill ? { appliedSkill } : {}),
        ...(instructionVersion ? { instructionVersion } : {})
      });

      await this.safeRememberMemory(request.userId, 'last_summary', actionResult.summary, memoryWrites);
      await this.safeRememberMemory(request.userId, 'last_status', 'completed', memoryWrites);

      return {
        ...actionResult,
        language,
        status: 'completed',
        executionReport: report
      };
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : String(error);
      const failureDuration = Date.now() - actionStart;
      stages.push({
        stage: 'action_execution',
        status: 'failed',
        durationMs: failureDuration,
        details: failureMessage
      });
      emitProgress('action_execution', `Falha na ação principal: ${failureMessage}`);

      await this.auditLogger.log({
        timestamp: new Date().toISOString(),
        userId: request.userId,
        sessionId: request.sessionId,
        eventType: 'action_blocked',
        action: plan.action,
        details: `Falha durante execução da ação: ${failureMessage}`
      });

      await this.safeRememberMemory(request.userId, 'last_status', 'rejected:action_failed', memoryWrites);

      return {
        language,
        status: 'rejected',
        summary: `Falha ao executar ação ${plan.action}: ${failureMessage}`,
        steps: [
          `Ação: ${plan.action}`,
          `Erro: ${failureMessage}`,
          'Revise os parâmetros e tente novamente.'
        ],
        executionReport: this.buildExecutionReport({
          request,
          requestId,
          startedAt,
          startedAtMs,
          stages,
          memoryReads,
          memoryWrites,
          status: 'rejected',
          summary: `Falha ao executar ação: ${failureMessage}`,
          intent: plan,
          tools: [
            {
              tool: 'ActionExecutor.execute',
              action: plan.action,
              status: 'failed',
              durationMs: failureDuration,
              details: failureMessage
            }
          ],
          notes: [
            'Execução terminou com falha no executor de ação.',
            ...(appliedSkill ? [`skill_aplicada=${appliedSkill}`] : []),
            ...(instructionVersion ? [`instruction_version=${instructionVersion}`] : [])
          ],
          ...(appliedSkill ? { appliedSkill } : {}),
          ...(instructionVersion ? { instructionVersion } : {})
        })
      };
    }
    };

    if (!this.llmTraceContext) {
      return processRequest();
    }

    try {
      return await this.llmTraceContext.runWithTrace(requestId, processRequest);
    } finally {
      this.llmTraceContext.detachTraceListener(requestId);
    }
  }

  private buildExecutionReport(input: {
    request: AgentRequest;
    requestId: string;
    startedAt: Date;
    startedAtMs: number;
    stages: ExecutionStage[];
    memoryReads: MemoryOperation[];
    memoryWrites: MemoryOperation[];
    status: 'completed' | 'pending_confirmation' | 'rejected';
    summary: string;
    intent?: ActionPlan;
    model?: ModelUsage;
    resolvedModel?: string;
    tools?: ExecutionReport['tools'];
    notes: string[];
    appliedSkill?: string;
    instructionVersion?: string;
  }): ExecutionReport {
    const finishedAt = new Date();
    const promptPreview = input.request.text.replace(/\s+/g, ' ').trim().slice(0, 240);
    const promptChars = input.request.text.length;
    const estimatedPromptTokens = this.estimateTokens(promptChars);
    const runtime = this.readRuntimeResources();
    const configuredBackend = process.env.MEMORY_BACKEND === 'mempalace' ? 'mempalace' : 'obsidian';
    const memoryEnabled = Boolean(this.memoryGateway);
    const memoryReport: MemoryReport = {
      backend: memoryEnabled ? configuredBackend : 'none',
      enabled: memoryEnabled,
      reads: input.memoryReads,
      writes: input.memoryWrites
    };

    const llmInteractions = this.llmTraceContext?.consumeTrace(input.requestId) ?? [];
    const interactionUsage = this.sumUsageFromInteractions(llmInteractions);

    const latestInteractionWithUsage = [...llmInteractions]
      .reverse()
      .find((item) => !!item.usage);

    const modelBase = input.model ?? {
      provider: latestInteractionWithUsage?.usage?.provider ?? 'openrouter',
      model:
        latestInteractionWithUsage?.resolvedModel ??
        latestInteractionWithUsage?.usage?.model ??
        latestInteractionWithUsage?.configuredModel ??
        'openrouter/auto',
      contextWindowTokens:
        latestInteractionWithUsage?.usage?.contextWindowTokens ??
        128000
    };

    const resolvedInputTokens =
      interactionUsage.inputTokens ?? modelBase.inputTokens ?? estimatedPromptTokens;
    const resolvedOutputTokens = interactionUsage.outputTokens ?? modelBase.outputTokens;
    const resolvedTotalTokens =
      interactionUsage.totalTokens ??
      modelBase.totalTokens ??
      (typeof resolvedOutputTokens === 'number'
        ? resolvedInputTokens + resolvedOutputTokens
        : resolvedInputTokens);

    const resolvedContextWindowTokens =
      latestInteractionWithUsage?.usage?.contextWindowTokens ??
      modelBase.contextWindowTokens ??
      128000;
    const contextUsedTokens = resolvedTotalTokens;

    const model: ModelUsage = {
      ...modelBase,
      contextWindowTokens: resolvedContextWindowTokens,
      ...(typeof resolvedInputTokens === 'number' ? { inputTokens: resolvedInputTokens } : {}),
      ...(typeof resolvedOutputTokens === 'number' ? { outputTokens: resolvedOutputTokens } : {}),
      ...(typeof resolvedTotalTokens === 'number' ? { totalTokens: resolvedTotalTokens } : {}),
      ...(typeof contextUsedTokens === 'number' ? { contextUsedTokens } : {}),
      ...(typeof contextUsedTokens === 'number'
        ? {
            contextUsedPercent: Number(
              ((contextUsedTokens / resolvedContextWindowTokens) * 100).toFixed(2)
            )
          }
        : {}),
      estimatedContextUsedTokens: contextUsedTokens,
      ...(typeof contextUsedTokens === 'number'
        ? {
            estimatedContextUsedPercent: Number(
              ((contextUsedTokens / resolvedContextWindowTokens) * 100).toFixed(2)
            )
          }
        : {})
    };

    const tools = input.tools ?? [];
    if (tools.length === 0) {
      tools.push({
        tool: 'none',
        action: input.intent?.action ?? 'chat.reply',
        status: 'skipped',
        details: 'Nenhuma ferramenta externa foi acionada nesta etapa.'
      });
    }

    return {
      requestId: input.requestId,
      startedAt: input.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      totalDurationMs: Date.now() - input.startedAtMs,
      promptPreview,
      promptChars,
      ...(input.intent ? { intent: input.intent } : {}),
      model,
      ...(input.resolvedModel ? { resolvedModel: input.resolvedModel } : {}),
      llmInteractions,
      tools,
      runtime,
      ...(input.request.workspaceRoot || input.request.activeFilePath
        ? {
            requestContext: {
              ...(input.request.workspaceRoot
                ? { workspaceRoot: input.request.workspaceRoot }
                : {}),
              ...(input.request.activeFilePath
                ? { activeFilePath: input.request.activeFilePath }
                : {})
            }
          }
        : {}),
      memory: memoryReport,
      stages: input.stages,
      notes: [
        ...input.notes,
        ...(input.request.workspaceRoot
          ? [`workspace_root=${input.request.workspaceRoot}`]
          : []),
        ...(input.request.activeFilePath
          ? [`active_file=${input.request.activeFilePath}`]
          : []),
        `status_final=${input.status}`,
        `resumo=${input.summary}`
      ],
      ...(input.appliedSkill ? { appliedSkill: input.appliedSkill } : {}),
      ...(input.instructionVersion ? { instructionVersion: input.instructionVersion } : {})
    };
  }

  private readRuntimeResources(): RuntimeResources {
    const memory = process.memoryUsage();
    return {
      memoryRssMb: Number((memory.rss / 1024 / 1024).toFixed(2)),
      memoryHeapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(2)),
      memoryHeapTotalMb: Number((memory.heapTotal / 1024 / 1024).toFixed(2))
    };
  }

  private estimateTokens(chars: number): number {
    return Math.max(1, Math.ceil(chars / 4));
  }

  private sumUsageFromInteractions(interactions: ExecutionReport['llmInteractions']): {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  } {
    const withUsage = interactions.filter((item) => item.usage);
    if (withUsage.length === 0) {
      return {};
    }

    const sum = withUsage.reduce(
      (acc, item) => {
        const usage = item.usage;
        return {
          inputTokens: acc.inputTokens + (usage?.inputTokens ?? 0),
          outputTokens: acc.outputTokens + (usage?.outputTokens ?? 0),
          totalTokens: acc.totalTokens + (usage?.totalTokens ?? 0)
        };
      },
      { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    );

    return {
      inputTokens: sum.inputTokens,
      outputTokens: sum.outputTokens,
      totalTokens: sum.totalTokens > 0 ? sum.totalTokens : sum.inputTokens + sum.outputTokens
    };
  }

  private sumTraceTokens(traceId: string): number | undefined {
    if (!this.llmTraceContext) {
      return undefined;
    }

    const snapshot = this.llmTraceContext.peekTrace(traceId);
    if (snapshot.length === 0) {
      return 0;
    }

    const usage = this.sumUsageFromInteractions(snapshot);
    return usage.totalTokens ?? usage.inputTokens ?? 0;
  }

  private async safeRecallMemory(
    userId: string,
    key: string,
    operations: MemoryOperation[]
  ): Promise<string | null> {
    if (!this.memoryGateway) {
      return null;
    }

    try {
      const value = await this.memoryGateway.recall(userId, key);
      operations.push({
        type: 'read',
        key,
        valuePreview: (value ?? '').slice(0, 120),
        timestamp: new Date().toISOString()
      });
      return value;
    } catch {
      return null;
    }
  }

  private async safeRememberMemory(
    userId: string,
    key: string,
    value: string,
    operations: MemoryOperation[]
  ): Promise<void> {
    if (!this.memoryGateway) {
      return;
    }

    try {
      await this.memoryGateway.remember(userId, key, value);
      operations.push({
        type: 'write',
        key,
        valuePreview: value.slice(0, 120),
        timestamp: new Date().toISOString()
      });
    } catch {
      // Ignora falhas de memória para não interromper execução principal.
    }
  }

  private buildApprovalDescription(action: string, text: string): string {
    const normalizedText = text.replace(/\s+/g, ' ').trim().slice(0, 220);
    return `Executar ${action} com a solicitacao: "${normalizedText}"`;
  }
}
