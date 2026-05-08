import * as vscode from 'vscode';
import { AgentClient, type AgentExecuteResponse } from './agent-client';
import { buildActiveFileContextPayload } from './active-file-context';

type WebviewMessage =
  | { type: 'execute'; text: string; sendFileContext: boolean; modelId?: string }
  | { type: 'requestAddFileContext' }
  | { type: 'confirm'; token: string; userId: string; sessionId: string }
  | { type: 'insertCode'; code: string; language: string }
  | { type: 'copyCode'; code: string }
  | { type: 'ready' };

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'homeAgent.sidebar';

  private _view?: vscode.WebviewView;
  private _sessionId: string;
  private _lastResponse?: AgentExecuteResponse;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly getClient: () => AgentClient
  ) {
    this._sessionId = `vscode-session-${Date.now()}`;
  }

  public notifyStatus(ok: boolean): void {
    this._view?.webview.postMessage({ type: 'status', connected: ok });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };

    webviewView.webview.html = this.buildHtml(webviewView.webview);

    // Immediately send health + models so webview updates even if it doesn't post 'ready'
    (async () => {
      try {
        const ping = await this.getClient().pingStatus();
        webviewView.webview.postMessage({ type: 'status', connected: ping.ok, message: ping.error });
      } catch (e) {
        webviewView.webview.postMessage({ type: 'status', connected: false, message: e instanceof Error ? e.message : String(e) });
      }

      try {
        const models = await this.getClient().getModels();
        webviewView.webview.postMessage({ type: 'models', payload: models });
      } catch {
        // ignore
      }
    })();

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      switch (msg.type) {
        case 'execute':
          await this.handleExecute(msg.text, msg.sendFileContext, (msg as any).modelId);
          break;
        case 'requestAddFileContext': {
          // Build a payload containing the active file content regardless of config and send back
          const editor = vscode.window.activeTextEditor;
          if (!editor) {
            webviewView.webview.postMessage({ type: 'insertFileContext', promptPrefix: null, label: null });
            break;
          }

          const document = editor.document;
          const absolutePath = document.fileName;
          const relativePath = vscode.workspace.asRelativePath(absolutePath);
          const language = document.languageId;
          const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
          const workspaceRoot = workspaceFolder?.uri.fsPath;
          const rawContents = document.getText();

          const contextLines = [
            '[Contexto automático do editor VS Code]',
            `[Arquivo ativo relativo: ${relativePath}]`,
            `[Arquivo ativo absoluto: ${absolutePath}]`,
            `[Linguagem: ${language}]`,
            ...(workspaceRoot ? [`[Workspace raiz aberto no VS Code: ${workspaceFolder?.name ?? workspaceRoot}]`] : []),
            '[Use este contexto como fonte primária e evite reler este arquivo se isso não for necessário.]',
            '[Conteúdo atual do arquivo aberto:]',
            '```' + language,
            rawContents,
            '```'
          ];

          const promptPrefix = contextLines.join('\n');
          const label = workspaceRoot
            ? `Arquivo ativo: ${relativePath} | workspace: ${workspaceFolder?.name ?? workspaceRoot}`
            : `Arquivo ativo: ${relativePath}`;

          webviewView.webview.postMessage({ type: 'insertFileContext', promptPrefix, label });
          break;
        }
        case 'confirm':
          await this.handleConfirm(msg.token, msg.userId, msg.sessionId);
          break;
        case 'insertCode':
          await this.handleInsertCode(msg.code);
          break;
        case 'copyCode':
          await vscode.env.clipboard.writeText(msg.code);
          vscode.window.showInformationMessage('Código copiado para a área de transferência.');
          break;
        case 'ready': {
          const syncActiveFileContext = (): void => {
            webviewView.webview.postMessage({ type: 'activeFileContext', payload: buildActiveFileContextPayload() });
          };

          // initial sync
          syncActiveFileContext();

          // update when active editor or document changes
          const activeEditorDisposable = vscode.window.onDidChangeActiveTextEditor(() => {
            syncActiveFileContext();
          });

          const documentDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
            if (vscode.window.activeTextEditor?.document === event.document) {
              syncActiveFileContext();
            }
          });

          webviewView.onDidDispose(() => {
            activeEditorDisposable.dispose();
            documentDisposable.dispose();
          });

          // also send current health status to webview
          (async () => {
            try {
              const ping = await this.getClient().pingStatus();
              webviewView.webview.postMessage({ type: 'status', connected: ping.ok, message: ping.error });
            } catch (e) {
              webviewView.webview.postMessage({ type: 'status', connected: false, message: e instanceof Error ? e.message : String(e) });
            }
            // fetch models server-side to avoid CORS and send to webview
            try {
              const models = await this.getClient().getModels();
              webviewView.webview.postMessage({ type: 'models', payload: models });
            } catch (e) {
              // ignore model fetch errors — webview will fallback to client fetch
            }
          })();

          break;
        }
      }
    });
  }

  public sendTextToSidebar(text: string): void {
    this._view?.webview.postMessage({ type: 'prefill', text });
  }

  private async handleExecute(userText: string, sendFileContext: boolean, modelId?: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('homeAgent');
    const userId = config.get<string>('userId', 'vscode-user');
    const clientRequestId = `vscode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const client = this.getClient();

    let text = userText;
    let fileContext: ReturnType<typeof buildActiveFileContextPayload> = null;

    if (sendFileContext) {
      fileContext = buildActiveFileContextPayload();
      if (fileContext) {
        text = `${fileContext.promptPrefix}\n\n${userText}`;
      }
    }

    this.postToWebview({ type: 'thinking', clientRequestId });

    // Start polling loop before executing so we capture early events
    let progressCursor = 0;
    let polling = true;

    const pollLoop = async (): Promise<void> => {
      while (polling) {
        await sleep(600);
        try {
          const state = await client.pollProgress(clientRequestId, progressCursor);
          for (const event of state.events) {
            this.postToWebview({ type: 'progress', stage: event.stage, message: event.message });
          }
          progressCursor = state.cursor;
          if (state.done) { polling = false; }
        } catch {
          // progress endpoint may not exist yet — ignore silently
        }
      }
    };

    const pollPromise = pollLoop();

    try {
      const result = await client.execute({
        text,
        userId,
        sessionId: this._sessionId,
        clientRequestId,
        ...(fileContext?.workspaceRoot ? { workspaceRoot: fileContext.workspaceRoot } : {}),
        ...(fileContext?.activeFilePath ? { activeFilePath: fileContext.activeFilePath } : {}),
        ...(modelId ? { configuredModel: modelId } : {})
      });

      polling = false;
      await pollPromise;

      this._lastResponse = result;
      this.postToWebview({ type: 'response', result, userId, sessionId: this._sessionId });
    } catch (error) {
      polling = false;
      await pollPromise;
      const message = error instanceof Error ? error.message : String(error);
      this.postToWebview({ type: 'error', message });
    }
  }

  private async handleConfirm(token: string, userId: string, sessionId: string): Promise<void> {
    const clientRequestId = `vscode-confirm-${Date.now()}`;
    this.postToWebview({ type: 'thinking', clientRequestId });

    const client = this.getClient();
    try {
      const result = await client.execute({
        text: `confirmar ${token}`,
        userId,
        sessionId,
        clientRequestId
      });
      this._lastResponse = result;
      this.postToWebview({ type: 'response', result, userId, sessionId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.postToWebview({ type: 'error', message });
    }
  }

  private async handleInsertCode(code: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Nenhum editor ativo. Abra um arquivo para inserir o código.');
      return;
    }

    await editor.edit((editBuilder) => {
      const selection = editor.selection;
      if (!selection.isEmpty) {
        editBuilder.replace(selection, code);
      } else {
        editBuilder.insert(selection.active, code);
      }
    });

    await vscode.commands.executeCommand('editor.action.formatDocument');
  }

  private postToWebview(msg: unknown): void {
    this._view?.webview.postMessage(msg);
  }

  private buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.css')
    );
    const nonce = generateNonce();

    return /* html */`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource} ${vscode.workspace.getConfiguration('homeAgent').get<string>('serverUrl','http://localhost:3000').replace(/\/$/, '')} https:;">
  <link href="${styleUri}" rel="stylesheet" />
  <title>Home AI Agent</title>
</head>
<body>
  <div id="header">
    <span id="status-dot" class="status-dot checking" title="Status da conexão"></span>
    <span id="status-label">Verificando...</span>
  </div>

  <div id="messages" aria-live="polite" aria-label="Histórico do chat"></div>

  <div id="confirmation-banner" class="hidden">
    <div id="confirmation-text"></div>
    <div class="confirmation-actions">
      <button id="btn-confirm" class="btn-confirm">✅ Confirmar ação</button>
      <button id="btn-cancel-confirm" class="btn-cancel">✖ Cancelar</button>
    </div>
  </div>

  <div id="input-area">
    <div id="add-file-row" style="margin-bottom:8px;">
      <button id="btn-add-file-context" class="icon-btn" title="Adicionar arquivo ativo ao prompt">📎 Adicionar arquivo ativo</button>
      <div id="active-file-label" style="display:inline-block;margin-left:8px;font-size:0.9rem;color:var(--vscode-editor-foreground);">Nenhum arquivo ativo</div>
    </div>

    <textarea
      id="prompt-input"
      placeholder="Descreva o que o agente deve fazer..."
      rows="3"
      autocomplete="off"
      spellcheck="true"
    ></textarea>
    <div id="input-actions">
      <span id="char-count">0</span>
      <div style="display:flex;align-items:center;gap:8px">
        <div id="context-usage-wrap" style="display:flex;align-items:center;gap:8px">
          <div id="context-usage-bar" style="width:120px;height:8px;background:var(--vscode-editor-background);border-radius:6px;overflow:hidden">
            <div id="context-usage-fill" style="width:0%;height:100%;background:linear-gradient(90deg,#6ee7b7,#3b82f6);"></div>
          </div>
          <div id="context-usage-label" style="font-size:0.85rem;color:var(--vscode-editor-foreground);">0%</div>
        </div>

        <div id="model-selector" style="display:flex;align-items:center">
          <select id="model-select" style="min-width:180px;padding:6px;border-radius:6px;border:1px solid var(--vscode-editorGroup-border);background:var(--vscode-editor-background);color:var(--vscode-editor-foreground)">
            <option>Carregando modelos...</option>
          </select>
        </div>

        <button id="btn-send" class="btn-primary" title="Enviar (Ctrl+Enter)">Enviar</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
  (function(){
    var __AGENT_BASE = ${JSON.stringify(vscode.workspace.getConfiguration('homeAgent').get<string>('serverUrl','http://localhost:3000').replace(/\/$/, ''))};
    var _orig = window.fetch.bind(window);
    window.fetch = function(url, opts) {
      if (typeof url === 'string' && url.startsWith('/')) {
        url = __AGENT_BASE + url;
      }
      return _orig(url, opts);
    };
    var _XHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      if (typeof url === 'string' && url.startsWith('/')) {
        url = __AGENT_BASE + url;
      }
      arguments[1] = url;
      return _XHROpen.apply(this, arguments);
    };
  })();
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function generateNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
