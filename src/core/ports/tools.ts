import type { EditedFileRecord } from '../domain/agent-types.js';

export interface FileEditActor {
  userId: string;
  sessionId: string;
}

export interface FileSystemTool {
  read(filePath: string): Promise<string>;
  write(filePath: string, content: string): Promise<void>;
  move(sourcePath: string, targetPath: string): Promise<void>;
  replace(filePath: string, search: string, replaceWith: string): Promise<void>;
  delete(filePath: string): Promise<void>;
  list(directoryPath: string): Promise<string[]>;
  listRecursive(directoryPath: string): Promise<string[]>;
}

export interface FileEditSessionTool {
  writeWithBackup(filePath: string, content: string, actor: FileEditActor): Promise<EditedFileRecord>;
  replaceWithBackup(
    filePath: string,
    search: string,
    replaceWith: string,
    actor: FileEditActor
  ): Promise<EditedFileRecord>;
  keep(editId: string, actor: FileEditActor): Promise<EditedFileRecord | null>;
  reject(editId: string, actor: FileEditActor): Promise<EditedFileRecord | null>;
  keepAll(actor: FileEditActor): Promise<EditedFileRecord[]>;
  listPending(actor: FileEditActor): Promise<EditedFileRecord[]>;
  openWithDefaultEditor(editId: string, actor: FileEditActor): Promise<EditedFileRecord | null>;
}

export interface WebTool {
  extract(url: string, query?: string): Promise<string>;
  search(query: string, maxResults?: number): Promise<string>;
}

export interface OfficeDocumentTool {
  createWord(title: string, body: string, outputPath: string): Promise<void>;
  createSlides(
    title: string,
    bullets:
      | string[]
      | Array<{ title: string; bullets: string[]; imageUrl?: string; imageSource?: string }>,
    outputPath: string
  ): Promise<void>;
  createSpreadsheet(rows: string[][], outputPath: string): Promise<void>;
}

export interface MediaTool {
  generateImage(prompt: string): Promise<string>;
  generateVideo(prompt: string): Promise<string>;
  generate3D(prompt: string): Promise<string>;
}

export interface McpToolConnector {
  connect(serverName: string, transport: 'stdio' | 'sse', endpoint?: string): Promise<string>;
}
