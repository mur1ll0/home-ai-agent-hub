import fs from 'node:fs/promises';
import path from 'node:path';
import type { AuditEvent, AuditLogger } from '../../core/ports/agent-services.js';

export class JsonlAuditLogger implements AuditLogger {
  constructor(private readonly filePath: string) {}

  async log(event: AuditEvent): Promise<void> {
    const line = `${JSON.stringify(event)}\n`;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, line, 'utf-8');
  }
}
