import { describe, it, expect, beforeEach } from 'vitest';
import { SkillRegistryService } from '../../src/application/services/skill-registry.service.js';
import type { AgentRequest } from '../../src/core/domain/agent-types.js';
import type { ActionPlan } from '../../src/core/domain/agent-types.js';

function makeRequest(text: string): AgentRequest {
  return { text, userId: 'user1', sessionId: 'sess1' };
}

function makePlan(action: ActionPlan['action'] = 'chat.reply'): ActionPlan {
  return { action, confidence: 0.9, reason: 'test' };
}

describe('SkillRegistryService', () => {
  let registry: SkillRegistryService;

  beforeEach(() => {
    registry = new SkillRegistryService();
  });

  it('should list all 6 skill profiles', () => {
    const skills = registry.listSkills();
    expect(skills).toHaveLength(6);
    const ids = skills.map((s) => s.id);
    expect(ids).toContain('developer');
    expect(ids).toContain('researcher');
    expect(ids).toContain('planner');
    expect(ids).toContain('analyst');
    expect(ids).toContain('writer');
    expect(ids).toContain('generalist');
  });

  it('should retrieve a skill by id', () => {
    const dev = registry.getSkill('developer');
    expect(dev.id).toBe('developer');
    expect(dev.systemPrompt).toContain('desenvolvimento de software');
  });

  it('should select developer skill for programming keywords', () => {
    const skill = registry.selectSkill(makeRequest('como faço para implementar uma classe em TypeScript?'), makePlan());
    expect(skill.id).toBe('developer');
  });

  it('should select researcher skill for research keywords', () => {
    const skill = registry.selectSkill(makeRequest('pesquisar sobre inteligência artificial e suas aplicações'), makePlan());
    expect(skill.id).toBe('researcher');
  });

  it('should select planner skill for planning keywords', () => {
    const skill = registry.selectSkill(makeRequest('preciso planejar um roadmap para o projeto'), makePlan());
    expect(skill.id).toBe('planner');
  });

  it('should select analyst skill for data keywords', () => {
    const skill = registry.selectSkill(makeRequest('analisar métricas de performance e KPIs do dashboard'), makePlan());
    expect(skill.id).toBe('analyst');
  });

  it('should select writer skill for doc creation keywords', () => {
    const skill = registry.selectSkill(makeRequest('escrever um artigo sobre machine learning'), makePlan());
    expect(skill.id).toBe('writer');
  });

  it('should select analyst skill for sheet.create action regardless of text', () => {
    const skill = registry.selectSkill(makeRequest('hello'), makePlan('sheet.create'));
    expect(skill.id).toBe('analyst');
  });

  it('should select writer skill for doc.create action', () => {
    const skill = registry.selectSkill(makeRequest('hello'), makePlan('doc.create'));
    expect(skill.id).toBe('writer');
  });

  it('should select writer skill for slide.create action', () => {
    const skill = registry.selectSkill(makeRequest('hello'), makePlan('slide.create'));
    expect(skill.id).toBe('writer');
  });

  it('should fall back to generalist when no pattern matches', () => {
    const skill = registry.selectSkill(makeRequest('olá, tudo bem?'), makePlan());
    expect(skill.id).toBe('generalist');
  });

  it('generalist systemPrompt should mention multitask capabilities', () => {
    const generalist = registry.getSkill('generalist');
    expect(generalist.systemPrompt).toContain('versátil');
    expect(generalist.systemPrompt).toContain('qualquer tipo de tarefa');
  });
});
