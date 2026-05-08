import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { InMemoryFileEditSessionTool } from '../../src/infrastructure/tools/filesystem/file-edit-session.tool.js';

describe('InMemoryFileEditSessionTool', () => {
  it('keep reaplica o conteúdo editado no arquivo', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'file-edit-session-'));
    const targetFile = path.join(tmpRoot, 'sample.txt');
    await fs.writeFile(targetFile, 'conteudo-original', 'utf-8');

    const sut = new InMemoryFileEditSessionTool(path.join(tmpRoot, '.backups'));
    const actor = { userId: 'u1', sessionId: 's1' };

    const edit = await sut.writeWithBackup(targetFile, 'conteudo-editado', actor);

    // Simula alteração externa indevida antes do keep.
    await fs.writeFile(targetFile, 'conteudo-antigo-restaurado', 'utf-8');

    const kept = await sut.keep(edit.editId, actor);
    const finalContent = await fs.readFile(targetFile, 'utf-8');

    expect(kept?.status).toBe('kept');
    expect(finalContent).toBe('conteudo-editado');

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('reject restaura backup original do arquivo', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'file-edit-session-'));
    const targetFile = path.join(tmpRoot, 'sample.txt');
    await fs.writeFile(targetFile, 'conteudo-original', 'utf-8');

    const sut = new InMemoryFileEditSessionTool(path.join(tmpRoot, '.backups'));
    const actor = { userId: 'u1', sessionId: 's1' };

    const edit = await sut.writeWithBackup(targetFile, 'conteudo-editado', actor);
    const reverted = await sut.reject(edit.editId, actor);
    const finalContent = await fs.readFile(targetFile, 'utf-8');

    expect(reverted?.status).toBe('reverted');
    expect(finalContent).toBe('conteudo-original');

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });
});
