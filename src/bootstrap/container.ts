import { ActionExecutorService } from '../application/services/action-executor.service.js';
import { InMemoryConfirmationManagerService } from '../application/services/in-memory-confirmation-manager.service.js';
import { InstructionComposerService } from '../application/services/instruction-composer.service.js';
import { IntentClassifierService } from '../application/services/intent-classifier.service.js';
import { LanguageDetectorService } from '../application/services/language-detector.service.js';
import { SafetyGuardService } from '../application/services/safety-guard.service.js';
import { SkillRegistryService } from '../application/services/skill-registry.service.js';
import { HandleUserRequestUseCase } from '../core/use-cases/handle-user-request.use-case.js';
import type { IntentClassifier, LanguageDetector, SafetyGuard } from '../core/ports/agent-services.js';
import type { FileEditSessionTool, McpToolConnector } from '../core/ports/tools.js';
import { JsonlAuditLogger } from '../infrastructure/audit/jsonl-audit.logger.js';
import { loadAppEnv } from '../infrastructure/config/env.js';
import { OllamaChatGateway } from '../infrastructure/llm/ollama-chat.gateway.js';
import { OpenRouterChatGateway } from '../infrastructure/llm/openrouter-chat.gateway.js';
import { ObsidianMemoryGateway } from '../infrastructure/memory/obsidian-memory.gateway.js';
import { InMemoryFileEditSessionTool } from '../infrastructure/tools/filesystem/file-edit-session.tool.js';
import { LocalFileSystemTool } from '../infrastructure/tools/filesystem/local-file-system.tool.js';
import { McpToolConnectorImpl } from '../infrastructure/tools/mcp/mcp-tool-connector.js';
import { MediaGenerationTool } from '../infrastructure/tools/media/media-generation.tool.js';
import { OfficeDocumentToolImpl } from '../infrastructure/tools/office/office-document.tool.js';
import { PlaywrightWebTool } from '../infrastructure/tools/web/playwright-web.tool.js';

export interface AppContainer {
  handleUserRequestUseCase: HandleUserRequestUseCase;
  intentClassifier: IntentClassifier;
  languageDetector: LanguageDetector;
  safetyGuard: SafetyGuard;
  mcpConnector: McpToolConnector;
  fileEditSessionTool: FileEditSessionTool;
  forkForModel(modelId: string): HandleUserRequestUseCase;
}

export async function createContainer(): Promise<AppContainer> {
  const env = loadAppEnv();

  const llmGateway = new OpenRouterChatGateway(env);
  const intentClassifier = new IntentClassifierService(llmGateway);
  const languageDetector = new LanguageDetectorService(llmGateway);
  const safetyGuard = new SafetyGuardService(env, llmGateway);
  const confirmationManager = new InMemoryConfirmationManagerService();
  const auditLogger = new JsonlAuditLogger(env.AGENT_AUDIT_LOG_PATH);
  const mcpConnector = new McpToolConnectorImpl();
  const fileEditSessionTool = new InMemoryFileEditSessionTool();
  const memoryGateway =
    env.MEMORY_BACKEND === 'obsidian'
      ? new ObsidianMemoryGateway(env.OBSIDIAN_VAULT_PATH)
      : undefined;

  const actionExecutor = new ActionExecutorService(
    new LocalFileSystemTool(),
    new PlaywrightWebTool(env.PLAYWRIGHT_HEADLESS === 'true'),
    new OfficeDocumentToolImpl(),
    new MediaGenerationTool(llmGateway),
    mcpConnector,
    llmGateway,
    fileEditSessionTool
  );

  const skillRegistry = new SkillRegistryService();
  const instructionComposer = new InstructionComposerService();

  const buildUseCaseForGateway = (gw: OpenRouterChatGateway | OllamaChatGateway): HandleUserRequestUseCase => {
    const ic = new IntentClassifierService(gw);
    const ld = new LanguageDetectorService(gw);
    const sg = new SafetyGuardService(env, gw);
    const ae = new ActionExecutorService(
      new LocalFileSystemTool(),
      new PlaywrightWebTool(env.PLAYWRIGHT_HEADLESS === 'true'),
      new OfficeDocumentToolImpl(),
      new MediaGenerationTool(gw),
      mcpConnector,
      gw,
      fileEditSessionTool
    );
    return new HandleUserRequestUseCase(
      ic,
      sg,
      ld,
      ae,
      confirmationManager,
      auditLogger,
      memoryGateway,
      gw,
      skillRegistry,
      instructionComposer
    );
  };

  const forkForModel = (modelId: string): HandleUserRequestUseCase => {
    const isOllama = modelId.startsWith('ollama:');
    const gw = isOllama
      ? new OllamaChatGateway(modelId.slice('ollama:'.length))
      : llmGateway.forkWithModel(modelId);
    return buildUseCaseForGateway(gw);
  };

  return {
    intentClassifier,
    languageDetector,
    safetyGuard,
    mcpConnector,
    fileEditSessionTool,
    forkForModel,
    handleUserRequestUseCase: new HandleUserRequestUseCase(
      intentClassifier,
      safetyGuard,
      languageDetector,
      actionExecutor,
      confirmationManager,
      auditLogger,
      memoryGateway,
      llmGateway,
      skillRegistry,
      instructionComposer
    )
  };
}
