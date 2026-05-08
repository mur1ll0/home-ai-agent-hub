import { describe, expect, it, vi } from 'vitest';
import { IntentClassifierService } from '../../src/application/services/intent-classifier.service.js';

describe('IntentClassifierService', () => {
  it('prioriza file.read quando a pergunta for sobre o arquivo ativo', async () => {
    const llmGateway = {
      ask: vi.fn(),
      askWithMeta: vi.fn(),
      getModelInfo: vi.fn()
    };

    const sut = new IntentClassifierService(llmGateway as never);

    const result = await sut.classify({
      text: 'Do que este arquivo se trata?',
      userId: 'u1',
      sessionId: 's1',
      activeFilePath: 'F:/repo/src/main.ts'
    });

    expect(result.action).toBe('file.read');
    expect(result.reason).toMatch(/arquivo ativo/i);
    expect(llmGateway.ask).not.toHaveBeenCalled();
  });

  it('não sobrescreve intenção explícita de escrita mesmo com arquivo ativo', async () => {
    const llmGateway = {
      ask: vi.fn().mockResolvedValue('{"action":"file.write","confidence":0.9,"reason":"llm"}'),
      askWithMeta: vi.fn(),
      getModelInfo: vi.fn()
    };

    const sut = new IntentClassifierService(llmGateway as never);

    const result = await sut.classify({
      text: 'Escreva neste arquivo uma função nova',
      userId: 'u1',
      sessionId: 's1',
      activeFilePath: 'F:/repo/src/main.ts'
    });

    expect(result.action).toBe('file.write');
  });

  it('não classifica file.read apenas por conter README no contexto', async () => {
    const llmGateway = {
      ask: vi.fn().mockResolvedValue('{"action":"chat.reply","confidence":0.9,"reason":"llm"}'),
      askWithMeta: vi.fn(),
      getModelInfo: vi.fn()
    };

    const sut = new IntentClassifierService(llmGateway as never);

    const result = await sut.classify({
      text: '[Arquivo ativo relativo: README.md]\nDo que meu projeto se trata?',
      userId: 'u1',
      sessionId: 's1',
      activeFilePath: 'F:/repo/README.md'
    });

    expect(result.action).toBe('chat.reply');
  });

  it('prioriza chat.reply para pergunta de resumo do projeto com contexto ativo', async () => {
    const llmGateway = {
      ask: vi.fn(),
      askWithMeta: vi.fn(),
      getModelInfo: vi.fn()
    };

    const sut = new IntentClassifierService(llmGateway as never);

    const result = await sut.classify({
      text: 'Do que meu projeto se trata?',
      userId: 'u1',
      sessionId: 's1',
      activeFilePath: 'F:/repo/README.md'
    });

    expect(result.action).toBe('chat.reply');
    expect(result.reason).toMatch(/resumo do projeto/i);
  });
});