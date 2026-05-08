import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { EditedFileRecord } from '../../../core/domain/agent-types.js';
import type { FileEditActor, FileEditSessionTool } from '../../../core/ports/tools.js';

interface StoredEdit {
  record: EditedFileRecord;
  hadOriginalFile: boolean;
  backupPath?: string;
  editedSnapshotPath: string;
}

export class InMemoryFileEditSessionTool implements FileEditSessionTool {
  private readonly edits = new Map<string, StoredEdit>();

  constructor(private readonly backupRoot = path.join(os.tmpdir(), 'home-ai-agent-file-backups')) {}

  async writeWithBackup(filePath: string, content: string, actor: FileEditActor): Promise<EditedFileRecord> {
    const editId = randomUUID();
    const target = path.resolve(filePath);
    const now = new Date().toISOString();
    const existing = await this.readCurrentContent(target);

    const backupPath =
      existing.exists && typeof existing.content === 'string'
        ? await this.persistBackup(editId, existing.content)
        : undefined;

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf-8');
    const editedSnapshotPath = await this.persistEditedSnapshot(editId, content);

    const record: EditedFileRecord = {
      editId,
      filePath: target,
      ...(backupPath ? { backupPath } : {}),
      isNewFile: !existing.exists,
      status: 'pending',
      userId: actor.userId,
      sessionId: actor.sessionId,
      createdAt: now,
      updatedAt: now
    };

    this.edits.set(editId, {
      record,
      hadOriginalFile: existing.exists,
      ...(backupPath ? { backupPath } : {}),
      editedSnapshotPath
    });

    return record;
  }

  async replaceWithBackup(
    filePath: string,
    search: string,
    replaceWith: string,
    actor: FileEditActor
  ): Promise<EditedFileRecord> {
    const target = path.resolve(filePath);
    const current = await fs.readFile(target, 'utf-8');
    const next = current.replaceAll(search, replaceWith);
    return this.writeWithBackup(target, next, actor);
  }

  async keep(editId: string, actor: FileEditActor): Promise<EditedFileRecord | null> {
    const stored = this.requireOwnedPendingEdit(editId, actor);
    if (!stored) {
      return null;
    }

    const editedContent = await fs.readFile(stored.editedSnapshotPath, 'utf-8').catch(() => null);
    if (typeof editedContent === 'string') {
      await fs.mkdir(path.dirname(stored.record.filePath), { recursive: true });
      await fs.writeFile(stored.record.filePath, editedContent, 'utf-8');
    }

    if (stored.backupPath) {
      await fs.rm(stored.backupPath, { force: true }).catch(() => undefined);
    }
    await fs.rm(stored.editedSnapshotPath, { force: true }).catch(() => undefined);

    stored.record = {
      ...stored.record,
      status: 'kept',
      updatedAt: new Date().toISOString()
    };

    return stored.record;
  }

  async reject(editId: string, actor: FileEditActor): Promise<EditedFileRecord | null> {
    const stored = this.requireOwnedPendingEdit(editId, actor);
    if (!stored) {
      return null;
    }

    await fs.rm(stored.editedSnapshotPath, { force: true }).catch(() => undefined);

    if (stored.hadOriginalFile && stored.backupPath) {
      const backupContent = await fs.readFile(stored.backupPath, 'utf-8');
      await fs.mkdir(path.dirname(stored.record.filePath), { recursive: true });
      await fs.writeFile(stored.record.filePath, backupContent, 'utf-8');
      await fs.rm(stored.backupPath, { force: true }).catch(() => undefined);
    } else {
      await fs.rm(stored.record.filePath, { force: true, recursive: true }).catch(() => undefined);
    }

    stored.record = {
      ...stored.record,
      status: 'reverted',
      updatedAt: new Date().toISOString()
    };

    return stored.record;
  }

  async keepAll(actor: FileEditActor): Promise<EditedFileRecord[]> {
    const kept: EditedFileRecord[] = [];
    const pending = await this.listPending(actor);

    for (const item of pending) {
      const result = await this.keep(item.editId, actor);
      if (result) {
        kept.push(result);
      }
    }

    return kept;
  }

  async listPending(actor: FileEditActor): Promise<EditedFileRecord[]> {
    const items = [...this.edits.values()]
      .map((item) => item.record)
      .filter(
        (item) =>
          item.status === 'pending' &&
          item.userId === actor.userId &&
          item.sessionId === actor.sessionId
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    return items;
  }

  async openWithDefaultEditor(editId: string, actor: FileEditActor): Promise<EditedFileRecord | null> {
    const stored = this.edits.get(editId);
    if (!stored || !this.belongsToActor(stored.record, actor)) {
      return null;
    }

    this.openInDefaultApp(stored.record.filePath);
    return stored.record;
  }

  private async readCurrentContent(filePath: string): Promise<{ exists: boolean; content?: string }> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return { exists: true, content };
    } catch {
      return { exists: false };
    }
  }

  private async persistBackup(editId: string, content: string): Promise<string> {
    await fs.mkdir(this.backupRoot, { recursive: true });
    const backupPath = path.join(this.backupRoot, `${editId}.bak`);
    await fs.writeFile(backupPath, content, 'utf-8');
    return backupPath;
  }

  private async persistEditedSnapshot(editId: string, content: string): Promise<string> {
    await fs.mkdir(this.backupRoot, { recursive: true });
    const snapshotPath = path.join(this.backupRoot, `${editId}.next`);
    await fs.writeFile(snapshotPath, content, 'utf-8');
    return snapshotPath;
  }

  private requireOwnedPendingEdit(editId: string, actor: FileEditActor): StoredEdit | null {
    const stored = this.edits.get(editId);
    if (!stored) {
      return null;
    }

    if (!this.belongsToActor(stored.record, actor) || stored.record.status !== 'pending') {
      return null;
    }

    return stored;
  }

  private belongsToActor(record: EditedFileRecord, actor: FileEditActor): boolean {
    return record.userId === actor.userId && record.sessionId === actor.sessionId;
  }

  private openInDefaultApp(targetPath: string): void {
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', targetPath], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      return;
    }

    if (process.platform === 'darwin') {
      const child = spawn('open', [targetPath], { detached: true, stdio: 'ignore' });
      child.unref();
      return;
    }

    const child = spawn('xdg-open', [targetPath], { detached: true, stdio: 'ignore' });
    child.unref();
  }
}
