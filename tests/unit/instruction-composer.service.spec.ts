import { describe, it, expect } from 'vitest';
import { InstructionComposerService } from '../../src/application/services/instruction-composer.service.js';
import { SkillRegistryService } from '../../src/application/services/skill-registry.service.js';
import type { AgentRequest } from '../../src/core/domain/agent-types.js';

function makeRequest(text = 'hello'): AgentRequest {
  return { text, userId: 'user-test', sessionId: 'sess-test' };
}

describe('InstructionComposerService', () => {
  const registry = new SkillRegistryService();
  const composer = new InstructionComposerService();

  it('should return a composed instruction with all required fields', () => {
    const skill = registry.getSkill('generalist');
    const result = composer.compose(skill, makeRequest());
    expect(result.appliedSkillId).toBe('generalist');
    expect(result.instructionVersion).toBeTruthy();
    expect(result.systemPrompt).toBeTruthy();
  });

  it('should include base identity in the system prompt', () => {
    const skill = registry.getSkill('generalist');
    const result = composer.compose(skill, makeRequest());
    expect(result.systemPrompt).toContain('Home AI Agent');
  });

  it('should include safety constraints', () => {
    const skill = registry.getSkill('developer');
    const result = composer.compose(skill, makeRequest());
    expect(result.systemPrompt).toContain('segurança obrigatórias');
    expect(result.systemPrompt).toContain('senhas');
  });

  it('should include skill-specific system prompt', () => {
    const skill = registry.getSkill('developer');
    const result = composer.compose(skill, makeRequest());
    expect(result.systemPrompt).toContain('desenvolvimento de software');
  });

  it('should include memory context when provided', () => {
    const skill = registry.getSkill('researcher');
    const result = composer.compose(skill, makeRequest(), {
      memoryContext: '[2026-01-01] last_summary: análise de dados concluída'
    });
    expect(result.systemPrompt).toContain('análise de dados concluída');
    expect(result.systemPrompt).toContain('memória do usuário');
  });

  it('should NOT include memory section when memoryContext is not provided', () => {
    const skill = registry.getSkill('planner');
    const result = composer.compose(skill, makeRequest());
    expect(result.systemPrompt).not.toContain('memória do usuário');
  });

  it('should include userId and sessionId in context section', () => {
    const skill = registry.getSkill('analyst');
    const result = composer.compose(skill, makeRequest());
    expect(result.systemPrompt).toContain('user-test');
    expect(result.systemPrompt).toContain('sess-test');
  });

  it('should use the instructionVersion consistently', () => {
    const skill = registry.getSkill('writer');
    const r1 = composer.compose(skill, makeRequest());
    const r2 = composer.compose(skill, makeRequest());
    expect(r1.instructionVersion).toBe(r2.instructionVersion);
  });
});
