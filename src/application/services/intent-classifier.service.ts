import type { ActionPlan, AgentRequest, SupportedAction } from '../../core/domain/agent-types.js';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';
import type { IntentClassifier } from '../../core/ports/agent-services.js';
import type { LlmGateway } from '../../infrastructure/llm/openrouter-chat.gateway.js';

const actionRules: Array<{ regex: RegExp; action: SupportedAction }> = [
  { regex: /((\bler\b|\bread\b)|abrir\s+arquivo)/i, action: 'file.read' },
  { regex: /(escrever|write|criar arquivo)/i, action: 'file.write' },
  { regex: /(mover|move)/i, action: 'file.move' },
  { regex: /(substituir|replace)/i, action: 'file.replace' },
  { regex: /(excluir|delete|apagar)/i, action: 'file.delete' },
  { regex: /(site|web|navegar|url)/i, action: 'web.extract' },
  { regex: /(slide|apresenta)/i, action: 'slide.create' },
  { regex: /(word|docx|documento)/i, action: 'doc.create' },
  { regex: /(planilha|xlsx|csv)/i, action: 'sheet.create' },
  { regex: /(mcp)/i, action: 'mcp.connect' },
  { regex: /(imagem|image)/i, action: 'image.generate' },
  { regex: /(video)/i, action: 'video.generate' },
  { regex: /(3d|textura|anima)/i, action: 'model3d.generate' }
];

// Patterns that indicate a complex multi-step task requiring planning
const complexTaskPatterns = [
  /crie\s+(?:uma\s+)?apresenta[çc]ão.*sobre/i,
  /gere\s+(?:uma\s+)?apresenta[çc]ão.*sobre/i,
  /crie\s+(?:um\s+)?documento.*sobre/i,
  /analise\s+e\s+(?:resuma|organize).*sobre/i,
  /pesquise\s+(?:e\s+)?(?:gere|crie).*sobre/i,
  /fa[çc]a\s+uma\s+pesquisa.*e\s+(?:organize|resuma)/i
];

export class IntentClassifierService implements IntentClassifier {
  constructor(private readonly llmGateway: LlmGateway) {}

  async classify(input: AgentRequest): Promise<ActionPlan> {
    // New: detect requests that ask to analyze the project and read "specs".
    const specsHeuristic = this.classifySpecsAndRepoAnalysis(input);
    if (specsHeuristic) {
      return specsHeuristic;
    }

    const projectSummaryHeuristic = this.classifyProjectSummaryFromContext(input);
    if (projectSummaryHeuristic) {
      return projectSummaryHeuristic;
    }

    const activeFileHeuristic = this.classifyActiveFileRead(input);
    if (activeFileHeuristic) {
      return activeFileHeuristic;
    }

    // Check for complex multi-step tasks first
    const isComplex = complexTaskPatterns.some((pattern) => pattern.test(input.text));
    if (isComplex) {
      const mainTopic = this.extractTopic(input.text);
      return {
        action: 'slide.create', // Default action for complex tasks involving content generation
        confidence: 0.85,
        reason: 'Tarefa complexa detectada: requer pesquisa + síntese + geração',
        isComplexTask: true,
        mainTopic
      };
    }

    const local = actionRules.find((rule) => rule.regex.test(input.text));
    if (local) {
      return {
        action: local.action,
        confidence: 0.75,
        reason: 'Regra local de intenção aplicada'
      };
    }

    const prompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        [
          'Você é um classificador de intenção para um agente.',
          'Responda APENAS JSON válido neste formato:',
          '{{"action":"file.read|file.write|file.move|file.replace|file.delete|fs.list|web.extract|doc.create|slide.create|sheet.create|mcp.connect|image.generate|video.generate|model3d.generate|chat.reply","confidence":0.0,"reason":"..."}}'
        ].join(' ')
      ],
      ['human', 'Solicitação do usuário: {text}']
    ]);

    const chain = RunnableSequence.from([
      prompt,
      RunnableLambda.from((value) =>
        this.llmGateway.ask(String(value), { operation: 'intent_classification' })
      ),
      new StringOutputParser()
    ]);

    const llmRaw = await chain.invoke({ text: input.text });
    const fromChain = this.tryParseActionPlan(llmRaw);
    if (fromChain) {
      return fromChain;
    }

    return {
      action: 'chat.reply',
      confidence: 0.4,
      reason: `Fallback para chat.reply. Cadeia não retornou JSON válido: ${llmRaw.slice(0, 160)}`
    };
  }

  /**
   * Detects when the user asks the agent to analyze the project and read specs.
   * If workspace root is not provided, the agent should search the repository
   * where it's running (process.cwd()). Returns an ActionPlan that triggers
   * a filesystem listing so the executor can discover .md/.txt docs and synthesize
   * the next steps. If the prompt explicitly names a file/path the other
   * heuristics will handle it.
   */
  private classifySpecsAndRepoAnalysis(input: AgentRequest): ActionPlan | null {
    const text = input.text.trim();

    const specsPatterns = [
      /\b(specs?|specifica[cç][o~]es|especifica[cç][o~]es)\b/i,
      /\blespecs\b/i,
      /\bREADME\b/i
    ];

    const asksAnalyzeProjectAndSpecs = /analise\s+o\s+fonte\s+do\s+meu\s+projeto.*specs|analise.*specs|analise.*specifica[cç]o/i.test(
      text
    );

    const mentionsSpecs = specsPatterns.some((p) => p.test(text));

    if (!asksAnalyzeProjectAndSpecs && !mentionsSpecs) {
      return null;
    }

    const workspaceProvided = Boolean(input.workspaceRoot && input.workspaceRoot.trim());
    const reasonParts: string[] = [];
    reasonParts.push('Solicitação detectada: análise de código + leitura de specs/documentação.');
    if (workspaceProvided) {
      reasonParts.push('Será usada a workspaceRoot fornecida pelo cliente.');
    } else {
      reasonParts.push('workspaceRoot não informado — usará o repositório onde o agente está rodando (process.cwd()).');
    }

    reasonParts.push('Ação proposta: listar diretório raiz e procurar arquivos .md/.txt para inferir specs.');

    return {
      action: 'fs.list',
      confidence: 0.9,
      reason: reasonParts.join(' '),
      isComplexTask: true,
      mainTopic: 'project-specs-analysis'
    };
  }

  private classifyActiveFileRead(input: AgentRequest): ActionPlan | null {
    if (!input.activeFilePath) {
      return null;
    }

    const text = input.text.trim();
    const asksAboutCurrentFile = /\b(este arquivo|esse arquivo|arquivo atual|current file|this file|esse c[oó]digo|este c[oó]digo|explique o arquivo|do que .*arquivo se trata)\b/i.test(
      text
    );
    const explicitMutatingAction = /(escrever|write|criar arquivo|mover|move|substituir|replace|excluir|delete|apagar)/i.test(
      text
    );

    if (!asksAboutCurrentFile || explicitMutatingAction) {
      return null;
    }

    return {
      action: 'file.read',
      confidence: 0.82,
      reason: 'Heurística local: solicitação refere-se ao arquivo ativo do editor.'
    };
  }

  private classifyProjectSummaryFromContext(input: AgentRequest): ActionPlan | null {
    if (!input.activeFilePath) {
      return null;
    }

    const text = input.text.trim();
    const asksProjectSummary = /\b(do que .*projeto se trata|sobre o projeto|resuma o projeto|explique o projeto|what is this project about|summari[sz]e .*project)\b/i.test(
      text
    );

    if (!asksProjectSummary) {
      return null;
    }

    return {
      action: 'chat.reply',
      confidence: 0.86,
      reason: 'Heurística local: pergunta de resumo do projeto com contexto do arquivo ativo.'
    };
  }

  private tryParseActionPlan(raw: string): ActionPlan | null {
    const normalized = raw.trim().replace(/^```json\s*/i, '').replace(/```$/i, '');

    try {
      const parsed = JSON.parse(normalized) as {
        action?: SupportedAction;
        confidence?: number;
        reason?: string;
      };

      if (!parsed.action || typeof parsed.confidence !== 'number') {
        return null;
      }

      return {
        action: parsed.action,
        confidence: Math.max(0, Math.min(1, parsed.confidence)),
        reason: parsed.reason?.slice(0, 240) ?? 'Classificação por cadeia LangChain'
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract the main topic from a complex task request
   * E.g., "Crie uma apresentação sobre Obsidian..." -> "Obsidian"
   */
  private extractTopic(text: string): string {
    // Prefer explicit topic markers and avoid greedy captures from "de 20 slides"
    const match = text.match(
      /(?:sobre|about|regarding)\s+([^,.!?]+?)(?:\.|,|!|\?|$)/i
    );
    if (match?.[1]) {
      return match[1].trim().slice(0, 100);
    }

    // Fallback: extract meaningful words
    const words = text.split(/\s+/).filter((w) => w.length > 3);
    return words.slice(-3).join(' ').slice(0, 100);
  }
}
