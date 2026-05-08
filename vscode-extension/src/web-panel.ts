import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { buildActiveFileContextPayload } from './active-file-context';

/**
 * Painel completo que carrega a UI web do projeto (public/index.html) diretamente do disco.
 * Assets são servidos via webview URIs. Chamadas fetch para /v1/* são redirecionadas
 * ao servidor configurado via um script de patch injetado no <head>.
 */
export class AgentWebPanel {
  private static _panel: vscode.WebviewPanel | undefined;
  private static readonly viewType = 'homeAgent.webPanel';

  public static createOrShow(context: vscode.ExtensionContext, serverUrl: string): void {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    // Re-use existing panel if open
    if (AgentWebPanel._panel) {
      AgentWebPanel._panel.reveal(column);
      return;
    }

    const publicRoot = AgentWebPanel.resolvePublicRoot(context);

    if (!publicRoot) {
      vscode.window.showErrorMessage(
        'Home AI Agent: pasta public/ não encontrada no workspace. Abra a pasta do projeto no VS Code.'
      );
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      AgentWebPanel.viewType,
      'Home AI Agent — UI',
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(publicRoot)]
      }
    );

    AgentWebPanel._panel = panel;

    panel.webview.html = AgentWebPanel.buildHtml(panel.webview, publicRoot, serverUrl);

    const syncActiveFileContext = (): void => {
      panel.webview.postMessage({
        type: 'activeFileContext',
        payload: buildActiveFileContextPayload()
      });
    };

    panel.webview.onDidReceiveMessage((message) => {
      if (message?.type === 'requestActiveFileContext') {
        syncActiveFileContext();
      }
    });

    const activeEditorDisposable = vscode.window.onDidChangeActiveTextEditor(() => {
      syncActiveFileContext();
    });

    const documentDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
      if (vscode.window.activeTextEditor?.document === event.document) {
        syncActiveFileContext();
      }
    });

    syncActiveFileContext();

    panel.onDidDispose(() => {
      activeEditorDisposable.dispose();
      documentDisposable.dispose();
      AgentWebPanel._panel = undefined;
    });
  }

  private static resolvePublicRoot(context: vscode.ExtensionContext): string | undefined {
    // Try workspace folders first
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        const candidate = path.join(folder.uri.fsPath, 'public');
        if (fs.existsSync(path.join(candidate, 'index.html'))) {
          return candidate;
        }
      }
    }

    // Fallback: extension's own directory (for when packaged)
    const extensionPublic = path.join(context.extensionPath, '..', 'public');
    if (fs.existsSync(path.join(extensionPublic, 'index.html'))) {
      return extensionPublic;
    }

    return undefined;
  }

  private static buildHtml(
    webview: vscode.Webview,
    publicRoot: string,
    serverUrl: string
  ): string {
    const htmlPath = path.join(publicRoot, 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf-8');

    html = html.replace(/((?:src|href)=["'])\/assets\/([^"']+)(["'])/g, (_, prefix, fileName, suffix) => {
      const fileFsPath = path.join(publicRoot, 'assets', fileName);
      if (fs.existsSync(fileFsPath)) {
        const uri = webview.asWebviewUri(vscode.Uri.file(fileFsPath));
        return `${prefix}${uri}${suffix}`;
      }
      return `${prefix}/assets/${fileName}${suffix}`;
    });

    const bootstrapScript = `<script>
(function() {
  var vscode = acquireVsCodeApi();
  var __AGENT_BASE = ${JSON.stringify(serverUrl.replace(/\/$/, ''))};
  var activeFileContext = null;
  var _orig = window.fetch.bind(window);
  window.fetch = function(url, opts) {
    if (typeof url === 'string' && url.startsWith('/')) {
      url = __AGENT_BASE + url;
    }
    return _orig(url, opts);
  };
  // Also patch XMLHttpRequest for any legacy callers
  var _XHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === 'string' && url.startsWith('/')) {
      url = __AGENT_BASE + url;
    }
    arguments[1] = url;
    return _XHROpen.apply(this, arguments);
  };

  function refreshContextToggle(payload) {
    var label = document.querySelector('[data-vscode-file-context-label]');
    if (!label) {
      return;
    }

    if (payload && payload.label) {
      label.textContent = 'Incluir contexto automatico do arquivo aberto: ' + payload.label;
      return;
    }

    label.textContent = 'Incluir contexto automatico do arquivo aberto';
  }

  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'activeFileContext') {
      activeFileContext = event.data.payload || null;
      refreshContextToggle(activeFileContext);
    }
  });

  document.addEventListener('DOMContentLoaded', function() {
    var actions = document.querySelector('.actions');
    if (actions && !document.querySelector('[data-vscode-file-context-wrap]')) {
      var wrap = document.createElement('label');
      wrap.setAttribute('data-vscode-file-context-wrap', 'true');
      wrap.style.display = 'flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '8px';
      wrap.style.marginTop = '10px';
      wrap.style.fontSize = '0.9rem';
      wrap.innerHTML = '<input id="vscode-file-context-toggle" type="checkbox" checked />' +
        '<span data-vscode-file-context-label>Incluir contexto automatico do arquivo aberto</span>';
      actions.parentNode.insertBefore(wrap, actions.nextSibling);
    }

    document.addEventListener('submit', function(event) {
      var form = event.target;
      if (!(form instanceof HTMLFormElement) || form.id !== 'agent-form') {
        return;
      }

      var toggle = document.getElementById('vscode-file-context-toggle');
      var promptEl = document.getElementById('prompt');
      if (!(toggle instanceof HTMLInputElement) || !toggle.checked) {
        return;
      }
      if (!(promptEl instanceof HTMLTextAreaElement) || !activeFileContext || !activeFileContext.promptPrefix) {
        return;
      }

      if (!promptEl.value.startsWith(activeFileContext.promptPrefix)) {
        promptEl.value = activeFileContext.promptPrefix + '\n\n' + promptEl.value;
      }
    }, true);

    vscode.postMessage({ type: 'requestActiveFileContext' });
  });
})();
</script>`;

    const csp = [
      "default-src 'none'",
      `script-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net`,
      `style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com`,
      'font-src https://fonts.gstatic.com',
      `img-src ${webview.cspSource} data: https:`,
      `connect-src ${webview.cspSource} ${serverUrl.replace(/\/$/, '')} https://fonts.gstatic.com https://fonts.googleapis.com https://cdn.jsdelivr.net`
    ].join('; ');

    html = html.replace(
      /<head>/i,
      `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">\n  ${bootstrapScript}`
    );

    return html;
  }
}
