import fs from 'node:fs/promises';
import path from 'node:path';
import type { MemoryGateway } from '../../core/ports/agent-services.js';

export class ObsidianMemoryGateway implements MemoryGateway {
  constructor(private readonly vaultPath: string) {}

  async remember(userId: string, key: string, value: string): Promise<void> {
    const notePath = this.buildNotePath(userId);
    const timestamp = new Date().toISOString();
    const entry = `- ${timestamp} | ${key} | ${value.replace(/\r?\n/g, ' ').slice(0, 600)}\n`;

    await fs.mkdir(path.dirname(notePath), { recursive: true });
    await fs.appendFile(notePath, entry, 'utf-8');
  }

  async recall(userId: string, key: string): Promise<string | null> {
    const notePath = this.buildNotePath(userId);

    try {
      const content = await fs.readFile(notePath, 'utf-8');
      const lines = content.split(/\r?\n/).filter(Boolean);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index] ?? '';
        const parts = line.split('|').map((part) => part.trim());
        if (parts.length < 3) {
          continue;
        }

        if (parts[1] === key) {
          return parts.slice(2).join(' | ');
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  async recallRecent(
    userId: string,
    limit = 10
  ): Promise<Array<{ timestamp: string; key: string; value: string }>> {
    const notePath = this.buildNotePath(userId);

    try {
      const content = await fs.readFile(notePath, 'utf-8');
      const lines = content.split(/\r?\n/).filter(Boolean);
      const results: Array<{ timestamp: string; key: string; value: string }> = [];

      for (let index = lines.length - 1; index >= 0 && results.length < limit; index -= 1) {
        const line = lines[index] ?? '';
        const parts = line.split('|').map((part) => part.trim());
        if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
          continue;
        }
        // Strip leading '- ' from timestamp
        const timestamp = parts[0].replace(/^-\s*/, '');
        results.push({ timestamp, key: parts[1], value: parts.slice(2).join(' | ') });
      }

      return results;
    } catch {
      return [];
    }
  }

  private buildNotePath(userId: string): string {
    return path.join(path.resolve(this.vaultPath), 'home-ai-agent-memory', `${userId}.md`);
  }
}
