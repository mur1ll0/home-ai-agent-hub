import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ObsidianMemoryGateway } from '../../src/infrastructure/memory/obsidian-memory.gateway.js';

describe('ObsidianMemoryGateway', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }))
    );
    tempDirs.length = 0;
  });

  it('persiste e recupera o valor mais recente por chave', async () => {
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-vault-'));
    tempDirs.push(vaultDir);

    const gateway = new ObsidianMemoryGateway(vaultDir);

    await gateway.remember('u1', 'last_summary', 'Primeira execução');
    await gateway.remember('u1', 'last_summary', 'Segunda execução');

    const value = await gateway.recall('u1', 'last_summary');

    expect(value).toBe('Segunda execução');
  });

  it('retorna null para chave inexistente', async () => {
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-vault-'));
    tempDirs.push(vaultDir);

    const gateway = new ObsidianMemoryGateway(vaultDir);

    const value = await gateway.recall('u1', 'last_status');

    expect(value).toBeNull();
  });
});
