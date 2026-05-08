import { describe, expect, it, vi } from 'vitest';
import { ActionExecutorService } from '../../src/application/services/action-executor.service.js';

describe('ActionExecutorService slide capacity rule', () => {
  it('garante slides finais <= min(pedido do usuario, capacidade de conteudo)', async () => {
    const topics = ['Topico A', 'Topico B', 'Topico C', 'Topico D', 'Topico E'];

    const fileSystemTool = {
      read: vi.fn(),
      write: vi.fn(),
      move: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      listRecursive: vi.fn()
    };

    const webTool = {
      extract: vi.fn(),
      search: vi.fn().mockResolvedValue(
        'Consulta: teste\\n\\nFonte: Exemplo\\nURL: https://docs.example.com\\nTrecho: texto tecnico com detalhes de implementacao e arquitetura para agentes de IA.'
      )
    };

    const createSlides = vi.fn().mockResolvedValue(undefined);
    const officeTool = {
      createWord: vi.fn(),
      createSlides,
      createSpreadsheet: vi.fn()
    };

    const mediaTool = {
      generateImage: vi.fn(),
      generateVideo: vi.fn(),
      generate3D: vi.fn()
    };

    const mcpConnector = {
      connect: vi.fn()
    };

    const llmGateway = {
      ask: vi.fn().mockImplementation(async (_prompt: string, options?: { operation?: string }) => {
        const operation = options?.operation;

        if (operation === 'topic_extraction') {
          return `\`\`\`json\n${JSON.stringify(topics)}\n\`\`\``;
        }

        if (operation === 'topic_research_processing') {
          const processed = {
            'Topico A': 'Ponto tecnico A1 detalhado sobre integração de memória para agentes. | Ponto tecnico A2 com arquitetura e fluxo de dados entre componentes. | Ponto tecnico A3 sobre recuperação contextual e persistência de estado.',
            'Topico B': 'Ponto tecnico B1 sobre indexação semântica e consulta contextual em pipeline de agentes. | Ponto tecnico B2 com boas práticas para organização de conhecimento no Obsidian. | Ponto tecnico B3 com mitigação de ruído e validação de fontes.',
            'Topico C': 'Conteúdo insuficiente',
            'Topico D': 'Conteúdo insuficiente',
            'Topico E': 'Conteúdo insuficiente'
          };

          return `\`\`\`json\n${JSON.stringify(processed)}\n\`\`\``;
        }

        if (operation === 'slide_synthesis') {
          const syntheticSlides = Array.from({ length: 20 }, (_, index) => ({
            title: `Slide ${index + 1}`,
            bullets: ['Bullet 1', 'Bullet 2', 'Bullet 3']
          }));

          return `\`\`\`json\n${JSON.stringify(syntheticSlides)}\n\`\`\``;
        }

        return '[]';
      }),
      askWithMeta: vi.fn(),
      getModelInfo: vi.fn().mockReturnValue({
        provider: 'openrouter',
        model: 'openrouter/auto',
        contextWindowTokens: 128000
      })
    };

    const sut = new ActionExecutorService(
      fileSystemTool as never,
      webTool as never,
      officeTool as never,
      mediaTool as never,
      mcpConnector as never,
      llmGateway as never
    );

    const response = await sut.execute(
      {
        action: 'slide.create',
        confidence: 0.95,
        reason: 'teste',
        isComplexTask: true,
        mainTopic: 'Obsidian para memoria de agentes de IA'
      },
      {
        text: 'Crie uma apresentação de 20 slides sobre Obsidian para memoria de agentes de IA',
        userId: 'u1',
        sessionId: 's1'
      }
    );

    expect(createSlides).toHaveBeenCalledTimes(1);

    const slidesArg = createSlides.mock.calls[0]?.[1] as Array<{ title: string; bullets: string[] }>;
    expect(Array.isArray(slidesArg)).toBe(true);

    // capacidade estimada = topicos substanciais (2) + 2 = 4
    // regra: slides finais <= min(pedido=20, capacidade=4)
    expect(slidesArg.length).toBeLessThanOrEqual(4);
    expect(slidesArg.length).toBe(4);

    expect(response.summary).toContain('4 slides');
    expect(response.steps.join(' ')).toContain('Quantidade solicitada: 20');
  });
});
