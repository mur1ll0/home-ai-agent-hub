import * as vscode from 'vscode';

const MAX_FILE_CONTEXT_CHARS = 30000;

export interface ActiveFileContextPayload {
  label: string;
  promptPrefix: string;
  workspaceRoot?: string;
  activeFilePath?: string;
}

export function buildActiveFileContextPayload(): ActiveFileContextPayload | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return null;
  }

  const config = vscode.workspace.getConfiguration('homeAgent');
  const includeFileContext = config.get<boolean>('sendFileContext', true);
  const includeFileContents = config.get<boolean>('includeActiveFileContents', true);

  if (!includeFileContext) {
    return null;
  }

  const document = editor.document;
  const selection = editor.selection;
  const absolutePath = document.fileName;
  const relativePath = vscode.workspace.asRelativePath(absolutePath);
  const language = document.languageId;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const workspaceRoot = workspaceFolder?.uri.fsPath;
  const selectedText = document.getText(selection).trim();
  const rawContents = includeFileContents ? document.getText() : '';
  const fileContents = rawContents.slice(0, MAX_FILE_CONTEXT_CHARS);
  const wasTruncated = rawContents.length > fileContents.length;

  const contextLines: string[] = [
    '[Contexto automático do editor VS Code]',
    `[Arquivo ativo relativo: ${relativePath}]`,
    `[Arquivo ativo absoluto: ${absolutePath}]`,
    `[Linguagem: ${language}]`,
    ...(workspaceRoot ? [`[Workspace raiz aberto no VS Code: ${workspaceRoot}]`] : []),
    ...(workspaceRoot
      ? [
          '[Considere este workspace como repositório base prioritário para localizar, ler e editar arquivos do projeto.]'
        ]
      : []),
    '[Use este contexto como fonte primária e evite reler este arquivo se isso não for necessário.]'
  ];

  if (includeFileContents) {
    contextLines.push('[Conteúdo atual do arquivo aberto:]');
    contextLines.push('```' + language);
    contextLines.push(fileContents);
    contextLines.push('```');

    if (wasTruncated) {
      contextLines.push(
        `[Conteúdo truncado para ${MAX_FILE_CONTEXT_CHARS} caracteres para caber no contexto.]`
      );
    }
  }

  if (selectedText) {
    contextLines.push(
      `[Seleção atual (linhas ${selection.start.line + 1}–${selection.end.line + 1})]:`
    );
    contextLines.push('```' + language);
    contextLines.push(selectedText);
    contextLines.push('```');
  }

  return {
    label: workspaceRoot
      ? `Arquivo ativo: ${relativePath} | workspace: ${workspaceFolder?.name ?? workspaceRoot}`
      : `Arquivo ativo: ${relativePath}`,
    promptPrefix: contextLines.join('\n'),
    workspaceRoot,
    activeFilePath: absolutePath
  };
}