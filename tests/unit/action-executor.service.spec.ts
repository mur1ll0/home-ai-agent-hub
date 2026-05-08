import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { ActionExecutorService } from '../../src/application/services/action-executor.service.js';

describe('ActionExecutorService', () => {
  it('gera planilha catalogando arquivos reais quando pedido de catalogo', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-catalog-'));
    const fileA = path.join(tmpRoot, 'alpha.txt');
    const nested = path.join(tmpRoot, 'folder');
    const fileB = path.join(nested, 'bravo.md');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(fileA, 'alpha');
    await fs.writeFile(fileB, 'bravo');

    const fileSystemTool = {
      read: vi.fn(),
      write: vi.fn(),
      move: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      listRecursive: vi
        .fn()
        .mockResolvedValue([fileA, fileB])
    };

    const createSpreadsheet = vi.fn().mockResolvedValue(undefined);
    const officeTool = {
      createWord: vi.fn(),
      createSlides: vi.fn(),
      createSpreadsheet
    };

    const sut = new ActionExecutorService(
      fileSystemTool as never,
      { extract: vi.fn() } as never,
      officeTool as never,
      { generateImage: vi.fn(), generateVideo: vi.fn(), generate3D: vi.fn() } as never,
      { connect: vi.fn() } as never,
      {
        ask: vi.fn(),
        askWithMeta: vi.fn(),
        getModelInfo: vi.fn().mockReturnValue({
          provider: 'openrouter',
          model: 'openrouter/auto',
          contextWindowTokens: 128000
        })
      } as never
    );

    const response = await sut.execute(
      { action: 'sheet.create', confidence: 0.9, reason: 'teste' },
      {
        text: 'Olhe na area de trabalho e crie uma planilha catalogando todos os arquivos',
        userId: 'u1',
        sessionId: 's1'
      }
    );

    expect(fileSystemTool.listRecursive).toHaveBeenCalledWith(path.join(os.homedir(), 'Desktop'));
    expect(createSpreadsheet).toHaveBeenCalledTimes(1);

    const rows = createSpreadsheet.mock.calls[0]?.[0] as string[][];
    expect(rows[0]).toEqual(['nome', 'caminho', 'extensao', 'tamanho_bytes', 'modificado_em']);
    expect(rows.length).toBeGreaterThan(1);
    expect(response.summary).toContain('Planilha criada');

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('anexa imagem e fonte nos slides quando pesquisa traz imagem relevante', async () => {
    const fileSystemTool = {
      read: vi.fn(),
      write: vi.fn(),
      move: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      listRecursive: vi.fn().mockResolvedValue([])
    };

    const webTool = {
      extract: vi.fn(),
      search: vi.fn().mockResolvedValue(
        [
          'Consulta: obsidian memoria de agentes',
          'Fonte: Obsidian Docs',
          'URL: https://obsidian.md/docs',
          'Trecho: Obsidian pode servir como base de conhecimento estruturada para agentes.',
          'Imagem: https://obsidian.md/assets/og-image.png',
          'ImagemFonte: https://obsidian.md/docs'
        ].join('\n')
      )
    };

    const createSlides = vi.fn().mockResolvedValue(undefined);
    const officeTool = {
      createWord: vi.fn(),
      createSlides,
      createSpreadsheet: vi.fn()
    };

    const llmGateway = {
      ask: vi.fn().mockImplementation(async (_prompt: string, options?: { operation?: string }) => {
        if (options?.operation === 'topic_extraction') {
          return JSON.stringify(['Fundamentos de Obsidian']);
        }

        if (options?.operation === 'topic_research_processing') {
          return JSON.stringify({
            'Fundamentos de Obsidian': 'Obsidian estrutura conhecimento em notas conectadas | Facilita recuperação de contexto para agentes'
          });
        }

        if (options?.operation === 'slide_synthesis') {
          return JSON.stringify([
            {
              title: 'Fundamentos de Obsidian',
              bullets: ['Notas conectadas', 'Contexto para agentes', 'Pesquisa e memória']
            }
          ]);
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
      { generateImage: vi.fn(), generateVideo: vi.fn(), generate3D: vi.fn() } as never,
      { connect: vi.fn() } as never,
      llmGateway as never
    );

    const response = await sut.execute(
      {
        action: 'slide.create',
        confidence: 0.9,
        reason: 'teste',
        isComplexTask: true,
        mainTopic: 'Obsidian para memoria de agentes de IA'
      },
      {
        text: 'Crie uma apresentação de 1 slide sobre Obsidian para memoria de agentes de IA',
        userId: 'u1',
        sessionId: 's1'
      }
    );

    expect(createSlides).toHaveBeenCalledTimes(1);
    const slidesArg = createSlides.mock.calls[0]?.[1] as Array<{
      title: string;
      bullets: string[];
      imageUrl?: string;
      imageSource?: string;
    }>;

    expect(slidesArg[0]?.imageUrl).toContain('https://obsidian.md/assets/og-image.png');
    expect(slidesArg[0]?.imageSource).toContain('https://obsidian.md/docs');
    expect(response.steps.join(' ')).toContain('Imagens relevantes capturadas: 1');
  });

  it('resolve caminhos relativos a partir do workspace root enviado pela extensao', async () => {
    const fileSystemTool = {
      read: vi.fn().mockResolvedValue('conteudo do arquivo'),
      write: vi.fn(),
      move: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      listRecursive: vi.fn().mockResolvedValue([])
    };

    const sut = new ActionExecutorService(
      fileSystemTool as never,
      { extract: vi.fn(), search: vi.fn() } as never,
      { createWord: vi.fn(), createSlides: vi.fn(), createSpreadsheet: vi.fn() } as never,
      { generateImage: vi.fn(), generateVideo: vi.fn(), generate3D: vi.fn() } as never,
      { connect: vi.fn() } as never,
      {
        ask: vi.fn(),
        askWithMeta: vi.fn(),
        getModelInfo: vi.fn().mockReturnValue({
          provider: 'openrouter',
          model: 'openrouter/auto',
          contextWindowTokens: 128000
        })
      } as never
    );

    const workspaceRoot = path.resolve('f:/repo-exemplo');

    await sut.execute(
      { action: 'file.read', confidence: 0.9, reason: 'teste' },
      {
        text: 'Leia "src/main.ts"',
        userId: 'u1',
        sessionId: 's1',
        workspaceRoot,
        activeFilePath: path.join(workspaceRoot, 'src', 'main.ts')
      }
    );

    expect(fileSystemTool.read).toHaveBeenCalledWith(path.join(workspaceRoot, 'src', 'main.ts'));
  });

  it('remove prefixo duplicado do nome do workspace em caminho relativo', async () => {
    const fileSystemTool = {
      read: vi.fn().mockResolvedValue('conteudo do arquivo'),
      write: vi.fn(),
      move: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      listRecursive: vi.fn().mockResolvedValue([])
    };

    const sut = new ActionExecutorService(
      fileSystemTool as never,
      { extract: vi.fn(), search: vi.fn() } as never,
      { createWord: vi.fn(), createSlides: vi.fn(), createSpreadsheet: vi.fn() } as never,
      { generateImage: vi.fn(), generateVideo: vi.fn(), generate3D: vi.fn() } as never,
      { connect: vi.fn() } as never,
      {
        ask: vi.fn(),
        askWithMeta: vi.fn(),
        getModelInfo: vi.fn().mockReturnValue({
          provider: 'openrouter',
          model: 'openrouter/auto',
          contextWindowTokens: 128000
        })
      } as never
    );

    const workspaceRoot = path.resolve('f:/Node Projects/home-ai-agent-hub');

    await sut.execute(
      { action: 'file.read', confidence: 0.9, reason: 'teste' },
      {
        text: 'Leia "home-ai-agent-hub/.env"',
        userId: 'u1',
        sessionId: 's1',
        workspaceRoot,
        activeFilePath: path.join(workspaceRoot, '.env')
      }
    );

    expect(fileSystemTool.read).toHaveBeenCalledWith(path.join(workspaceRoot, '.env'));
  });

  it('prioriza Arquivo ativo absoluto do contexto mesmo com espaços no caminho', async () => {
    const fileSystemTool = {
      read: vi.fn().mockResolvedValue('conteudo do arquivo'),
      write: vi.fn(),
      move: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      listRecursive: vi.fn().mockResolvedValue([])
    };

    const sut = new ActionExecutorService(
      fileSystemTool as never,
      { extract: vi.fn(), search: vi.fn() } as never,
      { createWord: vi.fn(), createSlides: vi.fn(), createSpreadsheet: vi.fn() } as never,
      { generateImage: vi.fn(), generateVideo: vi.fn(), generate3D: vi.fn() } as never,
      { connect: vi.fn() } as never,
      {
        ask: vi.fn(),
        askWithMeta: vi.fn(),
        getModelInfo: vi.fn().mockReturnValue({
          provider: 'openrouter',
          model: 'openrouter/auto',
          contextWindowTokens: 128000
        })
      } as never
    );

    const workspaceRoot = path.resolve('f:/Node Projects/home-ai-agent-hub');
    const absoluteFilePath = path.join(workspaceRoot, 'README.md');

    await sut.execute(
      { action: 'file.read', confidence: 0.9, reason: 'teste' },
      {
        text: `[Arquivo ativo absoluto: ${absoluteFilePath}]\n[Arquivo ativo relativo: README.md]\nLeia o arquivo ativo.`,
        userId: 'u1',
        sessionId: 's1',
        workspaceRoot,
        activeFilePath: absoluteFilePath
      }
    );

    expect(fileSystemTool.read).toHaveBeenCalledWith(absoluteFilePath);
  });

  it('sintetiza resposta em file.read quando pedido for explicativo', async () => {
    const fileSystemTool = {
      read: vi.fn().mockResolvedValue('# Projeto\nEste projeto implementa um agente de IA local.'),
      write: vi.fn(),
      move: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      listRecursive: vi.fn().mockResolvedValue([])
    };

    const llmGateway = {
      ask: vi.fn(),
      askWithMeta: vi.fn().mockResolvedValue({
        text: 'Seu projeto é um agente local de IA com foco em execução segura de tarefas.',
        provider: 'openrouter',
        model: 'openrouter/auto',
        contextWindowTokens: 128000,
        usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 },
        resolvedModel: 'openrouter/auto'
      }),
      getModelInfo: vi.fn().mockReturnValue({
        provider: 'openrouter',
        model: 'openrouter/auto',
        contextWindowTokens: 128000
      })
    };

    const sut = new ActionExecutorService(
      fileSystemTool as never,
      { extract: vi.fn(), search: vi.fn() } as never,
      { createWord: vi.fn(), createSlides: vi.fn(), createSpreadsheet: vi.fn() } as never,
      { generateImage: vi.fn(), generateVideo: vi.fn(), generate3D: vi.fn() } as never,
      { connect: vi.fn() } as never,
      llmGateway as never
    );

    const response = await sut.execute(
      { action: 'file.read', confidence: 0.9, reason: 'teste' },
      {
        text: 'Do que meu projeto se trata?',
        userId: 'u1',
        sessionId: 's1',
        activeFilePath: 'F:/repo/README.md'
      }
    );

    expect(llmGateway.askWithMeta).toHaveBeenCalled();
    expect(response.summary).toContain('agente local de IA');
    expect(response.steps[1]).toContain('Resposta sintetizada');
  });

  it('nao converte caminho absoluto do Windows com espacos em caminho relativo do workspace', async () => {
    const fileSystemTool = {
      read: vi.fn().mockResolvedValue('# Projeto\nResumo do projeto'),
      write: vi.fn(),
      move: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      listRecursive: vi.fn().mockResolvedValue([])
    };

    const llmGateway = {
      ask: vi.fn(),
      askWithMeta: vi.fn().mockResolvedValue({
        text: 'Resumo sintetizado',
        provider: 'openrouter',
        model: 'openrouter/auto',
        contextWindowTokens: 128000,
        usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
        resolvedModel: 'google/gemini-2.5-flash'
      }),
      getModelInfo: vi.fn().mockReturnValue({
        provider: 'openrouter',
        model: 'openrouter/auto',
        contextWindowTokens: 128000
      })
    };

    const sut = new ActionExecutorService(
      fileSystemTool as never,
      { extract: vi.fn(), search: vi.fn() } as never,
      { createWord: vi.fn(), createSlides: vi.fn(), createSpreadsheet: vi.fn() } as never,
      { generateImage: vi.fn(), generateVideo: vi.fn(), generate3D: vi.fn() } as never,
      { connect: vi.fn() } as never,
      llmGateway as never
    );

    await sut.execute(
      { action: 'file.read', confidence: 0.9, reason: 'teste' },
      {
        text: 'Do que se trata o projeto na pasta F:\\Node Projects\\home-ai-agent-hub ?',
        userId: 'u1',
        sessionId: 's1',
        workspaceRoot: 'F:/Node Projects/home-ai-agent-hub'
      }
    );

    expect(fileSystemTool.list).toHaveBeenCalledWith('F:\\Node Projects\\home-ai-agent-hub');
  });

  it('separa caminho absoluto do Windows do restante da frase no prompt', async () => {
    const fileSystemTool = {
      read: vi.fn().mockResolvedValue('# Projeto\nResumo do projeto'),
      write: vi.fn(),
      move: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      listRecursive: vi.fn().mockResolvedValue([])
    };

    const llmGateway = {
      ask: vi.fn(),
      askWithMeta: vi.fn().mockResolvedValue({
        text: 'Resumo sintetizado',
        provider: 'openrouter',
        model: 'openrouter/auto',
        contextWindowTokens: 128000,
        usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
        resolvedModel: 'google/gemini-2.5-flash'
      }),
      getModelInfo: vi.fn().mockReturnValue({
        provider: 'openrouter',
        model: 'openrouter/auto',
        contextWindowTokens: 128000
      })
    };

    const sut = new ActionExecutorService(
      fileSystemTool as never,
      { extract: vi.fn(), search: vi.fn() } as never,
      { createWord: vi.fn(), createSlides: vi.fn(), createSpreadsheet: vi.fn() } as never,
      { generateImage: vi.fn(), generateVideo: vi.fn(), generate3D: vi.fn() } as never,
      { connect: vi.fn() } as never,
      llmGateway as never
    );

    await sut.execute(
      { action: 'file.read', confidence: 0.9, reason: 'teste' },
      {
        text: 'Do que se trata o projeto na pasta F:\\Node Projects\\home-ai-agent-hub ? Resuma o que é, como funciona e como utilizar',
        userId: 'u1',
        sessionId: 's1',
        workspaceRoot: 'F:/Node Projects/home-ai-agent-hub'
      }
    );

    expect(fileSystemTool.list).toHaveBeenCalledWith('F:\\Node Projects\\home-ai-agent-hub');
  });

  it('trata caminho de diretório em file.read com listagem e síntese sem EISDIR', async () => {
    const fileSystemTool = {
      read: vi.fn().mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('README.md')) {
          return '# Home AI Agent Hub\nProjeto para agente local com OpenRouter.';
        }
        if (filePath.endsWith('package.json')) {
          return '{"name":"home-ai-agent-hub","scripts":{"dev":"tsx src/main.ts"}}';
        }
        throw new Error('arquivo nao encontrado');
      }),
      write: vi.fn(),
      move: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      list: vi.fn().mockResolvedValue(['README.md', 'src/main.ts', 'package.json']),
      listRecursive: vi.fn().mockResolvedValue([])
    };

    const llmGateway = {
      ask: vi.fn(),
      askWithMeta: vi.fn().mockResolvedValue({
        text: 'É um hub de agente de IA local com API/UI; funciona por classificação, segurança e execução de tools.',
        provider: 'openrouter',
        model: 'openrouter/auto',
        contextWindowTokens: 128000,
        usage: { inputTokens: 120, outputTokens: 55, totalTokens: 175 },
        resolvedModel: 'google/gemini-2.5-flash'
      }),
      getModelInfo: vi.fn().mockReturnValue({
        provider: 'openrouter',
        model: 'openrouter/auto',
        contextWindowTokens: 128000
      })
    };

    const sut = new ActionExecutorService(
      fileSystemTool as never,
      { extract: vi.fn(), search: vi.fn() } as never,
      { createWord: vi.fn(), createSlides: vi.fn(), createSpreadsheet: vi.fn() } as never,
      { generateImage: vi.fn(), generateVideo: vi.fn(), generate3D: vi.fn() } as never,
      { connect: vi.fn() } as never,
      llmGateway as never
    );

    const response = await sut.execute(
      { action: 'file.read', confidence: 0.9, reason: 'teste' },
      {
        text: 'Do que se trata o projeto na pasta F:\\Node Projects\\home-ai-agent-hub ? Resuma o que é, como funciona e como utilizar',
        userId: 'u1',
        sessionId: 's1'
      }
    );

    expect(fileSystemTool.list).toHaveBeenCalledWith('F:\\Node Projects\\home-ai-agent-hub');
    expect(llmGateway.askWithMeta).toHaveBeenCalled();
    expect(response.summary).toContain('hub de agente de IA local');
    expect(response.steps[0]).toContain('Diretório analisado');
  });

  it('aceita fallback de file.replace com caminho + novo conteúdo', async () => {
    const fileSystemTool = {
      read: vi.fn(),
      write: vi.fn().mockResolvedValue(undefined),
      move: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      listRecursive: vi.fn().mockResolvedValue([])
    };

    const sut = new ActionExecutorService(
      fileSystemTool as never,
      { extract: vi.fn(), search: vi.fn() } as never,
      { createWord: vi.fn(), createSlides: vi.fn(), createSpreadsheet: vi.fn() } as never,
      { generateImage: vi.fn(), generateVideo: vi.fn(), generate3D: vi.fn() } as never,
      { connect: vi.fn() } as never,
      {
        ask: vi.fn(),
        askWithMeta: vi.fn(),
        getModelInfo: vi.fn().mockReturnValue({
          provider: 'openrouter',
          model: 'openrouter/auto',
          contextWindowTokens: 128000
        })
      } as never
    );

    const workspaceRoot = path.resolve('f:/Node Projects/home-ai-agent-hub');
    const expectedPath = path.join(workspaceRoot, 'workspace', 'testeeditar.txt');

    const result = await sut.execute(
      { action: 'file.replace', confidence: 0.9, reason: 'teste' },
      {
        text: 'editar "workspace/testeeditar.txt" "novo conteúdo completo"',
        userId: 'u1',
        sessionId: 's1',
        workspaceRoot
      }
    );

    expect(fileSystemTool.write).toHaveBeenCalledWith(expectedPath, 'novo conteúdo completo');
    expect(fileSystemTool.replace).not.toHaveBeenCalled();
    expect(result.summary).toContain('Conteúdo atualizado em');
  });

  it('aceita fallback de file.replace com conteúdo sem aspas no prompt', async () => {
    const fileSystemTool = {
      read: vi.fn(),
      write: vi.fn().mockResolvedValue(undefined),
      move: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      listRecursive: vi.fn().mockResolvedValue([])
    };

    const sut = new ActionExecutorService(
      fileSystemTool as never,
      { extract: vi.fn(), search: vi.fn() } as never,
      { createWord: vi.fn(), createSlides: vi.fn(), createSpreadsheet: vi.fn() } as never,
      { generateImage: vi.fn(), generateVideo: vi.fn(), generate3D: vi.fn() } as never,
      { connect: vi.fn() } as never,
      {
        ask: vi.fn(),
        askWithMeta: vi.fn(),
        getModelInfo: vi.fn().mockReturnValue({
          provider: 'openrouter',
          model: 'openrouter/auto',
          contextWindowTokens: 128000
        })
      } as never
    );

    const workspaceRoot = path.resolve('f:/Node Projects/home-ai-agent-hub');
    const expectedPath = path.join(workspaceRoot, 'workspace', 'testeeditar.txt');

    await sut.execute(
      { action: 'file.replace', confidence: 0.9, reason: 'teste' },
      {
        text: 'editar workspace/testeeditar.txt com novo conteúdo completo sem aspas',
        userId: 'u1',
        sessionId: 's1',
        workspaceRoot
      }
    );

    expect(fileSystemTool.write).toHaveBeenCalledWith(
      expectedPath,
      'novo conteúdo completo sem aspas'
    );
    expect(fileSystemTool.replace).not.toHaveBeenCalled();
  });

  it('aceita fallback de file.replace com nome de arquivo simples sem aspas', async () => {
    const fileSystemTool = {
      read: vi.fn(),
      write: vi.fn().mockResolvedValue(undefined),
      move: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      listRecursive: vi.fn().mockResolvedValue([])
    };

    const sut = new ActionExecutorService(
      fileSystemTool as never,
      { extract: vi.fn(), search: vi.fn() } as never,
      { createWord: vi.fn(), createSlides: vi.fn(), createSpreadsheet: vi.fn() } as never,
      { generateImage: vi.fn(), generateVideo: vi.fn(), generate3D: vi.fn() } as never,
      { connect: vi.fn() } as never,
      {
        ask: vi.fn(),
        askWithMeta: vi.fn(),
        getModelInfo: vi.fn().mockReturnValue({
          provider: 'openrouter',
          model: 'openrouter/auto',
          contextWindowTokens: 128000
        })
      } as never
    );

    const workspaceRoot = path.resolve('f:/Node Projects/home-ai-agent-hub');
    const expectedPath = path.join(workspaceRoot, 'testeeditar.txt');

    await sut.execute(
      { action: 'file.replace', confidence: 0.9, reason: 'teste' },
      {
        text: 'edite testeeditar.txt com dados do modelo de LLM',
        userId: 'u1',
        sessionId: 's1',
        workspaceRoot
      }
    );

    expect(fileSystemTool.write).toHaveBeenCalledWith(
      expectedPath,
      'modelo: openrouter/auto\nprovider: openrouter\ncontext_window_tokens: 128000'
    );
    expect(fileSystemTool.replace).not.toHaveBeenCalled();
  });

  it('materializa dados do modelo em vez de gravar instrucao literal', async () => {
    const fileSystemTool = {
      read: vi.fn(),
      write: vi.fn().mockResolvedValue(undefined),
      move: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      listRecursive: vi.fn().mockResolvedValue([])
    };

    const sut = new ActionExecutorService(
      fileSystemTool as never,
      { extract: vi.fn(), search: vi.fn() } as never,
      { createWord: vi.fn(), createSlides: vi.fn(), createSpreadsheet: vi.fn() } as never,
      { generateImage: vi.fn(), generateVideo: vi.fn(), generate3D: vi.fn() } as never,
      { connect: vi.fn() } as never,
      {
        ask: vi.fn(),
        askWithMeta: vi.fn(),
        getModelInfo: vi.fn().mockReturnValue({
          provider: 'openrouter',
          model: 'openrouter/auto',
          contextWindowTokens: 128000
        })
      } as never
    );

    const workspaceRoot = path.resolve('f:/Node Projects/home-ai-agent-hub');
    const expectedPath = path.join(workspaceRoot, 'testeeditar.txt');

    await sut.execute(
      { action: 'file.replace', confidence: 0.9, reason: 'teste' },
      {
        text: 'edite testeeditar.txt e escreva nele os dados do modelo de LLM que está sendo usado',
        userId: 'u1',
        sessionId: 's1',
        workspaceRoot
      }
    );

    expect(fileSystemTool.write).toHaveBeenCalledWith(
      expectedPath,
      'modelo: openrouter/auto\nprovider: openrouter\ncontext_window_tokens: 128000'
    );
  });

  it('salva edição no mesmo diretório do arquivo carregado anteriormente', async () => {
    const fileSystemTool = {
      read: vi.fn().mockResolvedValue('conteudo-lido'),
      write: vi.fn().mockResolvedValue(undefined),
      move: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      listRecursive: vi.fn().mockResolvedValue([])
    };

    const sut = new ActionExecutorService(
      fileSystemTool as never,
      { extract: vi.fn(), search: vi.fn() } as never,
      { createWord: vi.fn(), createSlides: vi.fn(), createSpreadsheet: vi.fn() } as never,
      { generateImage: vi.fn(), generateVideo: vi.fn(), generate3D: vi.fn() } as never,
      { connect: vi.fn() } as never,
      {
        ask: vi.fn(),
        askWithMeta: vi.fn(),
        getModelInfo: vi.fn().mockReturnValue({
          provider: 'openrouter',
          model: 'openrouter/auto',
          contextWindowTokens: 128000
        })
      } as never
    );

    const desktopFilePath = path.join(os.homedir(), 'Desktop', 'testeeditar.txt');

    await sut.execute(
      { action: 'file.read', confidence: 0.9, reason: 'teste' },
      {
        text: 'Leia o arquivo testeeditar.txt na minha área de trabalho',
        userId: 'u1',
        sessionId: 's1'
      }
    );

    await sut.execute(
      { action: 'file.replace', confidence: 0.9, reason: 'teste' },
      {
        text: 'edite testeeditar.txt com conteúdo atualizado',
        userId: 'u1',
        sessionId: 's1'
      }
    );

    expect(fileSystemTool.read).toHaveBeenCalledWith(desktopFilePath);
    expect(fileSystemTool.write).toHaveBeenCalledWith(desktopFilePath, 'conteúdo atualizado');
  });
});
