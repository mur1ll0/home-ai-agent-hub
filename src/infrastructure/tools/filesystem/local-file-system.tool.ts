import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileSystemTool } from '../../../core/ports/tools.js';

export class LocalFileSystemTool implements FileSystemTool {
  async read(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8');
  }

  async write(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }

  async move(sourcePath: string, targetPath: string): Promise<void> {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.rename(sourcePath, targetPath);
  }

  async replace(filePath: string, search: string, replaceWith: string): Promise<void> {
    const current = await fs.readFile(filePath, 'utf-8');
    await fs.writeFile(filePath, current.replaceAll(search, replaceWith), 'utf-8');
  }

  async delete(filePath: string): Promise<void> {
    await fs.rm(filePath, { force: true, recursive: true });
  }

  async list(directoryPath: string): Promise<string[]> {
    return fs.readdir(directoryPath);
  }

  async listRecursive(directoryPath: string): Promise<string[]> {
    const files: string[] = [];
    const root = path.resolve(directoryPath);

    const walk = async (currentPath: string): Promise<void> => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }

        files.push(fullPath);
      }
    };

    await walk(root);
    return files;
  }
}
