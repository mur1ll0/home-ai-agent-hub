import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { SafetyGuardService } from '../../src/application/services/safety-guard.service.js';

const env = {
  OPENROUTER_API_KEY: 'test',
  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  OPENROUTER_APP_NAME: 'test',
  OPENROUTER_HTTP_REFERER: 'http://localhost',
  OPENROUTER_DEFAULT_MODEL: 'openrouter/auto',
  AGENT_ALLOWED_ROOT: './workspace',
  AGENT_ALLOWED_READ_ROOTS: './workspace',
  AGENT_ALLOWED_WRITE_ROOTS: './workspace',
  AGENT_ALLOWED_DELETE_ROOTS: './workspace',
  AGENT_ALLOWED_MOVE_ROOTS: './workspace',
  AGENT_ALLOWED_REPLACE_ROOTS: './workspace',
  AGENT_ALLOWED_LIST_ROOTS: './workspace',
  AGENT_SENSITIVE_PATHS: 'C:/Users,C:/Windows,/etc,/root',
  AGENT_AUDIT_LOG_PATH: './workspace/audit/agent-audit.jsonl',
  MEMORY_BACKEND: 'obsidian',
  OBSIDIAN_VAULT_PATH: './workspace/obsidian-vault',
  MEMPALACE_URL: '',
  MEMPALACE_API_KEY: '',
  PLAYWRIGHT_HEADLESS: 'true'
} as const;

describe('SafetyGuardService', () => {
  it('bloqueia caminho sensivel', async () => {
    const sut = new SafetyGuardService(env);

    await expect(
      sut.validate(
        { text: 'ler C:/Windows/System32/config', userId: 'u', sessionId: 's' },
        { action: 'file.read', confidence: 1, reason: 'test' }
      )
    ).rejects.toThrow(/sensível|sensivel/i);
  });

  it('bloqueia delecao fora do root permitido', async () => {
    const sut = new SafetyGuardService(env);

    await expect(
      sut.validate(
        { text: 'excluir "./outro/arquivo.txt"', userId: 'u', sessionId: 's' },
        { action: 'file.delete', confidence: 1, reason: 'test' }
      )
    ).rejects.toThrow(/fora das raízes permitidas/i);
  });

  it('permite acesso dentro do workspace root enviado pelo cliente', async () => {
    const sut = new SafetyGuardService(env);
    const workspaceRoot = path.resolve('tests/fixtures/repo-root');

    await expect(
      sut.validate(
        {
          text: 'ler "src/index.ts"',
          userId: 'u',
          sessionId: 's',
          workspaceRoot
        },
        { action: 'file.read', confidence: 1, reason: 'test' }
      )
    ).resolves.toBeUndefined();
  });
});
