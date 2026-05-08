/**
 * Benchmark: Golden Prompt Selection
 *
 * These tests verify that the SkillRegistry correctly maps representative
 * user prompts to their expected skill profiles. They serve as regression
 * guards — if trigger patterns change, these will catch regressions.
 */
import { describe, it, expect } from 'vitest';
import { SkillRegistryService } from '../../src/application/services/skill-registry.service.js';
import type { AgentRequest } from '../../src/core/domain/agent-types.js';
import type { SkillId } from '../../src/core/domain/skill-types.js';

type GoldenCase = { prompt: string; expectedSkill: SkillId };

function makeRequest(text: string): AgentRequest {
  return { text, userId: 'benchmark', sessionId: 'bench-sess' };
}

const DEVELOPER_CASES: GoldenCase[] = [
  { prompt: 'Crie uma função TypeScript para validar email com regex', expectedSkill: 'developer' },
  { prompt: 'Como refatorar esse código para seguir o princípio de responsabilidade única?', expectedSkill: 'developer' },
  { prompt: 'Implemente um endpoint REST em Node.js para autenticação JWT', expectedSkill: 'developer' },
  { prompt: 'Qual a diferença entre interface e type no TypeScript?', expectedSkill: 'developer' },
  { prompt: 'Escreva um script Python para processar um CSV e exportar para JSON', expectedSkill: 'developer' },
  { prompt: 'Como resolver esse bug: TypeError: Cannot read property of undefined', expectedSkill: 'developer' },
  { prompt: 'Adicione testes com Vitest para o serviço de autenticação', expectedSkill: 'developer' },
];

const RESEARCHER_CASES: GoldenCase[] = [
  { prompt: 'Pesquise as últimas tendências em inteligência artificial generativa', expectedSkill: 'researcher' },
  { prompt: 'Quais são as principais diferenças entre GPT-4 e Claude 3?', expectedSkill: 'researcher' },
  { prompt: 'Busque artigos sobre o estado da arte em RAG para LLMs', expectedSkill: 'researcher' },
  { prompt: 'Explique o que é aprendizado por reforço e como funciona', expectedSkill: 'researcher' },
  { prompt: 'Compare as vantagens e desvantagens de PostgreSQL vs MongoDB', expectedSkill: 'researcher' },
];

const PLANNER_CASES: GoldenCase[] = [
  { prompt: 'Crie um roadmap para implementar autenticação OAuth2 no projeto', expectedSkill: 'planner' },
  { prompt: 'Quais são os próximos passos para migrar o banco de dados?', expectedSkill: 'planner' },
  { prompt: 'Preciso planejar o sprint da semana, me ajude a priorizar as tarefas', expectedSkill: 'planner' },
  { prompt: 'Decomponha o projeto de redesign da API em etapas acionáveis', expectedSkill: 'planner' },
  { prompt: 'Crie um cronograma para entrega do MVP em 4 semanas', expectedSkill: 'planner' },
];

const ANALYST_CASES: GoldenCase[] = [
  { prompt: 'Analise as métricas de performance do último mês', expectedSkill: 'analyst' },
  { prompt: 'Quais KPIs devo monitorar para avaliar retenção de usuários?', expectedSkill: 'analyst' },
  { prompt: 'Identifique tendências nos dados de conversão do funil de vendas', expectedSkill: 'analyst' },
  { prompt: 'Gere uma análise estatística dos resultados do experimento A/B', expectedSkill: 'analyst' },
];

const WRITER_CASES: GoldenCase[] = [
  { prompt: 'Escreva um artigo de blog sobre os benefícios da Clean Architecture', expectedSkill: 'writer' },
  { prompt: 'Redija um email profissional para informar a equipe sobre o deploy', expectedSkill: 'writer' },
  { prompt: 'Crie uma proposta comercial para o cliente sobre nosso serviço de IA', expectedSkill: 'writer' },
  { prompt: 'Melhore o texto desta documentação técnica para ficar mais claro', expectedSkill: 'writer' },
];

const GENERALIST_CASES: GoldenCase[] = [
  { prompt: 'Olá, tudo bem?', expectedSkill: 'generalist' },
  { prompt: 'Me dê uma piada', expectedSkill: 'generalist' },
  { prompt: 'Qual é a capital da França?', expectedSkill: 'generalist' },
  { prompt: 'Quanto é 2 + 2?', expectedSkill: 'generalist' },
];

describe('Golden Prompt Benchmark: Skill Selection', () => {
  const registry = new SkillRegistryService();

  function runCases(cases: GoldenCase[]): void {
    for (const { prompt, expectedSkill } of cases) {
      it(`should select '${expectedSkill}' for: "${prompt.slice(0, 60)}..."`, () => {
        const plan = { action: 'chat.reply' as const, confidence: 0.8, reason: 'benchmark' };
        const selected = registry.selectSkill(makeRequest(prompt), plan);
        expect(selected.id).toBe(expectedSkill);
      });
    }
  }

  describe('Developer prompts', () => runCases(DEVELOPER_CASES));
  describe('Researcher prompts', () => runCases(RESEARCHER_CASES));
  describe('Planner prompts', () => runCases(PLANNER_CASES));
  describe('Analyst prompts', () => runCases(ANALYST_CASES));
  describe('Writer prompts', () => runCases(WRITER_CASES));
  describe('Generalist (fallback) prompts', () => runCases(GENERALIST_CASES));
});
