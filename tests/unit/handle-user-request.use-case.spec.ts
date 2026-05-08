import { describe, expect, it, vi } from 'vitest';
import { HandleUserRequestUseCase } from '../../src/core/use-cases/handle-user-request.use-case.js';
import { InMemoryConfirmationManagerService } from '../../src/application/services/in-memory-confirmation-manager.service.js';
import { SafetyApprovalRequiredError } from '../../src/core/domain/safety-errors.js';

describe('HandleUserRequestUseCase confirmation flow', () => {
  it('solicita confirmacao para acao destrutiva e executa apos token', async () => {
    const intentClassifier = {
      classify: vi.fn().mockResolvedValue({ action: 'file.delete', confidence: 0.9, reason: 'test' })
    };
    const safetyGuard = {
      validate: vi.fn().mockResolvedValue(undefined)
    };
    const languageDetector = {
      detectLanguage: vi.fn().mockResolvedValue('pt-BR')
    };
    const actionExecutor = {
      execute: vi.fn().mockResolvedValue({
        language: 'pt-BR',
        summary: 'Arquivo removido',
        steps: ['ok']
      })
    };
    const confirmationManager = new InMemoryConfirmationManagerService(1000 * 60);
    const auditLogger = {
      log: vi.fn().mockResolvedValue(undefined)
    };

    const sut = new HandleUserRequestUseCase(
      intentClassifier,
      safetyGuard,
      languageDetector,
      actionExecutor,
      confirmationManager,
      auditLogger
    );

    const first = await sut.execute({
      text: 'excluir ./workspace/arquivo.txt',
      userId: 'u1',
      sessionId: 's1'
    });

    expect(first.status).toBe('pending_confirmation');
    expect(first.confirmationToken).toBeTruthy();
    expect(actionExecutor.execute).not.toHaveBeenCalled();

    const second = await sut.execute({
      text: `confirmar ${first.confirmationToken}`,
      userId: 'u1',
      sessionId: 's1'
    });

    expect(second.status).toBe('completed');
    expect(actionExecutor.execute).toHaveBeenCalledTimes(1);
  });

  it('solicita confirmacao quando seguranca requer aprovacao explicita', async () => {
    const intentClassifier = {
      classify: vi.fn().mockResolvedValue({ action: 'fs.list', confidence: 0.9, reason: 'test' })
    };
    const safetyGuard = {
      validate: vi
        .fn()
        .mockRejectedValue(
          new SafetyApprovalRequiredError('Requer aprovação', 'Acesso fora da raiz permitida')
        )
    };
    const languageDetector = {
      detectLanguage: vi.fn().mockResolvedValue('pt-BR')
    };
    const actionExecutor = {
      execute: vi.fn().mockResolvedValue({
        language: 'pt-BR',
        summary: 'ok',
        steps: ['ok']
      })
    };
    const confirmationManager = new InMemoryConfirmationManagerService(1000 * 60);
    const auditLogger = {
      log: vi.fn().mockResolvedValue(undefined)
    };

    const sut = new HandleUserRequestUseCase(
      intentClassifier,
      safetyGuard,
      languageDetector,
      actionExecutor,
      confirmationManager,
      auditLogger
    );

    const result = await sut.execute({
      text: 'liste a area de trabalho',
      userId: 'u1',
      sessionId: 's1'
    });

    expect(result.status).toBe('pending_confirmation');
    expect(result.confirmationToken).toBeTruthy();
    expect(actionExecutor.execute).not.toHaveBeenCalled();
  });

  it('marca memoria como habilitada no executionReport quando gateway existe', async () => {
    const intentClassifier = {
      classify: vi.fn().mockResolvedValue({ action: 'chat.reply', confidence: 0.8, reason: 'test' })
    };
    const safetyGuard = {
      validate: vi.fn().mockResolvedValue(undefined)
    };
    const languageDetector = {
      detectLanguage: vi.fn().mockResolvedValue('pt-BR')
    };
    const actionExecutor = {
      execute: vi.fn().mockResolvedValue({
        language: 'pt-BR',
        summary: 'Resposta de teste',
        steps: ['ok']
      })
    };
    const confirmationManager = new InMemoryConfirmationManagerService(1000 * 60);
    const auditLogger = {
      log: vi.fn().mockResolvedValue(undefined)
    };
    const memoryGateway = {
      remember: vi.fn().mockResolvedValue(undefined),
      recall: vi.fn().mockResolvedValue('Resumo anterior')
    };

    const sut = new HandleUserRequestUseCase(
      intentClassifier,
      safetyGuard,
      languageDetector,
      actionExecutor,
      confirmationManager,
      auditLogger,
      memoryGateway
    );

    const result = await sut.execute({
      text: 'responda oi',
      userId: 'u1',
      sessionId: 's1'
    });

    expect(result.executionReport?.memory.enabled).toBe(true);
    expect(result.executionReport?.memory.backend).toBe('obsidian');
    expect(result.executionReport?.memory.reads.length).toBeGreaterThan(0);
    expect(result.executionReport?.memory.writes.length).toBeGreaterThan(0);
    expect(memoryGateway.recall).toHaveBeenCalledWith('u1', 'last_summary');
  });

  it('inclui workspaceRoot e activeFilePath no executionReport quando enviados pela extensão', async () => {
    const intentClassifier = {
      classify: vi.fn().mockResolvedValue({ action: 'file.read', confidence: 0.9, reason: 'test' })
    };
    const safetyGuard = {
      validate: vi.fn().mockResolvedValue(undefined)
    };
    const languageDetector = {
      detectLanguage: vi.fn().mockResolvedValue('pt-BR')
    };
    const actionExecutor = {
      execute: vi.fn().mockResolvedValue({
        language: 'pt-BR',
        summary: 'Arquivo lido',
        steps: ['ok']
      })
    };
    const confirmationManager = new InMemoryConfirmationManagerService(1000 * 60);
    const auditLogger = {
      log: vi.fn().mockResolvedValue(undefined)
    };

    const sut = new HandleUserRequestUseCase(
      intentClassifier,
      safetyGuard,
      languageDetector,
      actionExecutor,
      confirmationManager,
      auditLogger
    );

    const result = await sut.execute({
      text: 'Leia este arquivo',
      userId: 'u1',
      sessionId: 's1',
      workspaceRoot: 'F:/repo',
      activeFilePath: 'F:/repo/src/main.ts'
    });

    expect(result.executionReport?.requestContext?.workspaceRoot).toBe('F:/repo');
    expect(result.executionReport?.requestContext?.activeFilePath).toBe('F:/repo/src/main.ts');
    expect(result.executionReport?.notes).toContain('workspace_root=F:/repo');
    expect(result.executionReport?.notes).toContain('active_file=F:/repo/src/main.ts');
  });

  it('retorna executionReport completo quando actionExecutor falha', async () => {
    const intentClassifier = {
      classify: vi.fn().mockResolvedValue({ action: 'file.read', confidence: 0.9, reason: 'test' })
    };
    const safetyGuard = {
      validate: vi.fn().mockResolvedValue(undefined)
    };
    const languageDetector = {
      detectLanguage: vi.fn().mockResolvedValue('pt-BR')
    };
    const actionExecutor = {
      execute: vi.fn().mockRejectedValue(new Error('ENOENT: no such file or directory'))
    };
    const confirmationManager = new InMemoryConfirmationManagerService(1000 * 60);
    const auditLogger = {
      log: vi.fn().mockResolvedValue(undefined)
    };

    const sut = new HandleUserRequestUseCase(
      intentClassifier,
      safetyGuard,
      languageDetector,
      actionExecutor,
      confirmationManager,
      auditLogger
    );

    const result = await sut.execute({
      text: 'Leia o arquivo F:/repo/README.md',
      userId: 'u1',
      sessionId: 's1'
    });

    expect(result.status).toBe('rejected');
    expect(result.summary).toContain('Falha ao executar ação');
    expect(result.executionReport?.requestId).toBeTruthy();
    expect(result.executionReport?.stages.some((stage) => stage.stage === 'action_execution' && stage.status === 'failed')).toBe(true);
    expect(result.executionReport?.tools[0]?.status).toBe('failed');
    expect(result.executionReport?.tools[0]?.tool).toBe('ActionExecutor.execute');
  });
});
