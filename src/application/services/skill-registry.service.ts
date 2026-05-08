import type { ActionPlan, AgentRequest } from '../../core/domain/agent-types.js';
import type { SkillId, SkillProfile } from '../../core/domain/skill-types.js';
import type { SkillRegistry } from '../../core/ports/agent-services.js';

const SKILL_PROFILES: SkillProfile[] = [
  {
    id: 'developer',
    name: 'Desenvolvedor',
    description: 'Especialista em programação e desenvolvimento de software.',
    priority: 10,
    compatibleActions: ['file.read', 'file.write', 'file.replace', 'file.delete', 'fs.list', 'chat.reply'],
    triggerPatterns: [
      /\b(código|code|programa[r]?|desenvolv[ae]r?|implementa[r]?|debug[gar]?|refatora[r]?|função|classe|método|api|endpoint|bug|erro de código|typescript|javascript|python|node\.?js|react|angular|vue|sql|banco de dados|query|script|compile|compilar|test[e]?|jest|vitest)\b/i,
      /\b(criar?\s+(?:um?\s+)?(?:componente|serviço|módulo|arquivo\s+de\s+código|classe|interface|tipo))\b/i,
      /```[\s\S]*?```/,
    ],
    systemPrompt: `Você é um assistente especialista em desenvolvimento de software com profundo conhecimento em TypeScript, Node.js, arquiteturas modernas e boas práticas de engenharia.

Diretrizes:
- Priorize código correto, limpo e eficiente seguindo princípios SOLID e Clean Architecture.
- Explique decisões técnicas de forma concisa e direta.
- Forneça exemplos de código funcionais e testáveis quando relevante.
- Identifique e sinalize problemas de segurança, performance ou manutenibilidade.
- Use nomenclatura precisa: diferencie funções, métodos, classes, módulos e componentes.
- Quando houver múltiplas abordagens, compare brevemente os trade-offs.
- Responda sempre no idioma do usuário.`,
  },
  {
    id: 'researcher',
    name: 'Pesquisador',
    description: 'Especialista em pesquisa, síntese e análise de informações.',
    priority: 9,
    compatibleActions: ['web.extract', 'chat.reply', 'doc.create'],
    triggerPatterns: [
      /\b(pesquisa[r]?|research|busca[r]?|encontra[r]?|investiga[r]?|fontes?|referências?|artigos?|estudos?|literatura|revisar?\s+literatura|estado\s+da\s+arte|o\s+que\s+é|explica[r]?|resumir?|sumarizar?|comparar?\s+(?:fontes?|informações?|opções?))\b/i,
      /\b(quais?\s+são|como\s+funciona|por\s+que|qual\s+a\s+diferença|vantagens?\s+e\s+desvantagens?)\b/i,
    ],
    systemPrompt: `Você é um assistente de pesquisa especializado em síntese e análise de informações de múltiplas fontes.

Diretrizes:
- Organize as informações de forma hierárquica: conclusão principal → evidências → detalhes.
- Cite fontes, datas e autores quando disponíveis.
- Diferencie claramente fatos verificados de inferências ou opiniões.
- Apresente perspectivas divergentes quando houver controvérsia.
- Sinalize limitações do conhecimento ou necessidade de validação adicional.
- Use listas e seções para facilitar a leitura quando a resposta for longa.
- Responda sempre no idioma do usuário.`,
  },
  {
    id: 'planner',
    name: 'Planejador',
    description: 'Especialista em planejamento, gestão de projetos e decomposição de tarefas.',
    priority: 9,
    compatibleActions: ['chat.reply', 'doc.create', 'slide.create'],
    triggerPatterns: [
      /\b(planejar?|planejamento|roadmap|cronograma|sprint|backlog|projeto|gestão\s+de\s+projetos?|priorizar?|prioridades?|etapas?|fases?|sequência|dependências?|milestone|marco|deliverable|entregável|escopo|requisitos?|tarefas?)\b/i,
      /\b(como\s+(?:organizar?|estruturar?|dividir?|quebrar?|decompor?))\b/i,
      /\b(próximos?\s+passos?|o\s+que\s+(?:fazer|implementar?)\s+(?:primeiro|agora|depois))\b/i,
    ],
    systemPrompt: `Você é um especialista em planejamento estratégico e gestão de projetos com experiência em metodologias ágeis e frameworks de priorização.

Diretrizes:
- Decomponha problemas complexos em etapas claras, ordenadas e acionáveis.
- Priorize tarefas por impacto vs. esforço (matriz de Eisenhower, MoSCoW, etc.).
- Identifique explicitamente dependências, riscos e pontos de atenção.
- Produza planos com critérios de sucesso mensuráveis quando possível.
- Use formatos estruturados: listas numeradas, tabelas de prioridade, fluxogramas textuais.
- Adapte a granularidade ao nível de detalhe solicitado pelo usuário.
- Responda sempre no idioma do usuário.`,
  },
  {
    id: 'analyst',
    name: 'Analista',
    description: 'Especialista em análise de dados, métricas e insights de negócio.',
    priority: 9,
    compatibleActions: ['sheet.create', 'chat.reply', 'doc.create'],
    triggerPatterns: [
      /\b(analis[ae]r?|análise|dados?|data|métricas?|kpis?|indicadores?|dashboard|relatório|report|tendência|trend|padrão|insights?|estatísticas?|médias?|percentual|crescimento|performance|roi|conversão|funil|cohort)\b/i,
      /\b(planilha|spreadsheet|excel|tabela\s+(?:de\s+)?(?:dados?|análise)|visualização|gráfico)\b/i,
    ],
    systemPrompt: `Você é um analista de dados e negócios com especialização em interpretação de métricas e geração de insights acionáveis.

Diretrizes:
- Baseie suas conclusões em evidências e dados; evite afirmações sem respaldo.
- Apresente métricas com contexto: comparação temporal, benchmarks ou metas.
- Identifique correlações, anomalias e tendências relevantes.
- Diferencie sintomas de causas-raiz ao analisar problemas.
- Sugira visualizações e formatos de relatório adequados ao público-alvo.
- Quando faltar dados, sinalize quais informações adicionais permitiriam análise mais precisa.
- Responda sempre no idioma do usuário.`,
  },
  {
    id: 'writer',
    name: 'Escritor',
    description: 'Especialista em criação de conteúdo, documentos e apresentações.',
    priority: 8,
    compatibleActions: ['doc.create', 'slide.create', 'sheet.create', 'chat.reply'],
    triggerPatterns: [
      /\b(escrever?|redigir?|criar?\s+(?:um?\s+)?(?:texto|artigo|documento|apresentação|slides?|email|proposta|relatório|ata|resumo executivo|summary|newsletter|post|blog))\b/i,
      /\b(melhorar?\s+(?:o\s+)?(?:texto|escrita|redação)|revisar?\s+(?:o\s+)?(?:texto|documento)|formatar?|estruturar?\s+(?:o\s+)?(?:texto|conteúdo))\b/i,
    ],
    systemPrompt: `Você é um escritor e produtor de conteúdo especializado em comunicação clara, objetiva e de alto impacto.

Diretrizes:
- Adapte estilo, tom e vocabulário ao público-alvo e formato solicitado.
- Priorize clareza e coesão; evite jargões desnecessários.
- Estruture o conteúdo com introdução, desenvolvimento e conclusão adequados ao formato.
- Para documentos técnicos: use terminologia precisa e inclua exemplos.
- Para apresentações: prefira linguagem concisa e impactante nos bullets.
- Ofereça variações ou alternativas quando o usuário precisar de opções.
- Responda sempre no idioma do usuário.`,
  },
  {
    id: 'generalist',
    name: 'Assistente Geral',
    description: 'Assistente multitarefa capaz de lidar com qualquer tipo de solicitação.',
    priority: 0,
    compatibleActions: [
      'file.read', 'file.write', 'file.move', 'file.replace', 'file.delete', 'fs.list',
      'web.extract', 'doc.create', 'slide.create', 'sheet.create', 'mcp.connect',
      'image.generate', 'video.generate', 'model3d.generate', 'chat.reply',
    ],
    triggerPatterns: [],
    systemPrompt: `Você é um assistente de IA pessoal avançado e versátil, projetado para ser genuinamente útil em qualquer tipo de tarefa.

Capacidades:
- Programação e desenvolvimento de software em qualquer linguagem.
- Pesquisa e síntese de informações de múltiplas fontes.
- Planejamento de projetos, priorização e gestão de tarefas.
- Análise de dados, métricas e geração de insights.
- Criação de documentos, apresentações e planilhas.
- Conversação, explicação de conceitos e suporte geral.

Diretrizes:
- Adapte o nível de detalhe e o tom à complexidade da solicitação.
- Seja direto e preciso: forneça respostas completas sem prolixidade desnecessária.
- Quando a pergunta for ambígua, interprete da forma mais útil e sinalize a interpretação adotada.
- Parta do mais relevante: coloque a informação principal antes dos detalhes.
- Responda sempre no idioma do usuário — detecte-o automaticamente.`,
  },
];

export class SkillRegistryService implements SkillRegistry {
  private readonly profiles: Map<SkillId, SkillProfile>;

  private readonly anchorPatterns: Record<Exclude<SkillId, 'generalist'>, RegExp> = {
    planner: /\b(roadmap|cronograma|planej|sprint|backlog|pr[oó]ximos?\s+passos?|priorizar?|etapas?|decompor?|milestone|escopo|tarefas?)\b/i,
    writer: /\b(redija|redigir|escrev[ae]r?|artigo|email|proposta|documenta[cç][aã]o|texto|blog|newsletter|apresenta[cç][aã]o)\b/i,
    researcher: /\b(pesquise|pesquisa|research|busque|investigue|fontes?|refer[eê]ncias?|estado\s+da\s+arte|o\s+que\s+[eé])\b/i,
    analyst: /\b(an[aá]lis[ae]|m[eé]tricas?|kpis?|dashboard|dados?|estat[ií]stic|insights?|convers[aã]o|funil)\b/i,
    developer: /\b(c[oó]digo|typescript|javascript|python|node\.?js|api|endpoint|classe|fun[cç][aã]o|debug|refator|bug|teste|vitest|jest)\b/i
  };

  constructor() {
    this.profiles = new Map(SKILL_PROFILES.map((p) => [p.id, p]));
  }

  selectSkill(request: AgentRequest, plan: ActionPlan): SkillProfile {
    const text = request.text;

    // Action-based hard mappings
    const actionMap: Partial<Record<string, SkillId>> = {
      'sheet.create': 'analyst',
      'doc.create': 'writer',
      'slide.create': 'writer',
      'image.generate': 'generalist',
      'video.generate': 'generalist',
      'model3d.generate': 'generalist',
    };

    const mappedSkillId = actionMap[plan.action];
    if (mappedSkillId) {
      return this.profiles.get(mappedSkillId) ?? this.generalist();
    }

    const plannerAnchor = this.anchorPatterns.planner.test(text);
    const writerAnchor = this.anchorPatterns.writer.test(text);
    const researcherAnchor = this.anchorPatterns.researcher.test(text);
    const analystAnchor = this.anchorPatterns.analyst.test(text);
    const developerAnchor = this.anchorPatterns.developer.test(text);

    // Strong anchors resolve common conflicts between profiles.
    if (plannerAnchor) {
      return this.getSkill('planner');
    }
    if (developerAnchor) {
      return this.getSkill('developer');
    }
    if (analystAnchor) {
      return this.getSkill('analyst');
    }
    if (writerAnchor && !researcherAnchor) {
      return this.getSkill('writer');
    }
    if (researcherAnchor) {
      return this.getSkill('researcher');
    }

    // Pattern-based matching with priority scoring
    const candidates = SKILL_PROFILES
      .filter((p) => p.id !== 'generalist')
      .map((profile) => {
        const matchedPatterns = profile.triggerPatterns.reduce((acc, pattern) => {
          return acc + (pattern.test(text) ? 1 : 0);
        }, 0);
        const score = matchedPatterns === 0 ? 0 : matchedPatterns * 100 + profile.priority;
        return { profile, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    if (candidates.length > 0 && candidates[0]) {
      return candidates[0].profile;
    }

    // If action is a file op, lean developer
    if (['file.read', 'file.write', 'file.replace', 'file.delete', 'fs.list'].includes(plan.action)) {
      const devScore = SKILL_PROFILES
        .find((p) => p.id === 'developer')
        ?.triggerPatterns.some((p) => p.test(text));
      if (devScore) {
        return this.profiles.get('developer') ?? this.generalist();
      }
    }

    return this.generalist();
  }

  getSkill(id: SkillId): SkillProfile {
    return this.profiles.get(id) ?? this.generalist();
  }

  listSkills(): SkillProfile[] {
    return SKILL_PROFILES;
  }

  private generalist(): SkillProfile {
    return this.profiles.get('generalist') as SkillProfile;
  }
}
