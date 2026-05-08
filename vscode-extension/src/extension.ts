import * as vscode from 'vscode';
import { AgentClient } from './agent-client';
import { SidebarProvider } from './sidebar-provider';

let statusBarItem: vscode.StatusBarItem;
let currentClient: AgentClient;
let sidebarProvider: SidebarProvider;

export function activate(context: vscode.ExtensionContext): void {
  // Build client using current config
  currentClient = buildClient();

  // Rebuild client when settings change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('homeAgent.serverUrl')) {
        currentClient = buildClient();
        scheduleHealthCheck();
      }
    })
  );

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'homeAgent.checkHealth';
  statusBarItem.text = '$(loading~spin) AI Agent';
  statusBarItem.tooltip = 'Home AI Agent — clique para verificar conexão';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Sidebar
  sidebarProvider = new SidebarProvider(context.extensionUri, () => currentClient);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('homeAgent.checkHealth', async () => {
      const ok = await currentClient.checkHealth();
      sidebarProvider.notifyStatus(ok);
      if (ok) {
        vscode.window.showInformationMessage('✅ Home AI Agent: servidor respondendo normalmente.');
        setStatusConnected();
      } else {
        const serverUrl = vscode.workspace.getConfiguration('homeAgent').get<string>('serverUrl', 'http://localhost:3000');
        vscode.window.showWarningMessage(
          `⚠️ Home AI Agent: servidor não respondeu em ${serverUrl}. Inicie com \`npm run dev\` na pasta do projeto.`,
          'Abrir configurações'
        ).then((choice) => {
          if (choice === 'Abrir configurações') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'homeAgent.serverUrl');
          }
        });
        setStatusDisconnected();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('homeAgent.sendSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Nenhum editor ativo.');
        return;
      }

      const selectedText = editor.document.getText(editor.selection);
      if (!selectedText.trim()) {
        vscode.window.showWarningMessage('Nenhum texto selecionado.');
        return;
      }

      const prompt = await vscode.window.showInputBox({
        prompt: 'O que você quer que o agente faça com o trecho selecionado?',
        placeHolder: 'Ex: refatore este código, explique este trecho, adicione tipos TypeScript...',
        ignoreFocusOut: true
      });

      if (!prompt) { return; }

      // Open the sidebar and pre-fill it
      await vscode.commands.executeCommand('homeAgent.sidebar.focus');
      sidebarProvider.sendTextToSidebar(prompt);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('homeAgent.openPanel', async () => {
      await vscode.commands.executeCommand('homeAgent.sidebar.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('homeAgent.reloadExtensionHost', async () => {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    })
  );

  // Initial health check
  scheduleHealthCheck();
}

export function deactivate(): void {
  statusBarItem?.dispose();
}

function buildClient(): AgentClient {
  const serverUrl = vscode.workspace.getConfiguration('homeAgent').get<string>('serverUrl', 'http://localhost:3000');
  return new AgentClient(serverUrl);
}

function scheduleHealthCheck(): void {
  setStatusChecking();
  setTimeout(async () => {
    const ok = await currentClient.checkHealth();
    sidebarProvider?.notifyStatus(ok);
    ok ? setStatusConnected() : setStatusDisconnected();
  }, 1500);
}

function setStatusConnected(): void {
  statusBarItem.text = '$(check) AI Agent';
  statusBarItem.backgroundColor = undefined;
  statusBarItem.tooltip = 'Home AI Agent — conectado. Clique para verificar novamente.';
}

function setStatusDisconnected(): void {
  statusBarItem.text = '$(warning) AI Agent';
  statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  statusBarItem.tooltip = 'Home AI Agent — servidor offline. Clique para verificar.';
}

function setStatusChecking(): void {
  statusBarItem.text = '$(loading~spin) AI Agent';
  statusBarItem.backgroundColor = undefined;
  statusBarItem.tooltip = 'Home AI Agent — verificando conexão...';
}
