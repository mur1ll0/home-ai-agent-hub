import type { AgentRequest } from '../../core/domain/agent-types.js';
import type { TaskPlan, TaskSubtask, ContentGenerationContext } from '../../core/domain/task-planning.js';
import type { LlmGateway } from '../../infrastructure/llm/openrouter-chat.gateway.js';

/**
 * TaskPlannerService implements ReAct-like task planning
 * Decomposes complex user requests into subtasks for orchestrated execution
 */
export class TaskPlannerService {
  constructor(private readonly llmGateway: LlmGateway) {}

  /**
   * Detect if a request requires multi-step planning
   * Patterns: "crie/gere apresentação sobre X", "analise e resuma X", etc.
   */
  isComplexTask(request: AgentRequest): boolean {
    const complexPatterns = [
      /crie\s+(?:uma\s+)?apresenta[çc]ão.*sobre/i,
      /gere\s+(?:uma\s+)?apresenta[çc]ão.*sobre/i,
      /crie\s+(?:um\s+)?documento.*sobre/i,
      /analise\s+e\s+(?:resuma|organize).*sobre/i,
      /pesquise\s+(?:e\s+)?(?:gere|crie).*sobre/i,
      /fa[çc]a\s+uma\s+pesquisa.*e\s+(?:organize|resuma)/i
    ];

    return complexPatterns.some((pattern) => pattern.test(request.text));
  }

  /**
   * Plan a complex task by decomposing it into subtasks
   * Uses LLM to analyze and structure the task
   */
  async plan(request: AgentRequest): Promise<TaskPlan> {
    const planPrompt = `
Você é um planejador de tarefas para um agente de IA.
Analise a solicitação do usuário e decomponha em subtarefas claras.

Solicitação: "${request.text}"

Responda em JSON válido com este formato:
{
  "reasoning": "Breve análise de por que precisa de múltiplas etapas",
  "subtasks": [
    {
      "id": "task_1",
      "title": "Título da subtarefa",
      "description": "Descrição breve",
      "action": "web.search|web.extract|synthesize|organize",
      "priority": "high|medium|low",
      "inputs": { "query": "..." }
    }
  ],
  "mainTopics": ["Tópico 1", "Tópico 2", ...],
  "estimatedSteps": 5,
  "executionStrategy": "sequential|parallel"
}
    `;

    const response = await this.llmGateway.ask(planPrompt, {
      operation: 'task_planning'
    });

    const parsed = this.parseTaskPlan(response, request.text);
    return parsed;
  }

  /**
   * Extract main topics from a research request
   * E.g., "Obsidian para gerenciar memória de IA" -> ["Obsidian", "gestão de memória", "IA", ...]
   */
  async extractTopics(topic: string, desiredSlideCount?: number): Promise<string[]> {
    const topicCount = this.resolveTopicCount(desiredSlideCount);
    const prompt = `
Extraia tópicos principais relacionados ao seguinte assunto para uma apresentação detalhada.
Responda como JSON array de strings.
Os tópicos devem ser específicos, acionáveis e bem distribuídos para cobrir todos os aspectos do tema.
Se não houver conteúdo suficiente, retorne menos tópicos (não invente tópicos fracos).

Assunto: "${topic}"

Quantidade desejada de tópicos: até ${topicCount}

Exemplo de resposta para tema complexo: [
  "Conceito e Fundamentos", 
  "Características principais", 
  "Vantagens e Benefícios", 
  "Aplicações práticas", 
  "Casos de uso", 
  "Integração com ferramentas",
  "Desafios e Limitações",
  "Implementação passo a passo",
  "Melhores práticas",
  "Comparação com alternativas",
  "Segurança e privacidade",
  "Performance e otimização",
  "Troubleshooting e resolução de problemas",
  "Comunidade e recursos",
  "Tendências futuras"
]

Responda APENAS o JSON array, sem explicação adicional, entre aspas duplas:
    `;

    const response = await this.llmGateway.ask(prompt, {
      operation: 'topic_extraction'
    });

    try {
      const parsed = this.parseJson<string[]>(response);
      return parsed
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .slice(0, topicCount);
    } catch {
      return [
        'Fundamentos e Conceitos',
        'Características Principais',
        'Vantagens e Benefícios',
        'Aplicações Práticas',
        'Casos de Uso',
        'Integração com Ferramentas',
        'Desafios e Limitações',
        'Implementação',
        'Melhores Práticas',
        'Comparação com Alternativas',
        'Segurança e Privacidade',
        'Performance',
        'Troubleshooting',
        'Comunidade',
        'Recursos e Documentação',
        'Tendências Futuras',
        'ROI e Valor',
        'Escalabilidade',
        'Customização',
        'Conclusão e Próximos Passos'
      ].slice(0, topicCount);
    }
  }

  /**
   * Process raw web research into concise, structured notes.
   * Guarantees slides are synthesized from processed data, not raw crawl output.
   */
  async processResearchByTopic(
    mainTopic: string,
    researchByTopic: Record<string, string>
  ): Promise<Record<string, string>> {
    const compactResearch: Record<string, string> = {};
    for (const [topicName, rawContent] of Object.entries(researchByTopic)) {
      compactResearch[topicName] = this.compactRawResearch(rawContent);
    }

    const prompt = `
Você vai limpar e sintetizar pesquisa web bruta em notas confiáveis para slides.

Tema principal: "${mainTopic}"

Pesquisa bruta por subtópico:
${JSON.stringify(compactResearch)}

Regras:
- Preserve apenas fatos úteis para apresentação.
- Remova ruído (menus, login, cookies, propaganda, navegação de site).
- Não invente conteúdo.
- Se não houver dados bons para um subtópico, escreva "Conteúdo insuficiente".
- Cada valor deve ser um texto curto com 3-5 bullets factuais separados por " | ".

Responda APENAS como JSON object com as mesmas chaves de subtópico:
{
  "Subtópico A": "Bullet 1 | Bullet 2 | Bullet 3",
  "Subtópico B": "Conteúdo insuficiente"
}
    `;

    try {
      const response = await this.llmGateway.ask(prompt, {
        operation: 'topic_research_processing'
      });

      const parsed = this.parseJson<Record<string, string>>(response);
      const processed: Record<string, string> = {};
      for (const topicName of Object.keys(researchByTopic)) {
        const value = parsed[topicName]?.trim();
        processed[topicName] = value && value.length > 0
          ? value
          : 'Conteúdo insuficiente';
      }

      return processed;
    } catch {
      return compactResearch;
    }
  }

  /**
   * Synthesize researched content into slide structure
   * Groups content by topics and creates slide outlines
   */
  async synthesizeSlideStructure(
    topic: string,
    researchByTopic: Record<string, string>,
    desiredSlideCount?: number
  ): Promise<Array<{ title: string; bullets: string[] }>> {
    const contentCapacity = this.estimateSlideCapacity(researchByTopic);
    const targetSlideCount = this.resolveTargetSlideCount(desiredSlideCount, contentCapacity);
    const topicsJson = JSON.stringify(researchByTopic);
    const prompt = `
Você vai transformar pesquisas sobre um tópico em uma estrutura de apresentação.

Tópico principal: "${topic}"

Quantidade de slides desejada pelo usuário: ${desiredSlideCount ?? 'não informada'}
Capacidade de conteúdo estimada: ${contentCapacity} slides
Quantidade alvo para geração: ${targetSlideCount} slides

Pesquisas por subtópico:
${topicsJson}

Crie uma estrutura com no máximo ${targetSlideCount} slides, com:
- Título do slide único e descritivo
- 3-5 bullets por slide (curtos e concisos)
- Conteúdo extraído das pesquisas processadas
- Progressão lógica que leve de fundamentos a conclusão
- Se faltar conteúdo, gere MENOS slides (não repita ideias e não invente)

Responda como JSON array de slides:
[
  {
    "title": "Título do slide",
    "bullets": ["Bullet 1", "Bullet 2", "Bullet 3"]
  },
  ...
]

IMPORTANTE: Não ultrapasse ${targetSlideCount} slides.

Responda APENAS o JSON array, sem explicação adicional:
    `;

    const response = await this.llmGateway.ask(prompt, {
      operation: 'slide_synthesis'
    });

    try {
      const parsed = this.parseJson<Array<{ title: string; bullets: string[] }>>(response);
      const normalized = parsed
        .filter((slide) => slide && typeof slide.title === 'string' && Array.isArray(slide.bullets))
        .map((slide) => ({
          title: slide.title.trim().slice(0, 120),
          bullets: slide.bullets
            .map((bullet) => String(bullet).trim())
            .filter((bullet) => bullet.length > 0)
            .slice(0, 5)
        }))
        .filter((slide) => slide.title.length > 0 && slide.bullets.length > 0)
        .slice(0, targetSlideCount);

      if (normalized.length > 0) {
        return normalized;
      }

      return this.generateFallbackSlides(topic, researchByTopic, targetSlideCount);
    } catch {
      return this.generateFallbackSlides(topic, researchByTopic, targetSlideCount);
    }
  }

  /**
   * Generate fallback slide structure when LLM synthesis fails
   */
  private generateFallbackSlides(
    topic: string,
    researchByTopic: Record<string, string>,
    targetCount: number
  ): Array<{ title: string; bullets: string[] }> {
    const slides: Array<{ title: string; bullets: string[] }> = [];

    // Slide 1: Title slide
    slides.push({
      title: `${topic}`,
      bullets: ['Apresentação Detalhada', `Conteúdo estruturado em ${targetCount} slides`, 'Baseado em pesquisa na internet']
    });

    // Slides for each research topic
    for (const [topicName, content] of Object.entries(researchByTopic)) {
      const bulletsFromContent = content
        .split('|')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .slice(0, 4);

      slides.push({
        title: topicName,
        bullets:
          bulletsFromContent.length > 0
            ? bulletsFromContent
            : ['Conteúdo insuficiente', 'Revisar fontes adicionais', 'Consolidar dados antes de expandir slides']
      });

      // If we have enough slides, stop
      if (slides.length >= targetCount - 2) break;
    }

    // Fill remaining slots with structured slides
    const defaultSlides = [
      { title: 'Vantagens Principais', bullets: ['Benefício 1', 'Benefício 2', 'Benefício 3', 'Benefício 4'] },
      { title: 'Aplicações Práticas', bullets: ['Caso de uso 1', 'Caso de uso 2', 'Caso de uso 3'] },
      { title: 'Melhores Práticas', bullets: ['Prática 1: Estruturação', 'Prática 2: Organização', 'Prática 3: Integração'] },
      { title: 'Desafios e Soluções', bullets: ['Desafio 1: Escalabilidade', 'Desafio 2: Complexidade', 'Solução recomendada'] },
      { title: 'Roadmap e Próximos Passos', bullets: ['Curto prazo: Implementação', 'Médio prazo: Otimização', 'Longo prazo: Expansão'] },
      { title: 'Conclusão', bullets: [`${topic} oferece soluções robustas`, 'Aplicável em diversos cenários', 'Investimento com retorno positivo'] }
    ];

    while (slides.length < targetCount && defaultSlides.length > 0) {
      slides.push(defaultSlides.shift()!);
    }

    return slides.slice(0, targetCount);
  }

  private resolveTopicCount(desiredSlideCount?: number): number {
    if (typeof desiredSlideCount !== 'number' || desiredSlideCount <= 0) {
      return 12;
    }

    return Math.max(6, Math.min(30, desiredSlideCount));
  }

  private estimateSlideCapacity(researchByTopic: Record<string, string>): number {
    const substantialTopics = Object.values(researchByTopic).filter((content) => {
      const normalized = content.replace(/\s+/g, ' ').trim();
      return normalized.length >= 80 && !/conte[uú]do insuficiente/i.test(normalized);
    }).length;

    return Math.max(3, Math.min(40, substantialTopics + 2));
  }

  private resolveTargetSlideCount(desiredSlideCount: number | undefined, contentCapacity: number): number {
    if (typeof desiredSlideCount === 'number' && desiredSlideCount > 0) {
      return Math.max(3, Math.min(desiredSlideCount, contentCapacity));
    }

    return Math.max(5, Math.min(12, contentCapacity));
  }

  private compactRawResearch(rawContent: string): string {
    const normalized = rawContent
      .replace(/\r/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .replace(/\s+/g, ' ')
      .trim();

    if (normalized.length === 0) {
      return 'Conteúdo insuficiente';
    }

    const filteredSegments = normalized
      .split(/(?:Fonte:|URL:|Trecho:|Consulta:)/i)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 30)
      .filter(
        (segment) =>
          !/(cookies|gerenciar cookies|entrar|cadastre-se|pol[ií]tica de privacidade|copyright|todos os direitos reservados)/i.test(
            segment
          )
      )
      .slice(0, 5)
      .map((segment) => segment.slice(0, 280));

    if (filteredSegments.length === 0) {
      return 'Conteúdo insuficiente';
    }

    return filteredSegments.join(' | ');
  }

  private parseJson<T>(raw: string): T {
    const trimmed = raw.trim();
    const withoutFence = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();

    try {
      return JSON.parse(withoutFence) as T;
    } catch {
      const objectStart = withoutFence.indexOf('{');
      const objectEnd = withoutFence.lastIndexOf('}');
      if (objectStart >= 0 && objectEnd > objectStart) {
        const candidate = withoutFence.slice(objectStart, objectEnd + 1);
        return JSON.parse(candidate) as T;
      }

      const arrayStart = withoutFence.indexOf('[');
      const arrayEnd = withoutFence.lastIndexOf(']');
      if (arrayStart >= 0 && arrayEnd > arrayStart) {
        const candidate = withoutFence.slice(arrayStart, arrayEnd + 1);
        return JSON.parse(candidate) as T;
      }

      throw new Error('JSON inválido na resposta do LLM');
    }
  }

  /**
   * Build a search query from user text
   * Extracts the main topic and focuses on research terms
   */
  buildSearchQuery(userText: string): string {
    // Extract text after keywords like "sobre", "regarding", etc.
    const match = userText.match(
      /(?:sobre|about|regarding|para|for)\s+(.+?)(?:\.|,|$)/i
    );
    if (match?.[1]) {
      return match[1].trim().slice(0, 100);
    }
    return userText.slice(0, 100);
  }

  private parseTaskPlan(response: string, originalRequest: string): TaskPlan {
    try {
      const normalized = response
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/```$/i, '');
      const parsed = JSON.parse(normalized) as {
        reasoning: string;
        subtasks: Array<{
          id: string;
          title: string;
          description: string;
          action: string;
          priority: string;
          inputs?: Record<string, unknown>;
        }>;
        mainTopics?: string[];
        estimatedSteps?: number;
        executionStrategy?: string;
      };

      return {
        type: 'complex',
        originalRequest,
        reasoning: parsed.reasoning ?? 'Planejamento automático',
        subtasks: parsed.subtasks.map(
          (st): TaskSubtask => ({
            id: st.id,
            title: st.title,
            description: st.description,
            action: st.action,
            priority: (st.priority as 'high' | 'medium' | 'low') ?? 'medium',
            ...(st.inputs ? { inputs: st.inputs } : {})
          })
        ),
        estimatedSteps: parsed.estimatedSteps ?? parsed.subtasks.length,
        executionStrategy: (parsed.executionStrategy as 'sequential' | 'parallel') ?? 'sequential'
      };
    } catch {
      // Fallback plan
      return {
        type: 'complex',
        originalRequest,
        reasoning: 'Decomposição automática para pesquisa + síntese',
        subtasks: [
          {
            id: 'search_topic',
            title: 'Pesquisar tópico',
            description: 'Buscar informações sobre o assunto na internet',
            action: 'web.search',
            priority: 'high'
          },
          {
            id: 'synthesize',
            title: 'Sintetizar conteúdo',
            description: 'Organizar pesquisas em estrutura de apresentação',
            action: 'synthesize',
            priority: 'high'
          },
          {
            id: 'create_slides',
            title: 'Criar slides',
            description: 'Gerar apresentação com conteúdo pesquisado',
            action: 'slide.create',
            priority: 'high'
          }
        ],
        estimatedSteps: 3,
        executionStrategy: 'sequential'
      };
    }
  }
}
