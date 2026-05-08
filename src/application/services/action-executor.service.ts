import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import type {
  ActionPlan,
  AgentRequest,
  AgentResponse,
  ExecutionReport,
  ModelUsage,
  ToolUsage
} from '../../core/domain/agent-types.js';
import type { ActionExecutor } from '../../core/ports/agent-services.js';
import type { FileSystemTool, McpToolConnector, MediaTool, OfficeDocumentTool, WebTool } from '../../core/ports/tools.js';
import type { LlmGateway } from '../../infrastructure/llm/openrouter-chat.gateway.js';
import { TaskPlannerService } from './task-planner.service.js';

interface SlideWithMedia {
  title: string;
  bullets: string[];
  imageUrl?: string;
  imageSource?: string;
}

interface TopicMedia {
  imageUrl: string;
  sourceUrl: string;
}

export class ActionExecutorService implements ActionExecutor {
  private readonly taskPlanner: TaskPlannerService;

  constructor(
    private readonly fileSystemTool: FileSystemTool,
    private readonly webTool: WebTool,
    private readonly officeTool: OfficeDocumentTool,
    private readonly mediaTool: MediaTool,
    private readonly mcpConnector: McpToolConnector,
    private readonly llmGateway: LlmGateway
  ) {
    this.taskPlanner = new TaskPlannerService(llmGateway);
  }

  async execute(plan: ActionPlan, request: AgentRequest): Promise<AgentResponse> {
    const start = Date.now();

    switch (plan.action) {
      case 'file.read': {
        const target = this.resolveRequestPath(
          request,
          this.parsePath(request.text) ?? request.activeFilePath ?? './workspace/notes.txt'
        );

        const stat = await fs.stat(target).catch(() => null);
        if (stat?.isDirectory()) {
          const listed = await this.fileSystemTool.list(target);
          const entries = Array.isArray(listed) ? listed : [];

          if (this.shouldSynthesizeReadAnswer(request.text)) {
            const directoryContext = await this.buildDirectorySummaryContext(target);
            const synthesis = await this.llmGateway.askWithMeta(
              [
                'Você deve responder à solicitação do usuário com base no contexto de um diretório de projeto local.',
                'Objetivo: explicar de forma objetiva o que é o projeto, como funciona e como utilizar.',
                'Se o contexto estiver incompleto, deixe explícitas as limitações da resposta.',
                `Solicitação do usuário: ${request.text}`,
                `Diretório analisado: ${target}`,
                `Entradas no diretório (até 120):\n${entries.slice(0, 120).join('\n')}`,
                directoryContext
              ].join('\n\n'),
              { operation: 'directory_read_synthesis' }
            );

            return this.ok(synthesis.text.trim(), [
              `Diretório analisado: ${target}`,
              `Itens encontrados: ${entries.length}`,
              'Resposta sintetizada a partir da estrutura e arquivos principais do diretório.'
            ], {
              action: plan.action,
              tool: 'LocalFileSystemTool.list + OpenRouterChatGateway.askWithMeta',
              durationMs: Date.now() - start,
              details: `${target} (${entries.length} itens)`,
              modelUsage: {
                provider: synthesis.provider,
                model: synthesis.model,
                contextWindowTokens: synthesis.contextWindowTokens,
                ...(typeof synthesis.usage?.inputTokens === 'number'
                  ? { inputTokens: synthesis.usage.inputTokens }
                  : {}),
                ...(typeof synthesis.usage?.outputTokens === 'number'
                  ? { outputTokens: synthesis.usage.outputTokens }
                  : {}),
                ...(typeof synthesis.usage?.totalTokens === 'number'
                  ? { totalTokens: synthesis.usage.totalTokens }
                  : {})
              },
              ...(synthesis.resolvedModel ? { resolvedModel: synthesis.resolvedModel } : {})
            });
          }

          return this.ok(`Diretório listado: ${target}`, entries.slice(0, 30), {
            action: plan.action,
            tool: 'LocalFileSystemTool.list',
            durationMs: Date.now() - start,
            details: `${target} (${entries.length} itens)`
          });
        }

        const content = await this.fileSystemTool.read(target);

        if (this.shouldSynthesizeReadAnswer(request.text)) {
          const synthesis = await this.llmGateway.askWithMeta(
            [
              'Você deve responder à solicitação do usuário usando o conteúdo de arquivo fornecido.',
              'Objetivo: entregar uma resposta final formatada e objetiva, não retornar dump bruto do arquivo.',
              'Se faltar contexto para responder com segurança, diga explicitamente o que está faltando.',
              `Solicitação do usuário: ${request.text}`,
              `Arquivo analisado: ${target}`,
              'Conteúdo do arquivo:',
              content.slice(0, 24000)
            ].join('\n\n'),
            { operation: 'file_read_synthesis' }
          );

          return this.ok(synthesis.text.trim(), [
            `Arquivo analisado: ${target}`,
            'Resposta sintetizada a partir do conteúdo lido.'
          ], {
            action: plan.action,
            tool: 'LocalFileSystemTool.read + OpenRouterChatGateway.askWithMeta',
            durationMs: Date.now() - start,
            details: target,
            modelUsage: {
              provider: synthesis.provider,
              model: synthesis.model,
              contextWindowTokens: synthesis.contextWindowTokens,
              ...(typeof synthesis.usage?.inputTokens === 'number'
                ? { inputTokens: synthesis.usage.inputTokens }
                : {}),
              ...(typeof synthesis.usage?.outputTokens === 'number'
                ? { outputTokens: synthesis.usage.outputTokens }
                : {}),
              ...(typeof synthesis.usage?.totalTokens === 'number'
                ? { totalTokens: synthesis.usage.totalTokens }
                : {})
            },
            ...(synthesis.resolvedModel ? { resolvedModel: synthesis.resolvedModel } : {})
          });
        }

        return this.ok(`Arquivo lido: ${target}`, [content.slice(0, 500)], {
          action: plan.action,
          tool: 'LocalFileSystemTool.read',
          durationMs: Date.now() - start,
          details: target
        });
      }
      case 'file.write': {
        const target = this.resolveRequestPath(
          request,
          this.parsePath(request.text) ?? './workspace/output.txt'
        );
        await this.fileSystemTool.write(target, request.text);
        return this.ok(`Arquivo escrito: ${target}`, ['Conteúdo salvo com sucesso'], {
          action: plan.action,
          tool: 'LocalFileSystemTool.write',
          durationMs: Date.now() - start,
          details: target
        });
      }
      case 'file.move': {
        const [source, target] = this.parseTwoPaths(request.text, request);
        await this.fileSystemTool.move(source, target);
        return this.ok(`Arquivo movido de ${source} para ${target}`, ['Movimentação concluída'], {
          action: plan.action,
          tool: 'LocalFileSystemTool.move',
          durationMs: Date.now() - start,
          details: `${source} -> ${target}`
        });
      }
      case 'file.replace': {
        const [filePath, search, replaceWith] = this.parseReplaceArgs(request.text, request);
        await this.fileSystemTool.replace(filePath, search, replaceWith);
        return this.ok(`Conteúdo substituído em ${filePath}`, [
          `Trecho substituído: "${search}" -> "${replaceWith}"`
        ], {
          action: plan.action,
          tool: 'LocalFileSystemTool.replace',
          durationMs: Date.now() - start,
          details: filePath
        });
      }
      case 'file.delete': {
        const target = this.resolveRequestPath(
          request,
          this.parsePath(request.text) ?? './workspace/output.txt'
        );
        await this.fileSystemTool.delete(target);
        return this.ok(`Arquivo removido: ${target}`, ['Remoção concluída'], {
          action: plan.action,
          tool: 'LocalFileSystemTool.delete',
          durationMs: Date.now() - start,
          details: target
        });
      }
      case 'fs.list': {
        const target = this.resolveRequestPath(
          request,
          this.parsePath(request.text) ?? request.workspaceRoot ?? './workspace'
        );
        const files = await this.fileSystemTool.list(target);
        return this.ok(`Diretório listado: ${target}`, files.slice(0, 30), {
          action: plan.action,
          tool: 'LocalFileSystemTool.list',
          durationMs: Date.now() - start,
          details: `${target} (${files.length} itens)`
        });
      }
      case 'web.extract': {
        const explicitUrl = this.parseUrl(request.text);

        if (explicitUrl) {
          const content = await this.webTool.extract(explicitUrl);
          return this.ok(`Conteúdo extraído de ${explicitUrl}`, [content.slice(0, 800)], {
            action: plan.action,
            tool: 'PlaywrightWebTool.extract',
            durationMs: Date.now() - start,
            details: explicitUrl
          });
        }

        const searchQuery = this.buildSearchQuery(request.text);
        const research = await this.webTool.search(searchQuery, 4);
        const synthesis = await this.llmGateway.askWithMeta(
          [
            'Você recebeu um pacote de pesquisa coletado de múltiplas páginas web.',
            'Responda em português de forma objetiva: melhor opção e comparação curta entre alternativas citadas.',
            `Pergunta do usuário: ${request.text}`,
            `Pesquisa coletada:\n${research}`
          ].join('\n\n'),
          { operation: 'web_research_synthesis' }
        );

        return this.ok(`Pesquisa na internet concluída para: ${searchQuery}`, [synthesis.text.slice(0, 1200)], {
          action: plan.action,
          tool: 'PlaywrightWebTool.search',
          durationMs: Date.now() - start,
          details: `bing query: ${searchQuery}`,
          modelUsage: {
            provider: synthesis.provider,
            model: synthesis.model,
            contextWindowTokens: synthesis.contextWindowTokens,
            ...(typeof synthesis.usage?.inputTokens === 'number'
              ? { inputTokens: synthesis.usage.inputTokens }
              : {}),
            ...(typeof synthesis.usage?.outputTokens === 'number'
              ? { outputTokens: synthesis.usage.outputTokens }
              : {}),
            ...(typeof synthesis.usage?.totalTokens === 'number'
              ? { totalTokens: synthesis.usage.totalTokens }
              : {})
          },
          ...(synthesis.resolvedModel ? { resolvedModel: synthesis.resolvedModel } : {})
        });
      }
      case 'doc.create': {
        const output = './workspace/documento.docx';
        await this.officeTool.createWord('Documento gerado pelo agente', request.text, output);
        return this.ok('Documento Word criado', [output], {
          action: plan.action,
          tool: 'OfficeDocumentTool.createWord',
          durationMs: Date.now() - start,
          details: output
        });
      }
      case 'slide.create': {
        const output = './workspace/apresentacao.pptx';
        
        if (plan.isComplexTask && plan.mainTopic) {
          return await this.executeComplexSlideGeneration(plan, request, start, output);
        }

        await this.officeTool.createSlides('Apresentação do Agente', [request.text], output);
        return this.ok('Apresentação criada', [output], {
          action: plan.action,
          tool: 'OfficeDocumentTool.createSlides',
          durationMs: Date.now() - start,
          details: output
        });
      }
      case 'sheet.create': {
        const output = request.text.includes('csv')
          ? './workspace/planilha.csv'
          : './workspace/planilha.xlsx';
        const rows = await this.buildSpreadsheetRows(request.text);
        await this.officeTool.createSpreadsheet(rows, output);
        return this.ok('Planilha criada', [output, `Linhas geradas: ${Math.max(0, rows.length - 1)}`], {
          action: plan.action,
          tool: 'OfficeDocumentTool.createSpreadsheet',
          durationMs: Date.now() - start,
          details: `${output} (catalogo)`
        });
      }
      case 'mcp.connect': {
        const result = await this.mcpConnector.connect('default', 'sse', 'http://localhost:3001/sse');
        return this.ok('Conector MCP executado', [result], {
          action: plan.action,
          tool: 'McpToolConnector.connect',
          durationMs: Date.now() - start
        });
      }
      case 'image.generate': {
        const result = await this.mediaTool.generateImage(request.text);
        return this.ok('Solicitação de imagem processada', [result], {
          action: plan.action,
          tool: 'MediaTool.generateImage',
          durationMs: Date.now() - start
        });
      }
      case 'video.generate': {
        const result = await this.mediaTool.generateVideo(request.text);
        return this.ok('Solicitação de vídeo processada', [result], {
          action: plan.action,
          tool: 'MediaTool.generateVideo',
          durationMs: Date.now() - start
        });
      }
      case 'model3d.generate': {
        const result = await this.mediaTool.generate3D(request.text);
        return this.ok('Solicitação 3D processada', [result], {
          action: plan.action,
          tool: 'MediaTool.generate3D',
          durationMs: Date.now() - start
        });
      }
      default: {
        const answer = await this.llmGateway.askWithMeta(request.text, {
          operation: 'chat_reply',
          ...(plan.composedInstruction ? { systemPrompt: plan.composedInstruction.systemPrompt } : {})
        });
        const modelUsage: ModelUsage = {
          provider: answer.provider,
          model: answer.model,
          contextWindowTokens: answer.contextWindowTokens,
          ...(typeof answer.usage?.inputTokens === 'number'
            ? { inputTokens: answer.usage.inputTokens }
            : {}),
          ...(typeof answer.usage?.outputTokens === 'number'
            ? { outputTokens: answer.usage.outputTokens }
            : {}),
          ...(typeof answer.usage?.totalTokens === 'number'
            ? { totalTokens: answer.usage.totalTokens }
            : {})
        };

        return this.ok('Resposta conversacional', [answer.text.slice(0, 1000)], {
          action: plan.action,
          tool: 'OpenRouterChatGateway.askWithMeta',
          durationMs: Date.now() - start,
          modelUsage,
          ...(answer.resolvedModel ? { resolvedModel: answer.resolvedModel } : {})
        });
      }
    }
  }

  /**
   * Execute complex slide generation with research + decomposition
   * Follows ReAct pattern: Reasoning -> Task Planning -> Research -> Synthesis -> Generation
   */
  private async executeComplexSlideGeneration(
    plan: ActionPlan,
    request: AgentRequest,
    start: number,
    output: string
  ): Promise<AgentResponse> {
    try {
      // Step 1: Extract main topics for the research
      const topic = plan.mainTopic!;
      request.onProgress?.({
        stage: 'slide_pipeline',
        message: `Iniciando pipeline de geração de slides para: ${topic}`,
        timestamp: new Date().toISOString()
      });
      const requestedSlideCount = this.extractRequestedSlideCount(request.text);
      const topics = await this.taskPlanner.extractTopics(topic, requestedSlideCount);
      request.onProgress?.({
        stage: 'topic_extraction',
        message: `Subtópicos extraídos: ${topics.length}`,
        timestamp: new Date().toISOString()
      });
      
      // Step 2: Research each topic
      const researchByTopic: Record<string, string> = {};
      const mediaByTopic: Record<string, TopicMedia | undefined> = {};
      for (const topicName of topics) {
        try {
          request.onProgress?.({
            stage: 'web_research',
            message: `Consultando fontes para: ${topicName}`,
            timestamp: new Date().toISOString()
          });
          const searchQuery = `${topicName} ${topic} contexto aplicação`;
          const research = await this.webTool.search(searchQuery, 3);
          researchByTopic[topicName] = research.slice(0, 8000);
          mediaByTopic[topicName] = this.extractBestMediaFromResearch(research);
          request.onProgress?.({
            stage: 'web_research',
            message: `Consulta concluída para: ${topicName}`,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          researchByTopic[topicName] = `Informações sobre ${topicName} relacionado ao tema principal.`;
          mediaByTopic[topicName] = undefined;
          request.onProgress?.({
            stage: 'web_research',
            message: `Falha ao consultar ${topicName}, usando fallback de conteúdo.`,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Step 3: Process raw research before slide synthesis
      request.onProgress?.({
        stage: 'research_processing',
        message: 'Processando dados brutos de pesquisa em notas estruturadas.',
        timestamp: new Date().toISOString()
      });
      const processedResearchByTopic = await this.taskPlanner.processResearchByTopic(topic, researchByTopic);
      
      // Step 4: Synthesize processed content into slide structure
      request.onProgress?.({
        stage: 'slide_synthesis',
        message: 'Sintetizando estrutura final dos slides.',
        timestamp: new Date().toISOString()
      });
      const slideStructure = await this.taskPlanner.synthesizeSlideStructure(
        topic,
        processedResearchByTopic,
        requestedSlideCount
      );

      const slidesWithMedia = this.attachMediaToSlides(slideStructure, topics, mediaByTopic);
      const slidesWithImageCount = slidesWithMedia.filter((slide) => !!slide.imageUrl).length;
      
      // Step 5: Generate slides with synthesized content (pass structured slides, not bullets)
      request.onProgress?.({
        stage: 'slide_render',
        message: `Renderizando ${slidesWithMedia.length} slides no arquivo PPTX.`,
        timestamp: new Date().toISOString()
      });
      await this.officeTool.createSlides(topic, slidesWithMedia, output);
      request.onProgress?.({
        stage: 'slide_render',
        message: 'Renderização de slides finalizada.',
        timestamp: new Date().toISOString()
      });
      
      const steps = [
        `✓ Identificado tópico principal: ${topic}`,
        `✓ Quantidade solicitada: ${requestedSlideCount ?? 'não informada (automático por conteúdo)'}`,
        `✓ Extraídos ${topics.length} subtópicos para pesquisa`,
        `✓ Pesquisa realizada para cada tópico`,
        `✓ Imagens relevantes capturadas: ${slidesWithImageCount}`,
        `✓ Dados brutos processados em notas estruturadas`,
        `✓ Síntese concluída: ${slidesWithMedia.length} slides gerados com conteúdo estruturado`,
        `✓ Apresentação criada: ${output}`
      ];
      
      return this.ok(
        `Apresentação com pesquisa criada: ${slidesWithMedia.length} slides sobre "${topic}"`,
        steps,
        {
          action: plan.action,
          tool: 'TaskPlanner + PlaywrightWebTool + OfficeDocumentTool.createSlides',
          durationMs: Date.now() - start,
          details: `${output} (${slidesWithMedia.length} slides com texto + imagem quando disponível)`
        }
      );
    } catch (error) {
      // Fallback to simple slide generation on error
      await this.officeTool.createSlides('Apresentação do Agente', [request.text], output);
      return this.ok(`Apresentação criada (fallback)`, [output], {
        action: plan.action,
        tool: 'OfficeDocumentTool.createSlides (fallback)',
        durationMs: Date.now() - start,
        details: `${output} (fallback após erro no planejamento)`
      });
    }
  }

  private extractRequestedSlideCount(text: string): number | undefined {
    const match = text.match(/(\d{1,3})\s*(?:slides?|p[aá]ginas?)/i);
    if (!match?.[1]) {
      return undefined;
    }

    const parsed = Number.parseInt(match[1], 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      return undefined;
    }

    return Math.min(parsed, 60);
  }

  private extractBestMediaFromResearch(research: string): TopicMedia | undefined {
    const imageRegex = /Imagem:\s*(https?:\/\/\S+)/i;
    const sourceRegex = /ImagemFonte:\s*(https?:\/\/\S+)/i;
    const urlRegex = /URL:\s*(https?:\/\/\S+)/i;

    const imageMatch = research.match(imageRegex);
    if (!imageMatch?.[1]) {
      return undefined;
    }

    const sourceMatch = research.match(sourceRegex) ?? research.match(urlRegex);
    return {
      imageUrl: imageMatch[1].trim(),
      sourceUrl: sourceMatch?.[1]?.trim() ?? imageMatch[1].trim()
    };
  }

  private attachMediaToSlides(
    slides: Array<{ title: string; bullets: string[] }>,
    topics: string[],
    mediaByTopic: Record<string, TopicMedia | undefined>
  ): SlideWithMedia[] {
    const availableTopics = topics.filter((topic) => !!mediaByTopic[topic]);
    const usedTopics = new Set<string>();

    return slides.map((slide) => {
      const bestTopic = this.findBestTopicForSlide(slide.title, availableTopics, usedTopics);
      const media = bestTopic ? mediaByTopic[bestTopic] : undefined;
      if (bestTopic) {
        usedTopics.add(bestTopic);
      }

      return {
        title: slide.title,
        bullets: slide.bullets,
        ...(media
          ? {
              imageUrl: media.imageUrl,
              imageSource: media.sourceUrl
            }
          : {})
      };
    });
  }

  private findBestTopicForSlide(
    slideTitle: string,
    candidateTopics: string[],
    usedTopics: Set<string>
  ): string | undefined {
    const available = candidateTopics.filter((topic) => !usedTopics.has(topic));
    if (available.length === 0) {
      return undefined;
    }

    const slideTokens = this.tokenize(slideTitle);
    let bestTopic: string | undefined;
    let bestScore = -1;

    for (const topic of available) {
      const topicTokens = this.tokenize(topic);
      const overlap = topicTokens.filter((token) => slideTokens.includes(token)).length;
      if (overlap > bestScore) {
        bestScore = overlap;
        bestTopic = topic;
      }
    }

    if (bestScore <= 0) {
      return available[0];
    }

    return bestTopic;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3)
      .slice(0, 16);
  }

  private async buildSpreadsheetRows(text: string): Promise<string[][]> {
    const shouldCatalogFiles = /(catalog|catalogar|listar|inventari|arquivos?|file list)/i.test(text);
    if (!shouldCatalogFiles) {
      return [
        ['coluna_1', 'coluna_2'],
        ['valor_a', 'valor_b']
      ];
    }

    const sourceDir = this.resolveCatalogSourceDirectory(text);
    const files = await this.fileSystemTool.listRecursive(sourceDir);

    const header = ['nome', 'caminho', 'extensao', 'tamanho_bytes', 'modificado_em'];
    const rows = await Promise.all(
      files.slice(0, 5000).map(async (filePath) => {
        const stat = await fs.stat(filePath);
        return [
          path.basename(filePath),
          filePath,
          path.extname(filePath) || '(sem_extensao)',
          String(stat.size),
          stat.mtime.toISOString()
        ];
      })
    );

    return [header, ...rows];
  }

  private resolveCatalogSourceDirectory(text: string): string {
    const parsedPath = this.parsePath(text);
    if (parsedPath) {
      return parsedPath;
    }

    if (/(area de trabalho|desktop)/i.test(text)) {
      return path.join(os.homedir(), 'Desktop');
    }

    if (/(downloads?|baixados?)/i.test(text)) {
      return path.join(os.homedir(), 'Downloads');
    }

    if (/(documentos?|documents)/i.test(text)) {
      return path.join(os.homedir(), 'Documents');
    }

    return './workspace';
  }

  private parseUrl(text: string): string | null {
    const match = text.match(/https?:\/\/\S+/);
    return match?.[0] ?? null;
  }

  private shouldSynthesizeReadAnswer(text: string): boolean {
    return /(\?|resuma|resumo|explique|do que .*se trata|o que .*fala|what .*about|summari[sz]e|explain)/i.test(
      text
    );
  }

  private async buildDirectorySummaryContext(directoryPath: string): Promise<string> {
    const snippets: string[] = [];
    const candidateFiles = ['README.md', 'package.json', 'specs/00-product-vision.md'];

    for (const relative of candidateFiles) {
      const candidatePath = path.join(directoryPath, relative);
      try {
        const content = await this.fileSystemTool.read(candidatePath);
        snippets.push(`${relative}:\n${content.slice(0, 5000)}`);
      } catch {
        // Arquivo opcional; ignora quando ausente.
      }
    }

    if (snippets.length === 0) {
      return 'Nenhum arquivo de contexto (README/package/spec) pôde ser lido.';
    }

    return `Contexto de arquivos-chave:\n\n${snippets.join('\n\n---\n\n')}`;
  }

  private buildSearchQuery(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const examplesPartMatch = normalized.match(/exemplos?\s*[:-]\s*(.+)$/i);
    const exampleTerms = examplesPartMatch?.[1]
      ? examplesPartMatch[1]
          .split(/[;,]|\be\b/i)
          .map((item) => item.trim())
          .filter((item) => item.length >= 2)
          .slice(0, 4)
      : [];

    const topic = normalized
      .replace(/^(pesquise|busque|procure|search)\s+/i, '')
      .replace(/na internet|online/gi, '')
      .replace(/exemplos?\s*[:-].+$/i, '')
      .replace(/me retorne|qual a melhor para utilizar/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);

    if (exampleTerms.length > 0) {
      return `${exampleTerms.join(' ')} ${topic} comparação prós e contras`;
    }

    return `${topic} fontes confiáveis comparação`.trim().slice(0, 240);
  }

  private parsePath(text: string): string | null {
    const contextAbsolutePath = text.match(/\[Arquivo ativo absoluto:\s*([^\]\r\n]+)\]/i);
    if (contextAbsolutePath?.[1]) {
      return path.normalize(contextAbsolutePath[1].trim());
    }

    const contextRelativePath = text.match(/\[Arquivo ativo relativo:\s*([^\]\r\n]+)\]/i);
    if (contextRelativePath?.[1] && this.looksLikePath(contextRelativePath[1].trim())) {
      return path.normalize(contextRelativePath[1].trim());
    }

    const quotedPath = this.parseQuotedValues(text).find((value) => this.looksLikePath(value));
    if (quotedPath) {
      return path.normalize(quotedPath);
    }

    const windowsAbsolute = this.extractWindowsAbsolutePath(text);
    if (windowsAbsolute) {
      return path.normalize(windowsAbsolute);
    }

    const repoRelative = text.match(/\b[\w.-]+(?:[\\/][\w.-]+)+\b/);
    if (repoRelative?.[0] && this.looksLikePath(repoRelative[0])) {
      return path.normalize(repoRelative[0]);
    }

    const unixLike = text.match(/\/[\w./-]+/);
    if (unixLike?.[0]) {
      return unixLike[0];
    }

    const relative = text.match(/(?:\.\.?[\\/]|workspace[\\/])[\w./\\-]+/);
    return relative?.[0] ?? null;
  }

  private extractWindowsAbsolutePath(text: string): string | null {
    const match = text.match(/[a-zA-Z]:\\(?:[^<>:"/\\|?*\r\n]+\\)*[^<>:"/\\|?*\r\n]*/);
    if (!match?.[0]) {
      return null;
    }

    return match[0].trim().replace(/[ .]+$/, '').trim();
  }

  private parseTwoPaths(text: string, request: AgentRequest): [string, string] {
    const quoted = this.parseQuotedValues(text).filter((value) => this.looksLikePath(value));
    const quotedSource = quoted[0];
    const quotedTarget = quoted[1];
    if (quotedSource && quotedTarget) {
      return [
        this.resolveRequestPath(request, path.normalize(quotedSource)),
        this.resolveRequestPath(request, path.normalize(quotedTarget))
      ];
    }

    const source = this.parsePath(text);
    if (!source) {
      throw new Error('Não foi possível identificar o caminho de origem para file.move.');
    }

    const withoutSource = text.replace(source, '');
    const target = this.parsePath(withoutSource);
    if (!target) {
      throw new Error('Não foi possível identificar o caminho de destino para file.move.');
    }

    return [this.resolveRequestPath(request, source), this.resolveRequestPath(request, target)];
  }

  private parseReplaceArgs(text: string, request: AgentRequest): [string, string, string] {
    const quoted = this.parseQuotedValues(text);
    const filePath = quoted[0];
    const search = quoted[1];
    const replaceWith = quoted[2];
    if (filePath && search && replaceWith && this.looksLikePath(filePath)) {
      return [this.resolveRequestPath(request, path.normalize(filePath)), search, replaceWith];
    }

    throw new Error(
      'Para file.replace use: substituir "caminho" "texto_antigo" "texto_novo".'
    );
  }

  private parseQuotedValues(text: string): string[] {
    const values: string[] = [];
    const matches = text.matchAll(/['"]([^'"]+)['"]/g);
    for (const item of matches) {
      if (item[1]) {
        values.push(item[1]);
      }
    }

    return values;
  }

  private looksLikePath(value: string): boolean {
    return /^([a-zA-Z]:\\|\.|\/|workspace[\\/])/.test(value)
      || /^[\w.-]+(?:[\\/][\w.-]+)+$/.test(value)
      || /^[\w.-]+\.[a-zA-Z0-9]+$/.test(value);
  }

  private resolveRequestPath(request: AgentRequest, targetPath: string): string {
    if (path.isAbsolute(targetPath)) {
      return path.normalize(targetPath);
    }

    if (request.workspaceRoot?.trim()) {
      const root = path.resolve(request.workspaceRoot.trim());
      const normalizedRelative = this.stripWorkspaceFolderPrefix(targetPath, root);
      return path.resolve(root, normalizedRelative);
    }

    return path.resolve(targetPath);
  }

  private stripWorkspaceFolderPrefix(targetPath: string, workspaceRoot: string): string {
    const workspaceFolderName = path.basename(workspaceRoot).toLowerCase();
    const normalized = targetPath.replaceAll('\\', '/');
    const normalizedLower = normalized.toLowerCase();

    if (normalizedLower === workspaceFolderName) {
      return '.';
    }

    if (normalizedLower.startsWith(`${workspaceFolderName}/`)) {
      return normalized.slice(workspaceFolderName.length + 1);
    }

    return targetPath;
  }

  private ok(
    summary: string,
    steps: string[],
    options: {
      action: ActionPlan['action'];
      tool: string;
      durationMs: number;
      details?: string;
      modelUsage?: ModelUsage;
      resolvedModel?: string;
    }
  ): AgentResponse {
    const modelInfo = this.llmGateway.getModelInfo();
    const fallbackModelUsage: ModelUsage = options.modelUsage ?? {
      provider: modelInfo.provider,
      model: modelInfo.model,
      contextWindowTokens: modelInfo.contextWindowTokens
    };

    const toolUsage: ToolUsage = {
      tool: options.tool,
      action: options.action,
      status: 'success',
      durationMs: options.durationMs,
      ...(options.details ? { details: options.details } : {})
    };

    const report: ExecutionReport = {
      requestId: '',
      startedAt: '',
      finishedAt: '',
      totalDurationMs: options.durationMs,
      promptPreview: '',
      promptChars: 0,
      model: fallbackModelUsage,
      ...(options.resolvedModel ? { resolvedModel: options.resolvedModel } : {}),
      llmInteractions: [],
      tools: [toolUsage],
      runtime: {
        memoryRssMb: 0,
        memoryHeapUsedMb: 0,
        memoryHeapTotalMb: 0
      },
      memory: {
        backend: 'none',
        enabled: false,
        reads: [],
        writes: []
      },
      stages: [],
      notes: []
    };

    return {
      language: 'pt-BR',
      summary,
      steps,
      executionReport: report
    };
  }
}
